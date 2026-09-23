"""
E2E verification: Manual delivery (warehouse self-delivery) flow.
Isolated temp DB — NEVER touches jdlx.db or Turso. Read-only audit tool.
Run: FORCE_LOCAL_DB=1 DATABASE_PATH=/tmp/jdlx_test.db python3 scratch/test_manual_delivery_e2e.py
"""
import os
import sys
import json
import tempfile

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["DATABASE_PATH"] = tempfile.mktemp(suffix=".db")
os.environ["DISABLE_RATE_LIMIT"] = "1"
os.environ["FORCE_HTTPS"] = "0"  # keep Talisman off HTTPS redirect for the test client
# Minimal env so app import succeeds without leaking anything
os.environ.setdefault("JWT_SECRET", "e2e-test-secret")
os.environ.setdefault("RAZORPAY_KEY_ID", "test")
os.environ.setdefault("RAZORPAY_KEY_SECRET", "test")

passed, failed = [], []


def check(name, ok, extra=""):
    (passed if ok else failed).append(name)
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {extra}")


def main():
    import app as appmod
    from database import get_db

    app = appmod.app
    app.config["TESTING"] = True
    client = app.test_client()

    conn = get_db()
    cur = conn.cursor()

    # ---- Seed: user + warehouse + order (packed) + assignment ----
    cur.execute(
        "INSERT INTO users (google_id, name, email, role) VALUES (?, ?, ?, ?)",
        ("g1", "Customer", "cust@test.local", "user"),
    )
    user_id = cur.lastrowid

    cur.execute(
        """INSERT INTO warehouses (email, owner_name, warehouse_name, google_id, warehouse_role)
           VALUES (?, ?, ?, ?, ?)""",
        ("wh@test.local", "Owner", "Test WH", "gwh1", "owner"),
    )
    wh_id = cur.lastrowid

    cur.execute(
        """INSERT INTO orders (order_number, user_id, customer_name, customer_phone, phone,
           delivery_address, total_amount, order_status, payment_type, payment_status)
           VALUES ('ORD-E2E', ?, 'Customer', '9999999999', '9999999999', 'Test addr 110001', 500,
                   'PACKED', 'COD', 'pending')""",
        (user_id,),
    )
    order_id = cur.lastrowid

    cur.execute(
        "INSERT INTO warehouse_order_assignments (order_id, warehouse_id, assignment_status) VALUES (?, ?, 'packed')",
        (order_id, wh_id),
    )
    assignment_id = cur.lastrowid
    conn.commit()

    # ---- Auth tokens ----
    import jwt as pyjwt
    import datetime

    def wh_token():
        return pyjwt.encode(
            {"warehouse_id": wh_id, "email": "wh@test.local", "role": "owner",
             "type": "warehouse", "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=1)},
            os.environ["JWT_SECRET"], algorithm="HS256")

    def user_token():
        return pyjwt.encode(
            {"user_id": user_id, "email": "cust@test.local", "role": "user",
             "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=1)},
            os.environ["JWT_SECRET"], algorithm="HS256")

    def api(method, path, token=None, payload=None):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        r = client.open(path, method=method, headers=headers,
                        data=json.dumps(payload) if payload else None,
                        content_type="application/json")
        return r.status_code, (r.get_json() or {})

    # ---- 1. Guard rails on start ----
    # Wrong warehouse cannot start
    s, r = api("POST", "/api/warehouse/orders/999999/manual-delivery/start", wh_token())
    check("start: unknown assignment -> 404", s == 404, f"got {s}")

    # ---- 2. Happy path ----
    s, r = api("POST", f"/api/warehouse/orders/{assignment_id}/manual-delivery/start", wh_token())
    check("start: 200", s == 200, f"got {s} {r if s != 200 else ''}")
    check("start: no code leaked in warehouse response", "code" not in json.dumps(r.get("data", {})).lower(),
          str(r.get('data', {}).keys()) if s == 200 else "")

    # Customer can now see the code on their order status endpoint
    s, r = api("GET", f"/api/order/{order_id}/status", user_token())
    check("user status: 200", s == 200, f"got {s}")
    code = (r.get("delivery_code") or "") if s == 200 else ""
    check("user status: 6-digit delivery_code present", len(code) == 6 and code.isdigit(), f"code={code!r}")

    # Notification was written to notifications table
    notif = conn.execute(
        "SELECT title, message FROM notifications WHERE user_id = ?", (user_id,)
    ).fetchone()
    check("notification row created for customer", notif is not None,
          f"title={notif['title'] if notif else '-'}")

    # ---- 3. Wrong code rejected, attempts counted ----
    wrong = "000000" if code != "000000" else "111111"
    s, r = api("POST", f"/api/warehouse/orders/{assignment_id}/manual-delivery/verify",
               wh_token(), {"code": wrong})
    check("verify: wrong code -> 401", s == 401, f"got {s}")

    s, r = api("POST", f"/api/warehouse/orders/{assignment_id}/manual-delivery/verify",
               wh_token(), {"code": code})
    check("verify: correct code -> 200", s == 200, f"got {s} {r if s != 200 else ''}")

    s, r = api("GET", f"/api/order/{order_id}/status", user_token())
    check("order now DELIVERED", (r.get("status") or "").upper() == "DELIVERED",
          f"status={r.get('status')}")
    check("delivered_at stamped", bool(r.get("delivered_at")), str(r.get("delivered_at")))

    # Code must disappear after delivery
    s, r = api("GET", f"/api/user/orders", user_token())
    check("user orders list: 200", s == 200, f"got {s}")

    otp_row = conn.execute(
        "SELECT consumed, verified_at, delivered_at FROM manual_delivery_otps WHERE assignment_id = ?", (assignment_id,)
    ).fetchone()
    check("otp consumed + verified_at/delivered_at stamped",
          otp_row and otp_row["consumed"] == 1 and otp_row["verified_at"] and otp_row["delivered_at"],
          str(dict(otp_row) if otp_row else None))

    # ---- 4. Replay protection: same code cannot be verified again ----
    s, r = api("POST", f"/api/warehouse/orders/{assignment_id}/manual-delivery/verify",
               wh_token(), {"code": code})
    check("verify: replay blocked (order no longer packed -> 400)", s in (400, 410), f"got {s}")

    # ---- 5. Normal dispatch flow still works (regression) ----
    cur.execute(
        """INSERT INTO orders (order_number, user_id, customer_name, customer_phone, phone,
           delivery_address, total_amount, order_status, payment_type, payment_status)
           VALUES ('ORD-REG1', ?, 'Customer', '9999999999', '9999999999', 'Test addr 110001', 300,
                   'PACKED', 'Prepaid', 'paid')""",
        (user_id,),
    )
    reg_order = cur.lastrowid
    cur.execute(
        "INSERT INTO warehouse_order_assignments (order_id, warehouse_id, assignment_status) VALUES (?, ?, 'packed')",
        (reg_order, wh_id),
    )
    reg_asg = cur.lastrowid
    conn.commit()

    s, r = api("PATCH", f"/api/warehouse/orders/{reg_asg}/status", wh_token(), {"status": "dispatched"})
    check("regression: packed->dispatched status PATCH still 200", s == 200, f"got {s}")
    row = conn.execute("SELECT order_status FROM orders WHERE id = ?", (reg_order,)).fetchone()
    check("regression: order moved to SHIPPED", (row["order_status"] or "") == "SHIPPED",
          f"got {row['order_status'] if row else '-'}")

    # ---- 6. Assignment in wrong state rejected for manual delivery ----
    cur.execute(
        """INSERT INTO orders (order_number, user_id, customer_name, customer_phone, phone,
           delivery_address, total_amount, order_status, payment_type, payment_status)
           VALUES ('ORD-REG2', ?, 'Customer', '9999999999', '9999999999', 'Test addr 110001', 300,
                   'PACKED', 'Prepaid', 'paid')""",
        (user_id,),
    )
    o3 = cur.lastrowid
    cur.execute(
        "INSERT INTO warehouse_order_assignments (order_id, warehouse_id, assignment_status) VALUES (?, ?, 'accepted')",
        (o3, wh_id),
    )
    a3 = cur.lastrowid
    conn.commit()
    s, r = api("POST", f"/api/warehouse/orders/{a3}/manual-delivery/start", wh_token())
    check("guard: non-packed assignment rejected", s == 400, f"got {s}")

    conn.close()
    print()
    print(f"RESULT: {len(passed)} passed, {len(failed)} failed")
    if failed:
        print("FAILED:", failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
