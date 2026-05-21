import sys
import os
import sqlite3

# Add current directory to path so we can import from local modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import init_db, get_db
from utils.product_url_utils import (
    generate_share_token, 
    generate_seo_slug,
    repair_product_data
)

def backfill_share_tokens():
    print("Initializing database...")
    init_db()
    
    conn = get_db()
    cursor = conn.cursor()
    
    print("Repairing and backfilling product slugs and tokens...")
    repaired_count = repair_product_data(cursor)
    conn.commit()
    print(f"Successfully processed and repaired {repaired_count} products.")
    
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
