import os
import sqlite3


DATABASE_PATH = os.environ.get("DATABASE_PATH") or "jdlx.db"


def get_columns(cursor, table_name):
    cursor.execute(f"PRAGMA table_info({table_name})")
    return {row[1]: row for row in cursor.fetchall()}


def add_column_if_missing(cursor, table_name, column_name, definition):
    columns = get_columns(cursor, table_name)
    if column_name in columns:
        print(f"Column already exists: {table_name}.{column_name}")
        return

    cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")
    print(f"Added column: {table_name}.{column_name}")


def get_warehouse_staff_pk(cursor):
    columns = get_columns(cursor, "warehouse_staff")
    if "staff_id" in columns:
        return "staff_id"
    if "id" in columns:
        return "id"
    return "staff_id"


def migrate():
    print(f"Connecting to database at {DATABASE_PATH}...")
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    try:
        cursor.execute("PRAGMA foreign_keys = ON")

        print("Creating roles table if missing...")
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS roles (
                role_id INTEGER PRIMARY KEY AUTOINCREMENT,
                vendor_id INTEGER NOT NULL,
                role_name TEXT NOT NULL,
                permissions TEXT NOT NULL DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(vendor_id) REFERENCES warehouses(id),
                UNIQUE(vendor_id, role_name)
            )
            """
        )

        print("Creating warehouse_staff table if missing...")
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS warehouse_staff (
                staff_id INTEGER PRIMARY KEY AUTOINCREMENT,
                vendor_id INTEGER NOT NULL,
                role_id INTEGER,
                name TEXT NOT NULL,
                login_email TEXT,
                username TEXT,
                password_hash TEXT,
                status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(vendor_id) REFERENCES warehouses(id),
                FOREIGN KEY(role_id) REFERENCES roles(role_id),
                UNIQUE(vendor_id, login_email),
                UNIQUE(vendor_id, username)
            )
            """
        )

        # Some environments already have a warehouse_staff table from the
        # warehouse partner module. Preserve it and add only missing columns.
        add_column_if_missing(cursor, "warehouse_staff", "vendor_id", "INTEGER REFERENCES warehouses(id)")
        add_column_if_missing(cursor, "warehouse_staff", "role_id", "INTEGER REFERENCES roles(role_id)")
        add_column_if_missing(cursor, "warehouse_staff", "login_email", "TEXT")
        add_column_if_missing(cursor, "warehouse_staff", "username", "TEXT")
        add_column_if_missing(cursor, "warehouse_staff", "password_hash", "TEXT")

        staff_pk = get_warehouse_staff_pk(cursor)
        print("Adding order source and agent columns if missing...")
        add_column_if_missing(
            cursor,
            "orders",
            "source",
            "TEXT DEFAULT 'ONLINE' CHECK(source IN ('ONLINE', 'OFFLINE'))",
        )
        add_column_if_missing(
            cursor,
            "orders",
            "agent_id",
            f"INTEGER REFERENCES warehouse_staff({staff_pk})",
        )

        print("Creating indexes...")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_roles_vendor ON roles(vendor_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_warehouse_staff_vendor ON warehouse_staff(vendor_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_warehouse_staff_role ON warehouse_staff(role_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_orders_agent ON orders(agent_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source)")

        conn.commit()
        print("Migration completed successfully.")
    except Exception as exc:
        conn.rollback()
        print(f"Migration failed: {exc}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
