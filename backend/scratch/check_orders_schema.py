import os
import sys
from dotenv import load_dotenv

# Load env variables from .env file
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

# Add parent directory to path to import database.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from database import get_db

def check_schema():
    conn = get_db()
    cursor = conn.cursor()
    try:
        # Get orders schema
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'")
        row = cursor.fetchone()
        if row:
            print("Orders Table SQL:")
            print(row[0] if isinstance(row, tuple) else row['sql'])
        else:
            print("Orders table not found!")
    except Exception as e:
        print("Error fetching schema:", e)
    finally:
        conn.close()

if __name__ == '__main__':
    check_schema()
