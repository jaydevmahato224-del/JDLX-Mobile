import sqlite3
import os
from database import get_db

def migrate():
    print("Running migration for app_reviews table...")
    conn = get_db()
    cursor = conn.cursor()

    try:
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS app_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE,
                rating INTEGER,
                review_text TEXT,
                source TEXT DEFAULT 'in_app',
                prompt_shown_at TIMESTAMP,
                submitted_at TIMESTAMP,
                went_to_google INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        ''')
        conn.commit()
        print("Table 'app_reviews' created successfully.")
    except Exception as e:
        print(f"Error creating table: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
