import sqlite3

conn = sqlite3.connect('jdlx.db')
cursor = conn.cursor()

cursor.execute("SELECT id, name, stock FROM products WHERE name LIKE 'Realme 5%'")
products = cursor.fetchall()

print("Products table:")
for p in products:
    print(p)

cursor.execute("""
    SELECT wi.product_id, p.name, wi.stock_quantity, wi.reserved_stock, wi.available_stock 
    FROM warehouse_inventory wi
    JOIN products p ON wi.product_id = p.id
    WHERE p.name LIKE 'Realme 5%'
""")
inventory = cursor.fetchall()

print("\nWarehouse Inventory:")
for i in inventory:
    print(i)

conn.close()
