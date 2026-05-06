import sqlite3
import datetime

DATABASE_PATH = 'jdlx.db'

def migrate():
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    print("Starting category migration...")

    # 1. Create categories table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            icon TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    print("Categories table created (if not existed).")

    # 2. Check if category_id exists in products
    cursor.execute("PRAGMA table_info(products)")
    columns = [column[1] for column in cursor.fetchall()]
    
    if 'category_id' not in columns:
        print("Adding column: category_id to products")
        cursor.execute("ALTER TABLE products ADD COLUMN category_id INTEGER")
    else:
        print("category_id already exists in products.")

    # 3. Migrate existing distinct categories from products to the categories table
    cursor.execute("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != ''")
    existing_categories = cursor.fetchall()

    category_map = {} # Maps category_name -> category_id
    
    for row in existing_categories:
        cat_name = row[0]
        # Check if already in categories table
        cursor.execute("SELECT id FROM categories WHERE name = ?", (cat_name,))
        cat_row = cursor.fetchone()
        
        if not cat_row:
            # Insert and get id
            # Assigning some default icons based on name might be tricky here, so we leave it empty for now, or use a placeholder
            default_icon = "https://img.freepik.com/free-vector/box-packaging-delivery-icon_24877-50143.jpg" # Generic placeholder
            cursor.execute("INSERT INTO categories (name, icon) VALUES (?, ?)", (cat_name, default_icon))
            cat_id = cursor.lastrowid
            print(f"Migrated category: {cat_name} with ID {cat_id}")
        else:
            cat_id = cat_row[0]
            print(f"Category already exists: {cat_name} with ID {cat_id}")
            
        category_map[cat_name] = cat_id

    # 4. Update products with category_id
    for cat_name, cat_id in category_map.items():
         cursor.execute("UPDATE products SET category_id = ? WHERE category = ?", (cat_id, cat_name))
         
    conn.commit()
    conn.close()
    print("Category migration completed successfully.")

if __name__ == "__main__":
    migrate()
