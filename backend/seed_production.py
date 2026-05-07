import json
import sqlite3
from pathlib import Path

from database import get_db, init_db


SEED_PATH = Path(__file__).with_name("catalog_seed.json")
DEMO_PRODUCT_NAMES = {
    "Premium Cow Milk 1L",
    "Organic Eggs Box of 6",
    "Artisan Sourdough Bread",
    "Alphonso Mango Pack of 2",
    "Red Delicious Apple 1kg",
    "Amul Butter 500g",
    "Gadget Cleaner Kit",
    "Essential Oil Diffuser",
}


def count_rows(cursor, table_name):
    cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
    return cursor.fetchone()[0]


def insert_rows(cursor, table_name, rows):
    if not rows:
        return
    columns = list(rows[0].keys())
    placeholders = ", ".join(["?"] * len(columns))
    column_list = ", ".join(columns)
    sql = f"INSERT OR REPLACE INTO {table_name} ({column_list}) VALUES ({placeholders})"
    cursor.executemany(sql, [[row.get(column) for column in columns] for row in rows])


def has_demo_catalog(cursor):
    placeholders = ", ".join(["?"] * len(DEMO_PRODUCT_NAMES))
    cursor.execute(
        f"SELECT COUNT(*) FROM products WHERE name IN ({placeholders})",
        list(DEMO_PRODUCT_NAMES),
    )
    return cursor.fetchone()[0] > 0


def clear_catalog(cursor):
    for table_name in ("products", "banners", "categories", "brands", "dark_stores"):
        cursor.execute(f"DELETE FROM {table_name}")


def seed_if_needed():
    init_db()
    if not SEED_PATH.exists():
        print("Production seed skipped; catalog seed file is missing.")
        return

    seed_data = json.loads(SEED_PATH.read_text())
    conn = get_db()
    try:
        cursor = conn.cursor()
        should_replace = has_demo_catalog(cursor)
        should_seed = should_replace or count_rows(cursor, "products") == 0 or count_rows(cursor, "banners") == 0

        if not should_seed:
            print("Production seed skipped; database already has catalog data.")
            return

        if should_replace:
            clear_catalog(cursor)

        for table_name in ("categories", "brands", "dark_stores", "banners", "products"):
            insert_rows(cursor, table_name, seed_data.get(table_name, []))

        conn.commit()
        print("Production seed completed with local catalog and banner data.")
    except sqlite3.Error:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    seed_if_needed()
