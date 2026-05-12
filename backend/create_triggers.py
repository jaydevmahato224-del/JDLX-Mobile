import sqlite3
import os

db_path = 'backend/jdlx.db'
if not os.path.exists(db_path):
    db_path = 'jdlx.db'

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# 1. Trigger to sync available_stock in warehouse_inventory
cursor.execute('''
CREATE TRIGGER IF NOT EXISTS sync_available_stock_update
AFTER UPDATE OF stock_quantity, reserved_stock ON warehouse_inventory
BEGIN
    UPDATE warehouse_inventory 
    SET available_stock = MAX(0, stock_quantity - reserved_stock)
    WHERE id = NEW.id;
END;
''')

# 2. Trigger to sync available_stock on insert
cursor.execute('''
CREATE TRIGGER IF NOT EXISTS sync_available_stock_insert
AFTER INSERT ON warehouse_inventory
BEGIN
    UPDATE warehouse_inventory 
    SET available_stock = MAX(0, stock_quantity - reserved_stock)
    WHERE id = NEW.id;
END;
''')

# 3. Trigger to sync global products.stock on warehouse_inventory change
cursor.execute('''
CREATE TRIGGER IF NOT EXISTS sync_global_stock_update
AFTER UPDATE OF available_stock ON warehouse_inventory
BEGIN
    UPDATE products
    SET stock = (SELECT COALESCE(SUM(available_stock), 0) FROM warehouse_inventory WHERE product_id = NEW.product_id)
    WHERE id = NEW.product_id;
END;
''')

# 4. Trigger to sync global products.stock on warehouse_inventory insert
cursor.execute('''
CREATE TRIGGER IF NOT EXISTS sync_global_stock_insert
AFTER INSERT ON warehouse_inventory
BEGIN
    UPDATE products
    SET stock = (SELECT COALESCE(SUM(available_stock), 0) FROM warehouse_inventory WHERE product_id = NEW.product_id)
    WHERE id = NEW.product_id;
END;
''')

conn.commit()
conn.close()
print("Stock sync triggers created successfully.")
