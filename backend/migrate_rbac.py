import sqlite3
import os

DATABASE_PATH = 'jdlx.db'

def run_migration():
    print("Starting RBAC users table migration...")
    
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    try:
        # Create a new table with the expanded CHECK constraint
        print("Creating new_users table with updated role constraints...")
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS new_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                google_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                profile_image TEXT,
                phone TEXT,
                gender TEXT,
                date_of_birth TEXT,
                email_verified INTEGER DEFAULT 0,
                phone_verified INTEGER DEFAULT 0,
                role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin', 'super_admin', 'manager', 'inventory_admin', 'delivery_admin', 'support_admin')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Copy data from old users table to new_users table
        print("Copying data from users to new_users...")
        cursor.execute('''
            INSERT INTO new_users (id, google_id, name, email, profile_image, phone, gender, date_of_birth, email_verified, phone_verified, role, created_at)
            SELECT id, google_id, name, email, profile_image, phone, gender, date_of_birth, email_verified, phone_verified, role, created_at
            FROM users
        ''')

        # Drop the old users table
        print("Dropping old users table...")
        cursor.execute('DROP TABLE users')

        # Rename the new_users table to users
        print("Renaming new_users to users...")
        cursor.execute('ALTER TABLE new_users RENAME TO users')
        
        # Foreign key integrity check
        cursor.execute('PRAGMA foreign_key_check')
        violations = cursor.fetchall()
        if violations:
            print("Foreign key violations found after migration:", violations)
            raise Exception("Migration aborted due to FK violations.")

        conn.commit()
        print("Migration completed successfully!")

    except Exception as e:
        conn.rollback()
        print(f"Error during migration: {e}")
        print("Rolled back all changes.")
    finally:
        conn.close()

if __name__ == '__main__':
    run_migration()
