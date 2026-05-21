import sys
import os
import sqlite3

# Add current directory to path so we can import from local modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import init_db, get_db
from utils.product_url_utils import (
    generate_share_token, 
    generate_seo_slug
)

def backfill_share_tokens():
    print("Initializing database...")
    init_db()
    
    conn = get_db()
    cursor = conn.cursor()
    
    # 1. Backfill share_token
    print("Fetching products without share tokens...")
    cursor.execute("SELECT id, name FROM products WHERE share_token IS NULL OR share_token = ''")
    products = cursor.fetchall()
    
    if products:
        print(f"Generating tokens for {len(products)} products...")
        updated_count = 0
        for product in products:
            product_id = product['id']
            token = generate_share_token()
            
            # Ensure uniqueness
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
    else:
        print("All products already have share tokens.")

    # 2. Backfill seo_slug
    print("Fetching products without SEO slugs...")
    cursor.execute("SELECT id, name FROM products WHERE seo_slug IS NULL OR seo_slug = ''")
    products = cursor.fetchall()
    
    if products:
        print(f"Generating SEO slugs for {len(products)} products...")
        updated_count = 0
        for product in products:
            product_id = product['id']
            slug = generate_product_slug(product['name'])
            cursor.execute("UPDATE products SET seo_slug = ? WHERE id = ?", (slug, product_id))
            updated_count += 1
        conn.commit()
        print(f"Successfully backfilled {updated_count} product SEO slugs.")
    else:
        print("All products already have SEO slugs.")
    
    print("Creating unique indexes...")
    try:
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_products_share_token ON products(share_token)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_products_seo_slug ON products(seo_slug)")
        conn.commit()
        print("Indexes created successfully.")
    except Exception as e:
        print(f"Failed to create indexes: {e}")
        
    conn.close()

if __name__ == "__main__":
    backfill_share_tokens()
