import sqlite3
import os

DATABASE_PATH = 'backend/jdlx.db'
if not os.path.exists(DATABASE_PATH):
    DATABASE_PATH = 'jdlx.db'

def migrate():
    print(f"Connecting to database at {DATABASE_PATH}...")
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    try:
        print("Adding latitude column to orders table...")
        cursor.execute("ALTER TABLE orders ADD COLUMN latitude REAL")
    except sqlite3.OperationalError:
        print("Latitude column already exists.")

    try:
        print("Adding longitude column to orders table...")
        cursor.execute("ALTER TABLE orders ADD COLUMN longitude REAL")
    except sqlite3.OperationalError:
        print("Longitude column already exists.")

    conn.commit()
    conn.close()
    print("Migration completed successfully!")

if __name__ == "__main__":
    migrate()
