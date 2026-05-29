import os
import sys
import sqlite3

# Try to use database.py for Turso support, fallback to sqlite3
try:
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    from database import get_db
    DB_CONN = get_db()
    print("Connected via database.py")
except Exception as e:
    DATABASE_PATH = 'backend/jdlx.db'
    if not os.path.exists(DATABASE_PATH):
        DATABASE_PATH = 'jdlx.db'
    DB_CONN = sqlite3.connect(DATABASE_PATH)
    print(f"Connected via sqlite3: {DATABASE_PATH}")

def migrate():
    cursor = DB_CONN.cursor()

    print("Creating referral_attempts table...")
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS referral_attempts (
            user_id INTEGER UNIQUE,
            attempts INTEGER DEFAULT 0,
            blocked_at TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')

    if hasattr(DB_CONN, 'commit'):
        DB_CONN.commit()
    if hasattr(DB_CONN, 'close'):
        DB_CONN.close()
    print("MIGRATION: executed successfully")

if __name__ == "__main__":
    migrate()
