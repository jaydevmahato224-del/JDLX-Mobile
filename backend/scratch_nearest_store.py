import sqlite3
import math

def calculate_distance(lat1, lon1, lat2, lon2):
    R = 6371  # Radius of the earth in km
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = math.sin(dLat / 2) * math.sin(dLat / 2) + \
        math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * \
        math.sin(dLon / 2) * math.sin(dLon / 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

conn = sqlite3.connect('/home/jaydev/Desktop/JDLX-Mobile/backend/jdlx.db')
conn.row_factory = sqlite3.Row
stores = conn.execute("SELECT id, name, latitude, longitude FROM dark_stores WHERE active=1").fetchall()

print("Available Dark Stores:")
for s in stores:
    print(dict(s))
conn.close()
