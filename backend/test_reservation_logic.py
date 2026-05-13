import sqlite3
import os

def test_logic():
    db_path = 'backend/jdlx.db'
    if not os.path.exists(db_path):
        db_path = 'jdlx.db'
        
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    p_id = None
    wh_id = None
    
    try:
        # 1. Setup test product
        print("--- Setting up test data ---")
        cursor.execute("INSERT INTO products (name, price, stock) VALUES ('Test Product Reservation', 10.0, 0)")
        p_id = cursor.lastrowid
        
        # We need a warehouse to test warehouse_inventory triggers
        cursor.execute("INSERT INTO warehouses (warehouse_name, email, owner_name) VALUES ('Test WH Reservation', 'test_res@example.com', 'Test Owner')")
        wh_id = cursor.lastrowid
        
        cursor.execute("INSERT INTO warehouse_inventory (warehouse_id, product_id, product_name, stock_quantity, reserved_stock) VALUES (?, ?, ?, 100, 0)", (wh_id, p_id, 'Test Product Reservation'))
        conn.commit()

        # Verify initial state (Triggers should have synced global stock)
        cursor.execute("SELECT stock FROM products WHERE id = ?", (p_id,))
        global_stock = cursor.fetchone()['stock']
        print(f"Initial global stock: {global_stock}")
        assert global_stock == 100, f"Expected 100, got {global_stock}"

        # 2. Test Placement (Hard Reservation)
        print("\n--- Testing Order Placement (Hard Reservation) ---")
        qty = 5
        cursor.execute("UPDATE warehouse_inventory SET reserved_stock = reserved_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE warehouse_id = ? AND product_id = ?", (qty, wh_id, p_id))
        conn.commit()
        
        cursor.execute("SELECT available_stock FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?", (wh_id, p_id))
        avail = cursor.fetchone()['available_stock']
        print(f"Available after placement: {avail}")
        assert avail == 95, f"Expected 95, got {avail}"
        
        cursor.execute("SELECT stock FROM products WHERE id = ?", (p_id,))
        global_stock = cursor.fetchone()['stock']
        print(f"Global stock after placement: {global_stock}")
        assert global_stock == 95, f"Expected 95, got {global_stock}"

        # 3. Test Delivery (Reducing Physical Stock and Hard Reservation)
        print("\n--- Testing Order Delivery ---")
        cursor.execute("""
            UPDATE warehouse_inventory 
            SET stock_quantity = stock_quantity - ?, 
                reserved_stock = reserved_stock - ?, 
                updated_at = CURRENT_TIMESTAMP 
            WHERE warehouse_id = ? AND product_id = ?
        """, (qty, qty, wh_id, p_id))
        conn.commit()
        
        cursor.execute("SELECT available_stock FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?", (wh_id, p_id))
        avail = cursor.fetchone()['available_stock']
        print(f"Available after delivery: {avail}")
        assert avail == 95, f"Expected 95, got {avail}"
        
        cursor.execute("SELECT stock_quantity FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?", (wh_id, p_id))
        phys = cursor.fetchone()['stock_quantity']
        print(f"Physical after delivery: {phys}")
        assert phys == 95, f"Expected 95, got {phys}"

        # 4. Test Cart (Soft Reservation)
        print("\n--- Testing Cart Addition (Soft Reservation) ---")
        cursor.execute("INSERT INTO cart (product_id, quantity, updated_at) VALUES (?, 10, CURRENT_TIMESTAMP)", (p_id,))
        conn.commit()
        
        # Adding to cart should NOT change products.stock or available_stock
        cursor.execute("SELECT stock FROM products WHERE id = ?", (p_id,))
        global_stock = cursor.fetchone()['stock']
        print(f"Global stock after cart addition: {global_stock}")
        assert global_stock == 95, f"Expected 95, got {global_stock}"

        # 5. Test Auto-Release
        print("\n--- Testing Auto-Release ---")
        # Artificially age the cart item
        cursor.execute("UPDATE cart SET updated_at = datetime('now', '-35 minutes') WHERE product_id = ?", (p_id,))
        conn.commit()
        
        # Run the release logic (simulated by the DELETE in update_server_cart)
        cursor.execute("DELETE FROM cart WHERE updated_at < datetime('now', '-30 minutes')")
        conn.commit()
        
        cursor.execute("SELECT COUNT(*) as cnt FROM cart WHERE product_id = ?", (p_id,))
        cnt = cursor.fetchone()['cnt']
        print(f"Cart count after auto-release: {cnt}")
        assert cnt == 0, f"Expected 0, got {cnt}"

        print("\n✓ ALL TESTS PASSED!")

    finally:
        # Clean up
        print("\n--- Cleaning up ---")
        cursor.execute("DELETE FROM cart WHERE product_id = ?", (p_id,))
        cursor.execute("DELETE FROM warehouse_inventory WHERE product_id = ?", (p_id,))
        cursor.execute("DELETE FROM products WHERE id = ?", (p_id,))
        cursor.execute("DELETE FROM warehouses WHERE id = ?", (wh_id,))
        conn.commit()
        conn.close()

if __name__ == "__main__":
    test_logic()
