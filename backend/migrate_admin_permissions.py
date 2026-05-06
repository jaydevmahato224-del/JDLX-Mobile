import os
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def resolve_database_path():
    configured_path = os.environ.get("DATABASE_PATH")
    if configured_path:
        path = Path(configured_path)
        if not path.is_absolute():
            path = BASE_DIR / path
        return path
    return BASE_DIR / "jdlx.db"


DATABASE_PATH = resolve_database_path()


def create_admin_permissions_table(cursor):
    cursor.execute(
        '''
        CREATE TABLE IF NOT EXISTS admin_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id TEXT NOT NULL,
            permission TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(admin_id) REFERENCES admins(id),
            UNIQUE(admin_id, permission)
        )
        '''
    )


def migrate():
    if not DATABASE_PATH.exists():
        print(f"Database not found: {DATABASE_PATH}")
        return False

    print(f"Connecting to database at {DATABASE_PATH}...")

    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    try:
        # Check current schema
        cursor.execute("PRAGMA table_info(admin_permissions)")
        columns = {row[1]: row[2].upper() for row in cursor.fetchall()}

        if not columns:
            print("admin_permissions table does not exist. Creating it with the current schema...")
            create_admin_permissions_table(cursor)
            conn.commit()
            print("Migration successful.")
            return True

        admin_id_type = columns.get('admin_id')

        if admin_id_type == 'INTEGER':
            print("Migrating admin_permissions.admin_id from INTEGER to TEXT...")

            cursor.execute("DROP TABLE IF EXISTS admin_permissions_new")
            cursor.execute('''
                CREATE TABLE admin_permissions_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    admin_id TEXT NOT NULL,
                    permission TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(admin_id) REFERENCES admins(id),
                    UNIQUE(admin_id, permission)
                )
            ''')

            cursor.execute('''
                INSERT INTO admin_permissions_new (admin_id, permission, created_at)
                SELECT
                    CAST(admin_id AS TEXT),
                    permission,
                    MIN(created_at)
                FROM admin_permissions
                GROUP BY CAST(admin_id AS TEXT), permission
                ORDER BY MIN(id)
            ''')

            cursor.execute("DROP TABLE admin_permissions")
            cursor.execute("ALTER TABLE admin_permissions_new RENAME TO admin_permissions")

            cursor.execute("PRAGMA foreign_key_check")
            violations = cursor.fetchall()
            if violations:
                raise RuntimeError(f"Foreign key violations found after migration: {violations}")

            conn.commit()
            print("Migration successful.")
            return True
        if admin_id_type == 'TEXT':
            print("admin_id is already TEXT.")
            return True

        print(f"Unsupported admin_id type '{admin_id_type}'. No changes made.")
        return False

    except Exception as e:
        print(f"Error during migration: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(0 if migrate() else 1)
