import os
import sys
from dotenv import load_dotenv

# Load env variables from .env file
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

# Add parent directory to path to import database.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from database import get_db

def check_data():
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id, order_number, order_status, payment_status FROM orders LIMIT 5")
        rows = cursor.fetchall()
        print("First 5 orders:")
        for row in rows:
            r = dict(row)
            print(f"ID: {r['id']} (type: {type(r['id'])}), Order Status: {r['order_status']}, Payment Status: {r['payment_status']}")
            
        cursor.execute("SELECT DISTINCT order_status FROM orders")
        statuses = cursor.fetchall()
        print("\nDistinct order statuses in Turso:")
        for s in statuses:
            print(s[0] if isinstance(s, tuple) else s['order_status'])
            
        cursor.execute("SELECT DISTINCT payment_status FROM orders")
        p_statuses = cursor.fetchall()
        print("\nDistinct payment statuses in Turso:")
        for ps in p_statuses:
            print(ps[0] if isinstance(ps, tuple) else ps['payment_status'])
    except Exception as e:
        print("Error checking data:", e)
    finally:
        conn.close()

if __name__ == '__main__':
    check_data()
