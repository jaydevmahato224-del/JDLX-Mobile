import sqlite3

def migrate():
    conn = sqlite3.connect('jdlx.db')
    cursor = conn.cursor()
    
    try:
        print("Adding approved_at column...")
        cursor.execute("ALTER TABLE warehouse_applications ADD COLUMN approved_at TIMESTAMP")
    except sqlite3.OperationalError as e:
        print(f"Column approved_at might already exist: {e}")
        
    try:
        print("Adding rejected_at column...")
        cursor.execute("ALTER TABLE warehouse_applications ADD COLUMN rejected_at TIMESTAMP")
    except sqlite3.OperationalError as e:
        print(f"Column rejected_at might already exist: {e}")
        
    conn.commit()
    conn.close()
    print("Migration complete.")

if __name__ == "__main__":
    migrate()
