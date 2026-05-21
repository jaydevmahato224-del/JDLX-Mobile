import sys
import os
import sqlite3

# Add current directory to path so we can import from local modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import init_db, get_db
from utils.token_gen import generate_share_token

def backfill_share_tokens():
    print("Initializing database...")
    init_db()
    
    conn = get_db()
    cursor = conn.cursor()
    
    print("Fetching products without share tokens...")
    cursor.execute("SELECT id, name FROM products WHERE share_token IS NULL")
    products = cursor.fetchall()
    
    if not products:
        print("All products already have share tokens.")
        conn.close()
        return

    print(f"Generating tokens for {len(products)} products...")
    
    updated_count = 0
    for product in products:
        product_id = product['id']
        token = generate_share_token()
        
        # Ensure uniqueness (though highly unlikely to collide)
        attempts = 0
        while attempts < 10:
            try:
                cursor.execute("UPDATE products SET share_token = ? WHERE id = ?", (token, product_id))
                conn.commit()
                updated_count += 1
                break
            except sqlite3.IntegrityError:
                token = generate_share_token()
                attempts += 1
    
    print(f"Successfully backfilled {updated_count} product share tokens.")
    
    print("Creating unique index on share_token...")
    try:
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_products_share_token ON products(share_token)")
        conn.commit()
        print("Unique index created successfully.")
    except Exception as e:
        print(f"Failed to create unique index: {e}")
        
    conn.close()

if __name__ == "__main__":
    backfill_share_tokens()
