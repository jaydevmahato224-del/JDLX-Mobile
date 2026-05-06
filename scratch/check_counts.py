import sqlite3

def check_counts():
    conn = sqlite3.connect('/home/jaydev/Desktop/JDLX-Mobile/backend/jdlx.db')
    cursor = conn.cursor()

    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [row[0] for row in cursor.fetchall()]
    print(f"Tables: {tables}")

    for table in ['products', 'dark_stores', 'store_inventory', 'warehouse_inventory', 'warehouses']:
        if table in tables:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            print(f"Count in {table}: {count}")
        else:
            print(f"Table {table} does not exist.")

    conn.close()

if __name__ == "__main__":
    check_counts()
