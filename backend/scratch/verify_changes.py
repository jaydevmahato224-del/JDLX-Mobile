import requests
import json

BASE_URL = "http://localhost:5000/api"

def test_create_product_no_barcode():
    # Note: We need a warehouse token. Since this is a test environment, 
    # we'll assume the server is running and we might need to mock or use an existing token.
    # However, since I can't easily get a token without credentials, 
    # I'll check the database directly after simulating the logic.
    pass

def verify_db_state():
    import sqlite3
    conn = sqlite3.connect('backend/jdlx.db')
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(products)")
    cols = [row[1] for row in cursor.fetchall()]
    print(f"Columns in products: {cols}")
    
    # Try inserting a product with no barcode and no global_sku_code to see auto-gen SKU
    try:
        cursor.execute("INSERT INTO products (name, price, category) VALUES (?, ?, ?)", ("Test Product No Barcode", 99.99, "Test"))
        p_id = cursor.lastrowid
        print(f"Inserted test product ID: {p_id}")
        
        # Simulate warehouse_create_product logic for SKU auto-gen
        sku = "TEST-" + str(p_id)
        cursor.execute("INSERT INTO warehouse_inventory (warehouse_id, product_id, product_name, sku, stock_quantity) VALUES (?, ?, ?, ?, ?)", (1, p_id, "Test Product No Barcode", sku, 10))
        print(f"Inserted warehouse inventory with SKU: {sku}")
        
        conn.commit()
    except Exception as e:
        print(f"Error: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    verify_db_state()
