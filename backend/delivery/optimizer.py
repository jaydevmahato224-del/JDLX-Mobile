import math

def calculate_distance(lat1, lon1, lat2, lon2):
    """
    Calculate the great circle distance between two points 
    on the earth (specified in decimal degrees)
    """
    # Convert decimal degrees to radians 
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])

    # Haversine formula 
    dlon = lon2 - lon1 
    dlat = lat2 - lat1 
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a)) 
    r = 6371 # Radius of earth in kilometers. Use 3956 for miles
    return c * r

def estimate_delivery_time(distance_km, avg_speed_kmh=15, packing_time_mins=6):
    """
    Estimate delivery time in minutes with a more realistic hyperlocal model.
    """
    # Base travel time
    travel_time_mins = (distance_km / avg_speed_kmh) * 60
    
    # Add a factor for traffic/signals/turns (e.g. 1.3x)
    # Hyperlocal routes are often slower than straight lines
    travel_time_mins *= 1.3
    
    # Total time = Packing + Buffer + Travel
    # Minimum 12 minutes for even very short distances to account for handover/handoff
    total_time_mins = travel_time_mins + packing_time_mins
    
    return max(12, round(total_time_mins))

def select_best_store(user_lat, user_lng, stores, avg_speed_kmh=20, packing_time_mins=3):
    """
    Select the store with the minimum estimated delivery time.
    """
    best_store = None
    min_time = float('inf')

    for store in stores:
        dist = calculate_distance(user_lat, user_lng, store['latitude'], store['longitude'])
        est_time = estimate_delivery_time(dist, avg_speed_kmh, packing_time_mins)
        
        if est_time < min_time:
            min_time = est_time
            best_store = {
                **dict(store),
                'estimated_time': est_time,
                'distance': round(dist, 2)
            }
            
    return best_store
