import sqlite3

def check_and_sync():
    conn = sqlite3.connect('/home/jaydev/Desktop/JDLX-Mobile/backend/jdlx.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 1. Check categories with policies
    print("Categories with Policies:")
    cats = cursor.execute("SELECT id, name, return_policy FROM categories").fetchall()
    for c in cats:
        print(f"ID: {c['id']}, Name: {c['name']}, Policy: {c['return_policy']}")
    
    # 2. Count products with empty policies
    empty_count = cursor.execute("SELECT COUNT(*) FROM products WHERE return_policy IS NULL OR return_policy = ''").fetchone()[0]
    print(f"\nProducts with empty return_policy: {empty_count}")
    
    # 3. Sync products with category policies
    print("\nSyncing products...")
    cursor.execute("""
        UPDATE products 
        SET return_policy = (
            SELECT return_policy 
            FROM categories 
            WHERE categories.id = products.category_id
        )
        WHERE (return_policy IS NULL OR return_policy = '')
        AND category_id IN (SELECT id FROM categories WHERE return_policy IS NOT NULL AND return_policy != '')
    """)
    conn.commit()
    print(f"Updated {cursor.rowcount} products.")
    
    conn.close()

if __name__ == "__main__":
    check_and_sync()
