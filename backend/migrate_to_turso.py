import sqlite3
import os
import sys
from dotenv import load_dotenv

# Load credentials from backend/.env (never hardcode secrets in source files)
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

def migrate():
    try:
        import libsql_experimental as libsql
    except ImportError:
        print("Failed to install or import libsql-experimental")
        sys.exit(1)

    url = os.environ.get("TURSO_DATABASE_URL")
    token = os.environ.get("TURSO_AUTH_TOKEN")

    if not url or not token:
        print("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in environment/.env")
        sys.exit(1)

    local_db_path = os.environ.get("DATABASE_PATH") or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'jdlx.db')
    if not os.path.exists(local_db_path):
        print(f"Local database not found at {local_db_path}")
        sys.exit(1)

    print("Connecting to local database...")
    local_conn = sqlite3.connect(local_db_path)
    local_cursor = local_conn.cursor()

    print("Connecting to Turso remote database via direct HTTP...")
    # Using direct remote connection to avoid local WAL corruption issues
    remote_conn = libsql.connect(url, auth_token=token)
    remote_cursor = remote_conn.cursor()

    # Disable foreign keys temporarily for a smooth migration
    try:
        remote_cursor.execute("PRAGMA foreign_keys = OFF;")
    except:
        pass

    # Get all tables from local DB
    local_cursor.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence'")
    tables = local_cursor.fetchall()

    for table_name, table_sql in tables:
        print(f"Migrating table: {table_name}")
        # Create table in remote DB
        try:
            remote_cursor.execute(f"DROP TABLE IF EXISTS {table_name}")
            remote_cursor.execute(table_sql)
        except Exception as e:
            print(f"Error creating table {table_name}: {e}")
            continue

        # Get data
        local_cursor.execute(f"SELECT * FROM {table_name}")
        rows = local_cursor.fetchall()
        
        if not rows:
            continue

        # Get column names
        cols = [description[0] for description in local_cursor.description]
        placeholders = ",".join(["?"] * len(cols))
        
        # Insert data
        insert_sql = f"INSERT INTO {table_name} ({','.join(cols)}) VALUES ({placeholders})"
        try:
            remote_cursor.executemany(insert_sql, rows)
            remote_conn.commit()
            print(f"  -> Inserted {len(rows)} rows.")
        except Exception as e:
            print(f"Error inserting data into {table_name}: {e}")

    # Migrate sqlite_sequence if exists
    try:
        local_cursor.execute("SELECT * FROM sqlite_sequence")
        seq_rows = local_cursor.fetchall()
        if seq_rows:
            # We don't drop sqlite_sequence, it's auto-created, but we can update it
            for row in seq_rows:
                remote_cursor.execute("UPDATE sqlite_sequence SET seq = ? WHERE name = ?", (row[1], row[0]))
                if remote_cursor.rowcount == 0:
                    remote_cursor.execute("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)", (row[0], row[1]))
            remote_conn.commit()
            print("Migrated sqlite_sequence.")
    except Exception:
        pass

    print("Migration complete!")
    local_conn.close()
    remote_conn.close()

if __name__ == "__main__":
    migrate()

