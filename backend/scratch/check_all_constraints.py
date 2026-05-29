"""Check all table schemas in Turso for remaining CHECK constraints."""
import os
import sys
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env'))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from database import get_db

conn = get_db()
cursor = conn.cursor()

cursor.execute("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name")
rows = cursor.fetchall()

print("Tables with CHECK constraints in Turso:\n")
for row in rows:
    name = row[0] if isinstance(row, tuple) else row['name']
    sql = row[1] if isinstance(row, tuple) else row['sql']
    if sql and 'CHECK' in sql.upper():
        print(f"  TABLE: {name}")
        # Extract the CHECK parts
        for line in sql.split('\n'):
            if 'CHECK' in line.upper():
                print(f"    {line.strip()}")
        print()

conn.close()
