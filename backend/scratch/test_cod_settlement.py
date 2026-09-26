"""
COD settlement tests
====================
Verifies services/cod_settlement.settle_cod_payment across every delivery
path scenario:

  - pure COD delivered        -> 'paid', cod_remaining 0
  - COD with advance delivered-> 'paid', cod_remaining 0 (door collection)
  - prepaid delivered         -> untouched (already paid at checkout)
  - already 'paid'            -> untouched (idempotent)
  - COD still SHIPPED         -> untouched (settle only on delivery)
  - missing order             -> no crash, returns False
Plus an end-to-end pass: webhook-style status update + settlement in one
transaction, then invoice generation shows the settled state.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_fd, _tmp_db = tempfile.mkstemp(suffix=".db")
os.close(_fd)
os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["DATABASE_PATH"] = _tmp_db

import database
from database import get_db, init_db
init_db()

from services.cod_settlement import settle_cod_payment

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  [{detail}]" if detail and not cond else ""))


def seed_order(order_id, payment_type, payment_status, cod_advance=0, cod_remaining=0, status="DELIVERED"):
    conn = get_db()
    # FK target: orders.user_id -> users.id
    conn.execute("INSERT OR IGNORE INTO users (id, google_id, name, email, role) VALUES (1, 'g1', 'T', 't@t.com', 'user')")
    conn.execute(
        """INSERT INTO orders (id, user_id, total_amount, order_status, order_number,
               customer_name, delivery_address, payment_type, payment_status,
               cod_advance_paid, cod_remaining_amount, created_at)
           VALUES (?, 1, 276, ?, ?, 'T', 'addr', ?, ?, ?, ?, datetime('now'))""",
        (order_id, status, f"ORD-T{order_id}", payment_type, payment_status, cod_advance, cod_remaining),
    )
    conn.commit()
    conn.close()


def row(order_id):
    conn = get_db()
    try:
        return dict(conn.execute(
            "SELECT payment_status, cod_remaining_amount FROM orders WHERE id = ?", (order_id,)
        ).fetchone())
    finally:
        conn.close()


def settle(order_id):
    conn = get_db()
    try:
        cur = conn.cursor()
        changed = settle_cod_payment(cur, order_id)
        conn.commit()
        return changed
    finally:
        conn.close()


print("\n== Pure COD delivered ==")
seed_order(301, "COD", "pending", 0, 276)
check("settle applied", settle(301) is True)
r = row(301)
check("payment_status = paid", r["payment_status"] == "paid", str(r))
check("cod_remaining = 0", r["cod_remaining_amount"] == 0, str(r))

print("\n== COD with wallet advance delivered ==")
seed_order(302, "COD", "advance_paid", 50, 226)
check("settle applied", settle(302) is True)
r = row(302)
check("payment_status = paid", r["payment_status"] == "paid", str(r))
check("cod_remaining cleared", r["cod_remaining_amount"] == 0, str(r))

print("\n== Prepaid delivered -> untouched ==")
seed_order(303, "PREPAID", "paid")
check("no change reported", settle(303) is False)
check("still paid", row(303)["payment_status"] == "paid")

print("\n== Already paid COD -> idempotent no-op ==")
seed_order(304, "COD", "paid", 0, 0)
check("no change reported", settle(304) is False)
check("stays paid", row(304)["payment_status"] == "paid")

print("\n== COD not yet delivered -> untouched ==")
seed_order(305, "COD", "pending", 0, 276, status="SHIPPED")
check("no change reported", settle(305) is False)
check("still pending", row(305)["payment_status"] == "pending")

print("\n== Missing order -> safe ==")
check("returns False, no crash", settle(9999) is False)

print("\n== End-to-end: delivery transition + settlement in one tx ==")
seed_order(306, "COD", "pending", 0, 276, status="SHIPPED")
conn = get_db()
try:
    cur = conn.cursor()
    cur.execute("UPDATE orders SET order_status = 'DELIVERED', delivered_at = CURRENT_TIMESTAMP WHERE id = 306")
    settle_cod_payment(cur, 306)
    conn.commit()
finally:
    conn.close()
r = row(306)
check("order DELIVERED + payment paid atomically",
      r["payment_status"] == "paid" and r["cod_remaining_amount"] == 0, str(r))

print("\n== Invoice reflects settled state ==")
from invoice_generator import generate_order_invoice_pdf
order = {
    "id": 306, "order_number": "ORD-T306", "created_at": "2026-09-26 10:00:00",
    "payment_type": "COD", "payment_status": row(306)["payment_status"],
    "customer_name": "T", "customer_phone": "9", "delivery_address": "addr",
    "total_amount": 276, "platform_fee": 0, "delivery_fee": 0, "fitting_charge": 0,
    "discount_applied": 0,
}
items = [{"product_name": "X", "quantity": 1, "price": 276}]
pdf = generate_order_invoice_pdf(order, items)
open("/tmp/inv_cod_settled.pdf", "wb").write(pdf)

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "venv_linux", "lib", "python3.12", "site-packages"))
from pdfminer.high_level import extract_text
text = extract_text("/tmp/inv_cod_settled.pdf")
check("invoice shows PAID stamp", "PAID" in text)
check("invoice shows collected-on-delivery note", "collected on delivery" in text)

print(f"\n{'='*60}\nRESULTS: {len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    print("FAILED:", FAIL)
    sys.exit(1)
print("ALL COD SETTLEMENT CHECKS PASSED")
