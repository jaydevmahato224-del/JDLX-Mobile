import math
from .optimizer import calculate_distance, estimate_delivery_time

def find_nearby_warehouses(user_lat, user_lng, stores, radius_km=3):

    """
    Filter stores that are within the specified radius.
    """
    nearby = []
    for store in stores:
        dist = calculate_distance(user_lat, user_lng, store['latitude'], store['longitude'])
        if dist <= radius_km:
            store_with_dist = dict(store)
            store_with_dist['distance'] = dist
            nearby.append(store_with_dist)
    return nearby

def check_inventory_availability(cursor, warehouse_id, cart_items):
    """
    Check if all items in the cart are available in the specific warehouse
    based on physical stock (ignoring cart reservations).
    """
    available_items = 0
    total_items = len(cart_items)
    
    for item in cart_items:
        cursor.execute("""
            SELECT 
                wi.stock_quantity - wi.reserved_stock as physical_available
            FROM warehouse_inventory wi
            WHERE wi.warehouse_id = ? AND wi.product_id = ?
        """, (warehouse_id, item['id']))
        row = cursor.fetchone()
        available = row['physical_available'] if row else 0
        
        if available >= item['qty']:
            available_items += 1
            
    return (available_items == total_items), available_items

def rank_warehouses(user_lat, user_lng, candidate_warehouses, cart_items, cursor):
    """
    Rank warehouses based on distance and inventory fulfillment.
    Prioritizes warehouses with 100% stock.
    """
    ranked = []
    
    for store in candidate_warehouses:
        is_full_stock, available_count = check_inventory_availability(cursor, store['id'], cart_items)
        est_time = estimate_delivery_time(store['distance'])
        
        # Scoring: 
        # Base score is ETA (lower is better)
        # Penalty for missing stock (huge penalty if not full stock)
        score = est_time
        if not is_full_stock:
            # Penalty proportional to missing items
            missing_ratio = (len(cart_items) - available_count) / len(cart_items)
            score += 1000 * missing_ratio 
            
        ranked.append({
            **store,
            'estimated_time': est_time,
            'is_full_stock': is_full_stock,
            'available_count': available_count,
            'optimization_score': score
        })
        
    # Sort by score ascending
    ranked.sort(key=lambda x: x['optimization_score'])
    return ranked

def select_best_warehouse(user_lat, user_lng, stores, cart_items, cursor, radius_km=3):

    """
    Main entry point for hyperlocal selection.
    """
    # 1. Filter by radius
    nearby = find_nearby_warehouses(user_lat, user_lng, stores, radius_km)
    
    if not nearby:
        return None, "No stores within 3km of your location"

        
    # 2. Rank by stock and distance
    ranked = rank_warehouses(user_lat, user_lng, nearby, cart_items, cursor)
    
    # Best store is the first one in ranked list
    best = ranked[0]
    
    if not best['is_full_stock']:
        return None, f"Items out of stock at your nearest locations. Best match: {best['name']} has {best['available_count']}/{len(cart_items)} items."
        
    return best, None
