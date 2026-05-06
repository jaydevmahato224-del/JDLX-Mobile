import sqlite3
import datetime

DATABASE_PATH = 'jdlx.db'

def migrate():
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    print("Starting migration...")
    
    # Check existing columns in products table
    cursor.execute("PRAGMA table_info(products)")
    columns = [column[1] for column in cursor.fetchall()]
    
    # Remove legacy product stock_quantity column if present and sync values into stock
    if 'stock_quantity' in columns:
        print("Migrating legacy stock_quantity into stock and dropping legacy column")
        cursor.execute(
            "UPDATE products SET stock = CASE WHEN (stock IS NULL OR stock = 0) AND stock_quantity > 0 THEN stock_quantity ELSE stock END"
        )
        if sqlite3.sqlite_version_info >= (3, 35, 0):
            try:
                cursor.execute("ALTER TABLE products DROP COLUMN stock_quantity")
            except Exception:
                print("WARNING: SQLite version does not support DROP COLUMN; legacy column preserved but no longer used")
        else:
            try:
                cursor.execute('''
                    CREATE TABLE products_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        price REAL NOT NULL,
                        stock INTEGER NOT NULL DEFAULT 0,
                        low_stock_threshold INTEGER DEFAULT 5,
                        category TEXT,
                        category_id INTEGER,
                        delivery_time TEXT DEFAULT '30-120 mins',
                        status TEXT DEFAULT 'available',
                        images TEXT,
                        last_updated TIMESTAMP,
                        created_at TIMESTAMP,
                        FOREIGN KEY(category_id) REFERENCES categories(id)
                    )
                ''')
                cursor.execute('''
                    INSERT INTO products_new (id, name, price, stock, low_stock_threshold, category, category_id, delivery_time, status, images, last_updated, created_at)
                    SELECT id, name, price, stock, low_stock_threshold, category, category_id, delivery_time, status, images, last_updated, created_at
                    FROM products
                ''')
                cursor.execute('DROP TABLE products')
                cursor.execute('ALTER TABLE products_new RENAME TO products')
            except Exception:
                print("WARNING: Legacy column could not be dropped in this SQLite version")

    # Add low_stock_threshold if it doesn't exist
    if 'low_stock_threshold' not in columns:
        print("Adding column: low_stock_threshold")
        cursor.execute("ALTER TABLE products ADD COLUMN low_stock_threshold INTEGER DEFAULT 5")
    
    # Add last_updated if it doesn't exist
    if 'last_updated' not in columns:
        print("Adding column: last_updated")
        cursor.execute("ALTER TABLE products ADD COLUMN last_updated TIMESTAMP")
        # Update last_updated with current time for existing rows
        now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        cursor.execute("UPDATE products SET last_updated = ?", (now,))
    
    conn.commit()
    conn.close()
    print("Migration completed successfully.")

if __name__ == "__main__":
    migrate()
