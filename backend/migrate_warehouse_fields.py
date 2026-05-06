import sqlite3
import os

def migrate():
    db_path = 'jdlx.db'
    if not os.path.exists(db_path):
        print(f"Error: Database not found at {db_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    columns_to_add = [
        ('brand', 'TEXT'),
        ('unit', "TEXT DEFAULT 'pcs'"),
        ('cost_price', 'REAL DEFAULT 0.0'),
        ('selling_price', 'REAL DEFAULT 0.0'),
        ('status', "TEXT DEFAULT 'active'")
    ]

    for col_name, col_type in columns_to_add:
        try:
            cursor.execute(f"ALTER TABLE warehouse_inventory ADD COLUMN {col_name} {col_type}")
            print(f"Successfully added column: {col_name}")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e):
                print(f"Column already exists: {col_name}")
            else:
                print(f"Error adding {col_name}: {e}")

    conn.commit()
    conn.close()
    print("Migration complete.")

if __name__ == "__main__":
    migrate()
