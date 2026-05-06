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
        print("Adding tracking columns to orders table...")
        
        # Adding columns individually to handle cases where some might already exist
        columns = [
            ("status_packing_at", "TIMESTAMP"),
            ("status_out_at", "TIMESTAMP"),
            ("status_delivered_at", "TIMESTAMP"),
            ("estimated_delivery", "TEXT DEFAULT '30-45 mins'")
        ]
        
        for col_name, col_type in columns:
            try:
                cursor.execute(f"ALTER TABLE orders ADD COLUMN {col_name} {col_type}")
                print(f"Added column: {col_name}")
            except sqlite3.OperationalError as e:
                if "duplicate column name" in str(e).lower():
                    print(f"Column {col_name} already exists, skipping.")
                else:
                    raise e

        # Update existing orders to have a default PLACED status if they were 'Pending'
        cursor.execute("UPDATE orders SET status = 'PLACED' WHERE status = 'Pending'")
        print("Migrated 'Pending' status to 'PLACED'")

        conn.commit()
        print("Migration completed successfully.")
    except Exception as e:
        print(f"Migration failed: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
