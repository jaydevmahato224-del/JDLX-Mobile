import sqlite3
import os

DATABASE_PATH = 'jdlx.db'

def run_migration():
    print("Starting smart product ranking system migration...")
    
    if not os.path.exists(DATABASE_PATH):
        print(f"Error: Database {DATABASE_PATH} does not exist.")
        return

    try:
        conn = sqlite3.connect(DATABASE_PATH)
        cursor = conn.cursor()
        
        # Enable WAL mode for better concurrency
        cursor.execute("PRAGMA journal_mode=WAL;")
        
        # 1. Add new columns to products table
        print("Checking/adding columns to 'products' table...")
        cursor.execute("PRAGMA table_info(products)")
        existing_cols = [row[1] for row in cursor.fetchall()]
        
        new_cols = [
            ('views_count', 'INTEGER DEFAULT 0'),
            ('cart_add_count', 'INTEGER DEFAULT 0'),
            ('purchase_count', 'INTEGER DEFAULT 0'),
            ('wishlist_count', 'INTEGER DEFAULT 0'),
            ('total_sales', 'INTEGER DEFAULT 0')
        ]
        
        columns_added = 0
        for col_name, col_def in new_cols:
            if col_name not in existing_cols:
                try:
                    cursor.execute(f"ALTER TABLE products ADD COLUMN {col_name} {col_def}")
                    cursor.execute(f"UPDATE products SET {col_name} = 0")
                    print(f"Added column {col_name} to products table.")
                    columns_added += 1
                except sqlite3.OperationalError as e:
                    print(f"Notice: Column {col_name} might already exist or could not be added: {e}")
        
        if columns_added == 0:
            print("No new columns needed for products table.")
            
        # 2. Add product_views_history table
        print("\nCreating 'product_views_history' table...")
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS product_views_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        )
        ''')
        
        # Create an index for faster lookups
        cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_prod_views_user_id 
        ON product_views_history(user_id)
        ''')
        
        cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_prod_views_product_id 
        ON product_views_history(product_id)
        ''')

        conn.commit()
        print("\nMigration completed successfully!")
        
    except Exception as e:
        print(f"\nError during migration: {str(e)}")
        if conn:
            conn.rollback()
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    run_migration()
