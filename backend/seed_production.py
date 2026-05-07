import sqlite3

from database import get_db, init_db


def count_rows(cursor, table_name):
    cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
    return cursor.fetchone()[0]


def seed_categories(cursor):
    categories = [
        (1, "Dairy", "milk"),
        (2, "Fruits", "apple"),
        (3, "Bakery", "bread"),
        (4, "Tech", "device"),
        (5, "Essentials", "home"),
    ]
    cursor.executemany(
        "INSERT OR IGNORE INTO categories (id, name, icon) VALUES (?, ?, ?)",
        categories,
    )


def seed_store(cursor):
    cursor.execute(
        """
        INSERT OR IGNORE INTO dark_stores
        (store_code, name, latitude, longitude, address, pincode, active, manager_name, phone)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "DS001",
            "JDLX Central Store",
            28.6139,
            77.2090,
            "Connaught Place, New Delhi",
            "110001",
            1,
            "Admin",
            "9876543210",
        ),
    )


def seed_products(cursor):
    products = [
        ("Premium Cow Milk 1L", 65.0, 50, 1, "Dairy", "10-15 mins", "available", "https://images.unsplash.com/photo-1563636619-e9143da7973b?w=800"),
        ("Organic Eggs Box of 6", 90.0, 30, 1, "Dairy", "10 mins", "available", "https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=800"),
        ("Artisan Sourdough Bread", 120.0, 15, 3, "Bakery", "20 mins", "available", "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800"),
        ("Alphonso Mango Pack of 2", 250.0, 40, 2, "Fruits", "15 mins", "available", "https://images.unsplash.com/photo-1553279768-865429fa0078?w=800"),
        ("Red Delicious Apple 1kg", 180.0, 25, 2, "Fruits", "15 mins", "available", "https://images.unsplash.com/photo-1567306226416-28f0efdc88ce?w=800"),
        ("Amul Butter 500g", 270.0, 100, 1, "Dairy", "10 mins", "available", "https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=800"),
        ("Gadget Cleaner Kit", 350.0, 20, 4, "Tech", "25 mins", "available", "https://images.unsplash.com/photo-1588702547919-26089e690ecc?w=800"),
        ("Essential Oil Diffuser", 899.0, 10, 5, "Essentials", "30 mins", "available", "https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?w=800"),
    ]
    cursor.executemany(
        """
        INSERT OR IGNORE INTO products
        (name, price, stock, category_id, category, delivery_time, status, images)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        products,
    )


def seed_if_empty():
    init_db()
    conn = get_db()
    try:
        cursor = conn.cursor()
        seeded = False

        if count_rows(cursor, "categories") == 0:
            seed_categories(cursor)
            seeded = True

        if count_rows(cursor, "dark_stores") == 0:
            seed_store(cursor)
            seeded = True

        if count_rows(cursor, "products") == 0:
            seed_products(cursor)
            seeded = True

        if seeded:
            conn.commit()
            print("Production seed completed with missing initial data.")
        else:
            print("Production seed skipped; database already has initial data.")
    except sqlite3.Error:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    seed_if_empty()
