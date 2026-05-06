import sqlite3
import os

DATABASE_PATH = 'backend/jdlx.db'

def seed_everything():
    if not os.path.exists(DATABASE_PATH):
        # try root if backend/ isn't there
        if os.path.exists('jdlx.db'):
            path = 'jdlx.db'
        else:
            print(f"Error: {DATABASE_PATH} not found.")
            return
    else:
        path = DATABASE_PATH

    print(f"Seeding database at {path}...")
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # 1. Seed Category
    categories = [
        ('1', 'Dairy', '🥛'),
        ('2', 'Fruits', '🍎'),
        ('3', 'Bakery', '🍞'),
        ('4', 'Tech', '💻'),
        ('5', 'Essentials', '🏠')
    ]
    cursor.executemany("INSERT OR IGNORE INTO categories (id, name, icon) VALUES (?, ?, ?)", categories)

    # 2. Seed Dark Store (MUST have at least one active for the shop to open)
    dark_stores = [
        ('JDLX Central Store', 28.6139, 77.2090, 'Connaught Place, New Delhi', 1, 'Admin', '9876543210', 'DS001')
    ]
    cursor.executemany(
        "INSERT OR IGNORE INTO dark_stores (name, latitude, longitude, address, active, manager_name, phone, store_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        dark_stores
    )

    # 3. Seed Products
    products = [
        ("Premium Cow Milk 1L", 65.0, 50, "Dairy", "10-15 mins", "available", "https://img.freepik.com/free-photo/fresh-milk-glass-jug-wood-table_1150-17634.jpg"),
        ("Organic Eggs (Box of 6)", 90.0, 30, "Dairy", "10 mins", "available", "https://img.freepik.com/free-photo/eggs_1203-2415.jpg"),
        ("Artisan Sourdough Bread", 120.0, 15, "Bakery", "20 mins", "available", "https://img.freepik.com/free-photo/bread-isolated-white-background_1203-9065.jpg"),
        ("Alphonso Mango (Pack of 2)", 250.0, 40, "Fruits", "15 mins", "available", "https://img.freepik.com/free-photo/mango-fruit-isolated-white-background_1203-6058.jpg"),
        ("Red Delicious Apple 1kg", 180.0, 25, "Fruits", "15 mins", "available", "https://img.freepik.com/free-photo/red-apple_1203-6058.jpg"),
        ("Pure Amul Butter 500g", 270.0, 100, "Dairy", "10 mins", "available", "https://img.freepik.com/free-photo/butter_1203-2424.jpg"),
        ("Gadget Cleaner Kit", 350.0, 20, "Tech", "25 mins", "available", "https://img.freepik.com/free-photo/computer-cleaning-service-concept_1150-17634.jpg"),
        ("Essential Oil Diffuser", 899.0, 10, "Essentials", "30 mins", "available", "https://img.freepik.com/free-photo/aroma-oil-diffuser_1150-17634.jpg")
    ]
    
    # Add more products to make infinite scroll visible (need at least 20+ if pageSize is 20)
    for i in range(1, 40):
        products.append((f"Mock Category {i%5+1} Product {i}", 100.0 + i*10, 10, f"Category {i%5+1}", "15 mins", "available", "https://placehold.co/400x400/0D1B2A/FFFFFF?text=Product"))

    cursor.executemany(
        "INSERT OR IGNORE INTO products (name, price, stock, category, delivery_time, status, images) VALUES (?, ?, ?, ?, ?, ?, ?)",
        products
    )

    conn.commit()
    conn.close()
    print("Database seeded successfully with Store and Products!")

if __name__ == "__main__":
    seed_everything()
