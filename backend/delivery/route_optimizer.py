import math

def calculate_distance(lat1, lon1, lat2, lon2):
    """
    Calculate the Haversine distance between two points in kilometers.
    """
    R = 6371  # Earth radius in km
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (math.sin(d_lat / 2) * math.sin(d_lat / 2) +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(d_lon / 2) * math.sin(d_lon / 2))
    c = 2 * math.asin(math.sqrt(a))
    return R * c

def estimate_travel_time(distance_km, avg_speed_kmh=25):
    """
    Estimate travel time in minutes based on distance and average speed.
    Considers basic traffic overhead (1.2 multiplier).
    """
    if distance_km == 0:
        return 0
    time_hours = distance_km / avg_speed_kmh
    time_minutes = time_hours * 60
    return round(time_minutes * 1.2)  # 20% traffic buffer

def calculate_shortest_route(rider_coords, store_coords, customer_coords, order_status):
    """
    Determines the path and distances based on current order status.
    Statuses: PLACED, PACKING, READY_FOR_PICKUP, OUT_FOR_DELIVERY, DELIVERED
    """
    # Legend: R=Rider, S=Store, C=Customer
    
    legs = []
    
    if order_status in ['PLACED', 'PACKING', 'READY_FOR_PICKUP']:
        # Route: Rider -> Store -> Customer
        dist_r_s = calculate_distance(rider_coords[0], rider_coords[1], store_coords[0], store_coords[1])
        dist_s_c = calculate_distance(store_coords[0], store_coords[1], customer_coords[0], customer_coords[1])
        
        legs.append({"from": "Rider", "to": "Store", "distance": round(dist_r_s, 2), "time": estimate_travel_time(dist_r_s)})
        legs.append({"from": "Store", "to": "Customer", "distance": round(dist_s_c, 2), "time": estimate_travel_time(dist_s_c)})
        
        total_dist = dist_r_s + dist_s_c
        route_desc = "Rider -> Store -> Customer"
        
    elif order_status == 'OUT_FOR_DELIVERY':
        # Route: Rider -> Customer (Rider is likely already at store or on way to customer)
        dist_r_c = calculate_distance(rider_coords[0], rider_coords[1], customer_coords[0], customer_coords[1])
        
        legs.append({"from": "Rider", "to": "Customer", "distance": round(dist_r_c, 2), "time": estimate_travel_time(dist_r_c)})
        
        total_dist = dist_r_c
        route_desc = "Rider -> Customer"
        
    else: # DELIVERED or unknown
        total_dist = 0
        route_desc = "Delivered"

    return {
        "route": route_desc,
        "legs": legs,
        "total_distance": round(total_dist, 2),
        "total_time": estimate_travel_time(total_dist)
    }
