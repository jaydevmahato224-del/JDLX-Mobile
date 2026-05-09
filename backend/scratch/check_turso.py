import libsql_experimental as libsql
import os
from dotenv import load_dotenv

load_dotenv()

url = os.environ.get("TURSO_DATABASE_URL")
token = os.environ.get("TURSO_AUTH_TOKEN")

if not url or not token:
    print("Missing Turso URL or Token")
    exit(1)

conn = libsql.connect(url, auth_token=token)
cursor = conn.cursor()

try:
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = cursor.fetchall()
    print("Tables in database:")
    for table in tables:
        print(f" - {table[0]}")
    
    if any(table[0] == 'warehouses' for table in tables):
        cursor.execute("SELECT COUNT(*) FROM warehouses")
        count = cursor.fetchone()[0]
        print(f"\nTotal warehouses: {count}")
    else:
        print("\n'warehouses' table DOES NOT EXIST!")
        
except Exception as e:
    print(f"Error checking database: {e}")

conn.close()
