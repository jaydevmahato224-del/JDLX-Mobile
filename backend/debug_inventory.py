import sqlite3

def check_inventory():
    conn = sqlite3.connect('jdlx.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT 
                p.id, 
                p.name as product_name, 
                p.price, 
                p.category,
                p.barcode as sku,
                wi.stock_quantity as stock, 
                wi.reserved_stock,
                wi.low_stock_threshold,
                wi.status,
                w.warehouse_name as store_name,
                w.partner_id as store_code
            FROM products p
            LEFT JOIN warehouse_inventory wi ON p.id = wi.product_id
            LEFT JOIN warehouses w ON wi.warehouse_id = w.id
            ORDER BY w.warehouse_name ASC, p.name ASC
        """)
        rows = cursor.fetchall()
        print(f"Total rows: {len(rows)}")
        for i, row in enumerate(rows[:5]):
            print(f"{i+1}: {dict(row)}")
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    check_inventory()
