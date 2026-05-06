import sqlite3

DATABASE_PATH = 'jdlx.db'

def seed_products():
    products = [
        ("Fresh Milk 1L", 65.0, 50, "Dairy", "15 mins", "available", "https://img.freepik.com/free-photo/fresh-milk-glass-jug-wood-table_1150-17634.jpg"),
        ("Farm Eggs 6pcs", 45.0, 30, "Dairy", "10 mins", "available", "https://img.freepik.com/free-photo/eggs_1203-2415.jpg"),
        ("Whole Wheat Bread", 40.0, 20, "Bakery", "20 mins", "available", "https://img.freepik.com/free-photo/bread-isolated-white-background_1203-9065.jpg"),
        ("Banana 1kg", 55.0, 40, "Fruits", "15 mins", "available", "https://img.freepik.com/free-photo/bananas_1203-6250.jpg"),
        ("Red Apple 500g", 120.0, 25, "Fruits", "15 mins", "available", "https://img.freepik.com/free-photo/red-apple_1203-6058.jpg"),
        ("Amul Butter 100g", 56.0, 100, "Dairy", "10 mins", "available", "https://img.freepik.com/free-photo/butter_1203-2424.jpg")
    ]

    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    cursor.executemany(
        "INSERT OR IGNORE INTO products (name, price, stock, category, delivery_time, status, images) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [(p[0], p[1], p[2], p[3], p[4], p[5], p[6]) for p in products]
    )
    
    conn.commit()
    conn.close()
    print("Database seeded with initial products.")

def seed_users():
    users = [
        ("test_google_id", "Test User", "test@example.com", "https://img.freepik.com/free-icon/user_318-159711.jpg")
    ]
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    cursor.executemany(
        "INSERT OR IGNORE INTO users (google_id, name, email, profile_image) VALUES (?, ?, ?, ?)",
        users
    )
    conn.commit()
    conn.close()
    print("Database seeded with initial users.")

if __name__ == "__main__":
    seed_products()
    seed_users()
