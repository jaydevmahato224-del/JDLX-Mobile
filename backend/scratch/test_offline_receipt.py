"""
Offline bill receipt endpoint + PDF generator test.

Covers:
  1. generate_offline_receipt_pdf returns a valid %PDF- document with sane size
  2. /api/warehouse/billing/<id>/receipt happy path (owner + billing staff)
  3. Vendor scoping: another warehouse's bill -> 404
  4. Online (non-OFFLINE) orders are NOT downloadable here -> 404
  5. Missing bill -> 404
  6. Billing-history regression (list endpoint untouched)
"""
import os
import sys

os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["FORCE_HTTPS"] = "0"
TEST_DB = os.environ["DATABASE_PATH"] = "/tmp/jdlx_receipt_test.db"
if os.path.exists(TEST_DB):
    os.remove(TEST_DB)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import jwt  # noqa: E402
import datetime  # noqa: E402
from app import app  # noqa: E402
from database import get_db  # noqa: E402
from jwt_config import get_jwt_secret  # noqa: E402

passed = failed = 0
def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ PASS: {name}" + (f"  ({extra})" if extra else ""))
    else:
        failed += 1
        print(f"  ❌ FAIL: {name}" + (f"  ({extra})" if extra else ""))

# ── DB fixtures: warehouse 1 + warehouse 2, one OFFLINE bill each, one ONLINE ──
conn = get_db()
conn.execute("INSERT INTO warehouses (id, warehouse_name, email, phone) VALUES (1, 'WH One', 'wh1@test.com', '9000000001')")
conn.execute("INSERT INTO warehouses (id, warehouse_name, email, phone) VALUES (2, 'WH Two', 'wh2@test.com', '9000000002')")
# order_items.product_id has a FK to products — seed two catalog rows.
conn.execute(
    "INSERT INTO products (id, name, price, stock) VALUES (1, 'OnePlus Nord CE4 5G (8/128)', 18999, 50),"
    "(2, 'Tempered Glass', 500, 100)"
)
# staff tokens are DB-backed (staff row + role with the billing permission)
conn.execute(
    "INSERT INTO roles (role_id, vendor_id, role_name, permissions) VALUES (11, 1, 'Billing Agent', '[\"billing\"]')"
)
conn.execute(
    "INSERT INTO warehouse_staff (staff_id, vendor_id, role_id, name, login_email, status) VALUES (9, 1, 11, 'Counter Staff', 'staff@wh1.com', 'active')"
)
# orders.user_id is NOT NULL — counter bills carry a walk-in placeholder user.
conn.execute(
    "INSERT INTO users (id, google_id, name, email) VALUES (9001, 'gid-walkin-1', 'Counter Customer', 'walkin1@test.com')"
)
conn.execute(
    "INSERT INTO users (id, google_id, name, email) VALUES (9002, 'gid-walkin-2', 'Counter Customer 2', 'walkin2@test.com')"
)
conn.execute(
    "INSERT INTO users (id, google_id, name, email) VALUES (9003, 'gid-web-1', 'Web Customer', 'web@test.com')"
)
conn.execute(
    """INSERT INTO orders (id, order_number, user_id, vendor_id, source, customer_name, customer_phone,
       delivery_address, total_amount, subtotal_amount, tax_amount, gst_rate, discount_amount,
       order_status, payment_status, payment_type, created_at, updated_at)
       VALUES (101, 'OFF-2026-1001', 9001, 1, 'OFFLINE', 'Ravi Kumar', '9876543210', 'Store Counter Sale',
       19999, 16949.15, 3049.85, 18, 0, 'CONFIRMED', 'completed', 'CASH', '2026-09-30 10:00:00', '2026-09-30 10:00:00')"""
)
conn.execute(
    """INSERT INTO order_items (order_id, product_id, product_name, quantity, price, subtotal)
       VALUES (101, 1, 'OnePlus Nord CE4 5G (8/128)', 1, 18999, 18999),
              (101, 2, 'Tempered Glass', 2, 500, 1000)"""
)
conn.execute(
    """INSERT INTO orders (id, order_number, user_id, vendor_id, source, customer_name, customer_phone,
       delivery_address, total_amount, order_status, payment_status, payment_type, created_at, updated_at)
       VALUES (202, 'OFF-2026-2002', 9002, 2, 'OFFLINE', 'Other WH Customer', '9000000009', 'Store Counter Sale',
       500, 'CONFIRMED', 'completed', 'CASH', '2026-09-30 11:00:00', '2026-09-30 11:00:00')"""
)
conn.execute(
    """INSERT INTO orders (id, order_number, user_id, vendor_id, source, customer_name, customer_phone,
       delivery_address, total_amount, order_status, payment_status, payment_type, created_at, updated_at)
       VALUES (303, 'ORD-ONLINE-1', 9003, 1, 'ONLINE', 'Web Customer', '8000000008', 'Somewhere',
       25000, 'CONFIRMED', 'completed', 'UPI', '2026-09-30 12:00:00', '2026-09-30 12:00:00')"""
)
conn.commit()
conn.close()

