import datetime

def update_rider_location(cursor, delivery_partner_id, latitude, longitude):
    """
    Update or insert the latest GPS location for a delivery partner.
    """
    cursor.execute("""
        INSERT INTO delivery_locations (delivery_partner_id, latitude, longitude, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(delivery_partner_id) DO UPDATE SET
            latitude = excluded.latitude,
            longitude = excluded.longitude,
            updated_at = CURRENT_TIMESTAMP
    """, (delivery_partner_id, latitude, longitude))

def get_rider_location(cursor, order_id):
    """
    Get the current GPS location of the rider assigned to a specific order.
    """
    cursor.execute("""
        SELECT dl.latitude, dl.longitude, dl.updated_at
        FROM orders o
        JOIN delivery_locations dl ON o.delivery_partner_id = dl.delivery_partner_id
        WHERE o.id = ?
    """, (order_id,))
    row = cursor.fetchone()
    return dict(row) if row else None
