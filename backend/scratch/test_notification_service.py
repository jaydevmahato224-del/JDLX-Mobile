"""Functional test: notification_service writes to the SAME DB the panel reads.

Run: cd backend && FORCE_LOCAL_DB=1 DATABASE_PATH=/tmp/jdlx_notif_test.db python3 scratch/test_notification_service.py
"""
import os
import sys

os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["DATABASE_PATH"] = "/tmp/jdlx_notif_test.db"

if os.path.exists("/tmp/jdlx_notif_test.db"):
    os.remove("/tmp/jdlx_notif_test.db")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import init_db, get_db

init_db()

# ---- Seed a user ----
conn = get_db()
cur = conn.cursor()
cur.execute("INSERT INTO users (google_id, name, email) VALUES ('g1','Test User','t@t.com')")
user_id = cur.lastrowid
conn.commit()
conn.close()

# ---- Send a notification via the service (now Turso/app-DB aware) ----
from notifications.notification_service import notification_service

ok = notification_service.notify_user_internal(user_id, "Test Bonus", "₹10 added!", 'WALLET')
print("notify_user_internal returned:", ok)

# ---- Verify the row landed in the SAME DB the panel API reads ----
conn = get_db()
cur = conn.cursor()
cur.execute("SELECT user_id, title, message, type, is_read FROM notifications WHERE user_id = ?", (user_id,))
rows = cur.fetchall()
conn.close()

if len(rows) == 1:
    r = rows[0]
    print("PASS: notification row present in app DB:", dict(r) if hasattr(r, 'keys') else tuple(r))
    assert r['user_id' if hasattr(r, 'keys') else 0] == user_id
    print("PASS: is_read column readable =", r['is_read' if hasattr(r, 'keys') else 4])
    print("\n== RESULT: notification service writes to the app DB ✅ ==")
else:
    print(f"FAIL: expected 1 row, got {len(rows)}")
    sys.exit(1)
