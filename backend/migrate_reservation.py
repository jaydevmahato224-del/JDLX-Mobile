import sqlite3
import os

db_path = 'backend/jdlx.db'
if not os.path.exists(db_path):
    db_path = 'jdlx.db'

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# 1. Add updated_at to cart
cursor.execute('PRAGMA table_info(cart)')
cols = [r[1] for r in cursor.fetchall()]
if 'updated_at' not in cols:
    cursor.execute('ALTER TABLE cart ADD COLUMN updated_at TIMESTAMP')
    cursor.execute('UPDATE cart SET updated_at = created_at')
    print('Added updated_at to cart')

# 2. Ensure warehouse_inventory has available_stock and reserved_stock
cursor.execute('PRAGMA table_info(warehouse_inventory)')
cols = [r[1] for r in cursor.fetchall()]
if 'available_stock' not in cols:
    cursor.execute('ALTER TABLE warehouse_inventory ADD COLUMN available_stock INTEGER DEFAULT 0')
    print('Added available_stock to warehouse_inventory')
if 'reserved_stock' not in cols:
    cursor.execute('ALTER TABLE warehouse_inventory ADD COLUMN reserved_stock INTEGER DEFAULT 0')
    print('Added reserved_stock to warehouse_inventory')

conn.commit()
conn.close()
