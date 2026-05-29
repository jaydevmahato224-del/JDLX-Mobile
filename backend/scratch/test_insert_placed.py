import os
import sys
import uuid
from dotenv import load_dotenv

# Load env variables from .env file
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

# Add parent directory to path to import database.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from database import get_db, USE_TURSO, TURSO_URL, DATABASE_PATH

def test_insert():
    print("USE_TURSO:", USE_TURSO)
    print("TURSO_URL:", TURSO_URL)
    print("DATABASE_PATH:", DATABASE_PATH)
    conn = get_db()
    cursor = conn.cursor()
    try:
        order_number = f"TEST-{uuid.uuid4().hex[:8].upper()}"
        cursor.execute('''
            INSERT INTO orders (
                order_number, user_id, customer_name, customer_phone, delivery_address, 
                order_status, total_amount, dark_store_id, estimated_delivery, 
                delivery_latitude, delivery_longitude, payment_status, delivery_type,
                platform_fee, delivery_fee, fitting_charge, payment_type,
                cod_advance_paid, cod_remaining_amount, free_delivery_applied
            )
            VALUES (?, 1, 'Test User', '1234567890', 'Test Address', 'PLACED', 100.0, 1, '30 mins', 28.6139, 77.2090, 'pending', 'quick', 7.0, 49.0, 0.0, 'COD', 49.0, 51.0, 0)
        ''', (order_number,))
        conn.commit()
        print("Success! Order inserted successfully.")
    except Exception as e:
        print("Error inserting order:")
        print(type(e), str(e))
    finally:
        conn.close()

if __name__ == '__main__':
    test_insert()