owner_token = jwt.encode(
    {"type": "warehouse", "warehouse_id": 1, "email": "wh1@test.com",
     "exp": datetime.datetime.utcnow() + datetime.timedelta(days=1)},
    get_jwt_secret(), algorithm="HS256",
)
staff_token = jwt.encode(
    {"type": "warehouse_staff", "staff_id": 9, "vendor_id": 1, "email": "staff@wh1.com",
     "name": "Counter Staff", "role_name": "Billing Agent", "permissions": ["billing"],
     "exp": datetime.datetime.utcnow() + datetime.timedelta(days=1)},
    get_jwt_secret(), algorithm="HS256",
)
SH = {"Authorization": f"Bearer {owner_token}"}
ST = {"Authorization": f"Bearer {staff_token}"}

client = app.test_client()

print("== 1. PDF generator unit ==")
from invoice_generator import generate_offline_receipt_pdf  # noqa: E402
pdf = generate_offline_receipt_pdf(
    {"order_number": "OFF-2026-1001", "created_at": "2026-09-30 10:00:00", "payment_type": "CASH",
     "payment_status": "completed", "customer_name": "Ravi Kumar", "customer_phone": "9876543210",
     "subtotal_amount": 16949.15, "tax_amount": 3049.85, "gst_rate": 18, "discount_amount": 0,
     "total_amount": 19999},
    [{"product_name": "OnePlus Nord CE4 5G (8/128)", "quantity": 1, "subtotal": 18999},
     {"product_name": "Tempered Glass", "quantity": 2, "subtotal": 1000}],
    vendor={"warehouse_name": "WH One", "phone": "9000000001"},
)
check("valid PDF bytes", pdf[:5] == b"%PDF-", f"{len(pdf)} bytes")
check("sane size (>4KB with embedded fonts)", len(pdf) > 4000, str(len(pdf)))

print("== 2. Endpoint happy path ==")
r = client.get("/api/warehouse/billing/101/receipt", headers=SH)
check("owner download 200", r.status_code == 200, str(r.status_code))
check("content-type PDF", (r.mimetype or "") == "application/pdf", r.mimetype)
check("attachment filename", "OFF-2026-1001" in (r.headers.get("Content-Disposition") or ""), r.headers.get("Content-Disposition", "")[:60])
check("body is real PDF", r.data[:5] == b"%PDF-")

r = client.get("/api/warehouse/billing/101/receipt", headers=ST)
check("billing staff (billing perm) also 200", r.status_code == 200, str(r.status_code))

print("== 3. Vendor scoping ==")
wh2_token = jwt.encode(
    {"type": "warehouse", "warehouse_id": 2, "email": "wh2@test.com",
     "exp": datetime.datetime.utcnow() + datetime.timedelta(days=1)},
    get_jwt_secret(), algorithm="HS256",
)
r = client.get("/api/warehouse/billing/101/receipt", headers={"Authorization": f"Bearer {wh2_token}"})
check("other warehouse's bill -> 404", r.status_code == 404, str(r.status_code))

print("== 4. NON-offline orders blocked ==")
r = client.get("/api/warehouse/billing/303/receipt", headers=SH)
check("ONLINE order -> 404 (customer invoice flow se download hoga)", r.status_code == 404, str(r.status_code))

print("== 5. Missing bill ==")
r = client.get("/api/warehouse/billing/999/receipt", headers=SH)
check("nonexistent bill -> 404", r.status_code == 404, str(r.status_code))

print("== 6. No auth ==")
r = client.get("/api/warehouse/billing/101/receipt")
check("no token -> 401", r.status_code == 401, str(r.status_code))

print("== 7. History regression ==")
r = client.get("/api/warehouse/billing/history", headers=SH)
check("history list still works", r.status_code == 200, str(r.status_code))

print()
print("=" * 50)
print(f"TOTAL: {passed} passed, {failed} failed")
if failed == 0:
    print("ALL RECEIPT TESTS PASSED ✅")
else:
    print("FAILURES PRESENT ❌")
sys.exit(1 if failed else 0)
