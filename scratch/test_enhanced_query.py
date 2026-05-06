import sqlite3

def test_query():
    conn = sqlite3.connect('/home/jaydev/Desktop/JDLX-Mobile/backend/jdlx.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    store_id = 1000
    query = """
            SELECT 
                p.id, 
                p.name, 
                p.price, 
                COALESCE(si.stock_quantity, wi.stock_quantity, 0) as stock_quantity 
            FROM products p
            LEFT JOIN store_inventory si ON p.id = si.product_id AND si.store_id = ?
            LEFT JOIN dark_stores ds ON ds.id = ?
            LEFT JOIN warehouses w ON w.warehouse_name = ds.name
            LEFT JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = w.id
    """
    cursor.execute(query, (store_id, store_id))
    results = cursor.fetchall()
    
    print(f"Results for Store {store_id}:")
    for row in results:
        print(f"ID: {row['id']}, Name: {row['name']}, Stock: {row['stock_quantity']}")

    conn.close()

if __name__ == "__main__":
    test_query()
