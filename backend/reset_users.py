import sqlite3
import os

DATABASE_PATH = "jdlx.db"

def reset_users():
    if not os.path.exists(DATABASE_PATH):
        print(f"Database {DATABASE_PATH} does not exist.")
        return

    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    try:
        cursor.execute("DELETE FROM users")
        cursor.execute("DELETE FROM admins")
        cursor.execute("DELETE FROM admin_permissions")
        cursor.execute("DELETE FROM user_addresses")
        conn.commit()
        print("Successfully deleted all users and admins.")
    except Exception as e:
        print(f"Error: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    reset_users()
