"""
Admin password login + security questions migration.

Adds credential columns to the users table for admin password login:
  - password_hash      (werkzeug pbkdf2 hash; NULL = password login not set up)
  - password_salt      (legacy reserved, unused by werkzeug hashing)
  - password_set_at    (audit timestamp)
  - admin_phone        (admin's mobile number for login; separate from the
                        customer `phone` column which belongs to the storefront)
  - security_question  (chosen question text)
  - security_answer_hash (hashed answer; used to authorize email/phone changes
                          and password changes)

Also creates admin_security_events (audit trail for sensitive admin security
actions).

Idempotent: safe to run multiple times. Run once at deploy:
    python3 backend/migrate_admin_auth.py
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# --- SAFETY GUARD ------------------------------------------------------------
# With Turso credentials in .env, the app connects to the REMOTE database and
# silently ignores DATABASE_PATH. An operator running this against a local file
# copy ("DATABASE_PATH=/tmp/x.db") would actually migrate PRODUCTION. Require
# the explicit FORCE_LOCAL_DB=1 escape hatch whenever DATABASE_PATH is set.
if os.environ.get("DATABASE_PATH") and os.environ.get("FORCE_LOCAL_DB", "").strip().lower() not in ("1", "true", "yes"):
    print("REFUSING to run: DATABASE_PATH is set but FORCE_LOCAL_DB is not.")
    print("With Turso credentials present, DATABASE_PATH alone is IGNORED and this")
    print("script would migrate the remote/production DB. For a local file run:")
    print("  FORCE_LOCAL_DB=1 DATABASE_PATH=/path/to/file.db python3 migrate_admin_auth.py")
    print("For the remote DB intentionally, unset DATABASE_PATH and run with FORCE_LOCAL_DB unset.")
    sys.exit(2)

from database import DATABASE_PATH  # noqa: E402


def migrate():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    def ensure_column(table, column, ddl):
        cursor.execute(f"PRAGMA table_info({table})")
        cols = {r[1] for r in cursor.fetchall()}
        if column not in cols:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
            print(f"  added {table}.{column}")
        else:
            print(f"  exists {table}.{column}")

    print("Migrating users table for admin password auth...")
    ensure_column("users", "password_hash", "TEXT")
    ensure_column("users", "password_salt", "TEXT")
    ensure_column("users", "password_set_at", "TIMESTAMP")
    ensure_column("users", "admin_phone", "TEXT")
    ensure_column("users", "security_question", "TEXT")
    ensure_column("users", "security_answer_hash", "TEXT")

    cursor.execute(
        '''CREATE TABLE IF NOT EXISTS admin_security_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER,
            email TEXT,
            event_type TEXT NOT NULL,
            description TEXT,
            ip_address TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )'''
    )
    print("  ensured table admin_security_events")

    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_admin_security_events_admin "
        "ON admin_security_events(admin_id, created_at)"
    )

    conn.commit()
    conn.close()
    print("Admin auth migration complete.")


if __name__ == "__main__":
    migrate()
