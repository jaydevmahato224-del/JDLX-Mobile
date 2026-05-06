import sqlite3

def check_db():
    conn = sqlite3.connect('/home/jaydev/Desktop/JDLX-Mobile/backend/jdlx.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    print("--- Dark Stores ---")
    cursor.execute("SELECT id, name FROM dark_stores")
    stores = cursor.fetchall()
    for store in stores:
        print(f"ID: {store['id']}, Name: {store['name']}")

    print("\n--- Products ---")
    cursor.execute("SELECT id, name FROM products LIMIT 10")
    products = cursor.fetchall()
    for product in products:
        print(f"ID: {product['id']}, Name: {product['name']}")

    print("\n--- Store Inventory (First 20) ---")
    cursor.execute("SELECT * FROM store_inventory LIMIT 20")
    inventory = cursor.fetchall()
    for item in inventory:
        print(f"Store ID: {item['store_id']}, Product ID: {item['product_id']}, Stock: {item['stock_quantity']}")

    conn.close()

if __name__ == "__main__":
    check_db()
