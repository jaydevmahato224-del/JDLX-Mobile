import sqlite3

def sync_policies():
    db_path = '/home/jaydev/Desktop/JDLX-Mobile/backend/jdlx.db'
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # 1. Add return_policy column to products if missing
    cursor.execute("PRAGMA table_info(products)")
    columns = [row[1] for row in cursor.fetchall()]
    if 'return_policy' not in columns:
        print("Adding return_policy column to products...")
        cursor.execute("ALTER TABLE products ADD COLUMN return_policy TEXT")
    
    # 2. Sync policies from categories
    print("Syncing product return policies from categories...")
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
    
    # 3. Verify
    cursor.execute("SELECT p.name, p.return_policy, c.name as cat_name FROM products p JOIN categories c ON p.category_id = c.id LIMIT 10")
    rows = cursor.fetchall()
    print("\nVerification (First 10 products):")
    for r in rows:
        policy_preview = (r[1][:50] + '...') if r[1] and len(r[1]) > 50 else r[1]
        print(f"Product: {r[0]} | Cat: {r[2]} | Policy: {policy_preview}")
        
    conn.close()

if __name__ == "__main__":
    sync_policies()
