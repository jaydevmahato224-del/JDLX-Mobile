import time
import math
import threading
from concurrent.futures import ThreadPoolExecutor
from database import get_db

# Engine scaled for 1000+ routes/min using a background pool
routing_pool = ThreadPoolExecutor(max_workers=10)

def haversine(lat1, lon1, lat2, lon2):
    """Calculate the great circle distance between two points on the earth."""
    # Convert decimal degrees to radians
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    # Haversine formula
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    r = 6371  # Radius of earth in kilometers
    return c * r

def _find_best_store(cursor, delivery_lat, delivery_lon, order_id):
    """Finds the nearest active dark store that has ALL requested items mathematically available."""
    # 1. Fetch all items requested in this order
    cursor.execute("SELECT product_id, quantity FROM order_items WHERE order_id = ?", (order_id,))
    order_items = cursor.fetchall()

    # 2. Fetch all active dark stores
    cursor.execute("SELECT id, latitude, longitude FROM dark_stores WHERE active = 1")
    active_stores = cursor.fetchall()

    if not active_stores:
        return None  # Complete platform outage
    
    # Priority rank stores by distance
    store_distances = []
    for s in active_stores:
        dist = haversine(delivery_lat, delivery_lon, s['latitude'], s['longitude'])
        store_distances.append((dist, s['id']))
    
    store_distances.sort(key=lambda x: x[0])

    # 3. Check inventory sequentially through closest stores
    for dist, store_id in store_distances:
        has_inventory = True
        for item in order_items:
            # Phase 8 validation check: (stock - reserved >= requested)
            cursor.execute('''
                SELECT stock_quantity, reserved_stock 
                FROM store_inventory 
                WHERE store_id = ? AND product_id = ?
            ''', (store_id, item['product_id']))
            inv = cursor.fetchone()
            
            if not inv or (inv['stock_quantity'] - inv['reserved_stock']) < item['quantity']:
                has_inventory = False
                break
                
        if has_inventory:
            return store_id

    return None

def _assign_delivery_partner(cursor, store_id):
    """Finds the closest available delivery rider to the selected dark store."""
    cursor.execute("SELECT latitude, longitude FROM dark_stores WHERE id = ?", (store_id,))
    store = cursor.fetchone()
    
    if not store:
        return None, None

    cursor.execute("SELECT id, latitude, longitude FROM delivery_partners WHERE status = 'AVAILABLE'")
    partners = cursor.fetchall()

    if not partners:
        return None, None
        
    partner_distances = []
    for p in partners:
        dist = haversine(store['latitude'], store['longitude'], p['latitude'], p['longitude'])
        partner_distances.append((dist, p['id']))
    
    partner_distances.sort(key=lambda x: x[0])
    closest_dist, best_partner_id = partner_distances[0]
    
    # ETA Calculation at 25km/h avg city speed
    # ETA in minutes = (distance / 25) * 60
    eta_mins = round((closest_dist / 25) * 60)
    # Give a cushion framework natively
    eta_string = f"{max(5, eta_mins)}-{eta_mins + 15} mins"
    
    return best_partner_id, eta_string

def execute_routing(order_id):
    """Core Asynchronous Orchestration executed by ThreadPool."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        
        # 0. Fetch the order details
        cursor.execute("SELECT delivery_latitude, delivery_longitude, order_status FROM orders WHERE id = ?", (order_id,))
        order = cursor.fetchone()
        
        if not order:
            return
            
        # Prevent re-routing already packed/delivered strings.
        if order['order_status'] not in ['pending', 'routing', 'waiting_for_partner']:
            return
            
        lat = order['delivery_latitude'] or 22.8046 # fallback to default Jamshedpur center if undefined UI
        lon = order['delivery_longitude'] or 86.2029
        
        # 1. Store Mapping
        best_store_id = _find_best_store(cursor, lat, lon, order_id)
        
        if not best_store_id:
            # Fatal fallback -> inventory exhausted across all dark stores
            cursor.execute("UPDATE orders SET order_status = 'inventory_unavailable' WHERE id = ?", (order_id,))
            conn.commit()
            print(f"[Haversine Engine] Order {order_id} failed: Native Inventory Exhaustion.")
            return
        
        # 2. Reserve the inventory at this specific store
        cursor.execute("SELECT product_id, quantity FROM order_items WHERE order_id = ?", (order_id,))
        items = cursor.fetchall()
        for item in items:
            cursor.execute('''
                UPDATE store_inventory 
                SET reserved_stock = reserved_stock + ? 
                WHERE store_id = ? AND product_id = ?
            ''', (item['quantity'], best_store_id, item['product_id']))
            
        # 3. Rider Assignment
        partner_id, eta = _assign_delivery_partner(cursor, best_store_id)
        
        if partner_id:
            # Successfully paired Facility <-> Rider
            cursor.execute('''
                UPDATE orders 
                SET order_status = 'store_assigned', dark_store_id = ?, delivery_partner_id = ?, estimated_delivery = ? 
                WHERE id = ?
            ''', (best_store_id, partner_id, eta, order_id))
            
            # Lock the rider into busy mode
            cursor.execute('''
                UPDATE delivery_partners 
                SET status = 'BUSY', active_order_id = ? 
                WHERE id = ?
            ''', (order_id, partner_id))
            print(f"[Haversine Engine] Order {order_id} routed successfully to Store #{best_store_id} with Rider #{partner_id}. ETA: {eta}")
        else:
            # Store assigned, but no riders exist yet
            cursor.execute('''
                UPDATE orders 
                SET order_status = 'waiting_for_partner', dark_store_id = ? 
                WHERE id = ?
            ''', (best_store_id, order_id))
            print(f"[Haversine Engine] Order {order_id} blocked. Queueing wait loop.")
            
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[Haversine Engine] Exception processing order {order_id}: {e}")
    finally:
        conn.close()

def routeOrder(order_id):
    """Facade exposing the engine to Flask async queues."""
    routing_pool.submit(execute_routing, order_id)

def _routing_daemon_loop():
    """Background polling to re-attempt Rider mappings every 2 minutes."""
    print("[Haversine Engine] Auto-Retry Daemon Thread Started.")
    while True:
        time.sleep(120)  # Wait 2 minutes natively
        try:
            conn = get_db()
            cursor = conn.cursor()
            # Fetch all orders that had no available riders globally using SQLite constraints
            cursor.execute("SELECT id FROM orders WHERE order_status = 'waiting_for_partner'")
            stalled_orders = cursor.fetchall()
            conn.close()
            
            for o in stalled_orders:
                print(f"[Haversine Engine] Retrying gridlocked order {o['id']}")
                routeOrder(o['id'])
                
        except Exception as e:
            print(f"[Routing Daemon] Loop Exception: {e}")

def start_routing_daemon():
    """Spawns the native threading engine off the main Flask thread."""
    thread = threading.Thread(target=_routing_daemon_loop, daemon=True)
    thread.start()
