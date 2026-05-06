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
        print("Adding status_ready_at column to orders table...")
        cursor.execute("ALTER TABLE orders ADD COLUMN status_ready_at TIMESTAMP")
    except sqlite3.OperationalError:
        print("status_ready_at column already exists.")

    conn.commit()
    conn.close()
    print("Migration completed successfully!")

if __name__ == "__main__":
    migrate()
