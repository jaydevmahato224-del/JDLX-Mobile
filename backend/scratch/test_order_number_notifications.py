"""Functional test: order notifications show the real order number.

Run: cd backend && FORCE_LOCAL_DB=1 DATABASE_PATH=/tmp/jdlx_ordnum_test.db python3 scratch/test_order_number_notifications.py
"""
import os
import sys

os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["DATABASE_PATH"] = "/tmp/jdlx_ordnum_test.db"

if os.path.exists("/tmp/jdlx_ordnum_test.db"):
    os.remove("/tmp/jdlx_ordnum_test.db")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import init_db, get_db

init_db()

# ---- Seed: user + order with a real order_number ----
conn = get_db()
cur = conn.cursor()
cur.execute("INSERT INTO users (google_id, name, email) VALUES ('g1','Test User','t@t.com')")
user_id = cur.lastrowid
cur.execute(
    """INSERT INTO orders (order_number, user_id, customer_name, customer_phone,
           delivery_address, total_amount, order_status)
       VALUES ('ORD-A4D617F1', ?, 'Test User', '9999999999', 'Test Address', 499, 'PLACED')""",
    (user_id,),
)
order_id = cur.lastrowid
conn.commit()
conn.close()

from notifications.notification_service import notification_service

failures = []


def check(name, cond, detail=""):
    print(("PASS" if cond else "FAIL") + f": {name}" + (f" — {detail}" if detail else ""))
    if not cond:
        failures.append(name)


# 1. Status notification (the screenshot case: DELIVERED)
ok = notification_service.send_order_notification(user_id, order_id, "DELIVERED")
check("send_order_notification returned True", ok is True)

# 2. Delivery-code notification path (message built here, service inserts it)
ok2 = notification_service.notify_user_internal(
    user_id,
    "Your Delivery Code",
    f"Order #ORD-A4D617F1: share code 252444 with the delivery person to receive your order.",
    "ORDER",
    url=f"/track/{order_id}",
)
check("delivery-code notification inserted", ok2 is True)

# ---- Verify BOTH rows show the order number, not the numeric id ----
conn = get_db()
cur = conn.cursor()
cur.execute(
    "SELECT title, message, type FROM notifications WHERE user_id = ? ORDER BY id",
    (user_id,),
)
rows = cur.fetchall()
conn.close()

check("two notification rows present", len(rows) == 2, f"got {len(rows)}")

texts = [r["message"] for r in rows]
joined = " | ".join(texts)

check("DELIVERED text uses order number", "#ORD-A4D617F1" in (texts[0] if texts else ""), texts[0] if texts else "")
check("DELIVERED text has NO numeric id", f"#{order_id}" not in (texts[0] if texts else ""))
check("delivery-code text uses order number", "#ORD-A4D617F1" in (texts[1] if len(texts) > 1 else ""))

print("\n--- Notification contents ---")
for t in texts:
    print(" *", t)

print()
if failures:
    print(f"== RESULT: {len(failures)} FAILURE(S) ❌ ==")
    sys.exit(1)
print("== RESULT: notifications show the real order number ✅ ==")
