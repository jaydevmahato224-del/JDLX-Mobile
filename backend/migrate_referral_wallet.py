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

    # 1. wallet table
    print("Creating wallet table...")
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS wallet (
            user_id INTEGER UNIQUE,
            balance REAL DEFAULT 0.0,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')

    # 2. wallet_transactions table
    print("Creating wallet_transactions table...")
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS wallet_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            type TEXT,
            reason TEXT,
            reference_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    ''')
    
    # Ensure columns exist if table was already there
    cursor.execute("PRAGMA table_info(wallet_transactions)")
    cols = [r[1] for r in cursor.fetchall()]
    if 'reason' not in cols:
        cursor.execute("ALTER TABLE wallet_transactions ADD COLUMN reason TEXT")
    if 'reference_id' not in cols:
        cursor.execute("ALTER TABLE wallet_transactions ADD COLUMN reference_id TEXT")

    # 3. referrals table
    print("Creating referrals table...")
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS referrals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            referrer_id INTEGER NOT NULL,
            referred_id INTEGER UNIQUE NOT NULL,
            referral_code TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            qualifying_order_id INTEGER,
            reward_given_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(referrer_id) REFERENCES users(id),
            FOREIGN KEY(referred_id) REFERENCES users(id),
            FOREIGN KEY(qualifying_order_id) REFERENCES orders(id)
        )
    ''')

    # 4. ALTER TABLE users ADD COLUMN referral_code TEXT UNIQUE
    print("Adding referral_code to users table...")
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN referral_code TEXT")
    except Exception as e:
        if "duplicate column name" in str(e).lower():
            print("referral_code column already exists.")
        else:
            print(f"Note: {e}")
            
    try:
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)")
    except Exception as e:
        print(f"Index note: {e}")

    if hasattr(DB_CONN, 'commit'):
        DB_CONN.commit()
    if hasattr(DB_CONN, 'close'):
        DB_CONN.close()
    print("MIGRATION: executed successfully")

if __name__ == "__main__":
    migrate()
