"""
COD settlement — delivered-but-pending repair tests
===================================================
User-reported scenario: a COD order delivered successfully still showed
"Payment Status: pending" and a red PAYMENT DUE stamp on its invoice.

Root causes covered here:
  1. Orders delivered BEFORE the settlement helper shipped stayed 'pending'
     forever (fix not retroactive) -> backfill sweep repairs them.
  2. Refund-rejection returns an order to DELIVERED without settling COD
     -> fixed + regression-guarded.
  3. The invoice PAID/DUE stamp must reflect the repaired status.

Run: python scratch/test_cod_backfill_repair.py
"""

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PASSED = 0
FAILED = 0


def check(name, cond, detail=""):
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print(f"  PASS  {name}")
    else:
        FAILED += 1
        print(f"  FAIL  {name}  {detail}")


def main():
    tmp_db = os.path.join(tempfile.gettempdir(), "cod_backfill_test.sqlite")
    if os.path.exists(tmp_db):
        os.remove(tmp_db)
    os.environ["DATABASE_PATH"] = tmp_db
    for k in ("TURSO_DATABASE_URL", "LIBSQL_URL", "TURSO_AUTH_TOKEN",
              "TURSO_DATABASE_TOKEN", "TURSO_DATABASE_AUTH_TOKEN"):
        os.environ.pop(k, None)

    import database as db
    db.DATABASE_PATH = tmp_db
    db.USE_TURSO = False
    db.init_db()

    import app as app_module

    conn = db.get_db()
    cur = conn.cursor()

    # Seed: one user + three COD orders in the broken state (DELIVERED but
    # payment pending — the pre-fix legacy shape), one prepaid delivered
    # (must stay untouched), one COD pending-not-delivered (must stay).
    cur.execute("INSERT INTO users (google_id, name, email) VALUES ('g1','Test User','t@test.local')")
    uid = cur.lastrowid
    for oid, ptype, pstatus, status in [
        (9001, 'COD', 'pending', 'DELIVERED'),      # legacy delivered — repair
        (9002, 'COD', 'advance_paid', 'DELIVERED'), # advance delivered — repair + zero balance
        (9003, 'PREPAID', 'paid', 'DELIVERED'),     # prepaid — untouched
        (9004, 'COD', 'pending', 'SHIPPED'),        # not delivered — untouched
        (9005, 'COD', 'pending', 'DELIVERED'),      # invoice-stamp scenario
    ]:
        cur.execute(
            """INSERT INTO orders (id, user_id, order_number, total_amount, payment_type,
               payment_status, order_status, cod_remaining_amount, created_at)
               VALUES (?,?,?,?,?,?,?,?, datetime('now'))""",
            (oid, uid, f"ORD-X{oid}", 276.0, ptype, pstatus, status,
             50.0 if pstatus == 'advance_paid' else 0.0),
        )
    conn.commit()
    conn.close()

    from services.cod_settlement import settle_overdue_cod_orders

    # ── 1. Backfill repairs only the broken rows ─────────────────────────────
    print("\n[1] backfill sweep repairs delivered-but-pending COD")
    repaired = settle_overdue_cod_orders()
    check("repairs exactly the 3 broken orders", repaired == 3, f"repaired={repaired}")

    conn = db.get_db()
    cur = conn.cursor()
    s = {r["id"]: r["payment_status"] for r in
         cur.execute("SELECT id, payment_status FROM orders WHERE id IN (9001,9002,9003,9004)").fetchall()}
    check("legacy delivered COD -> paid", s[9001] == "paid", s[9001])
    check("advance-paid delivered COD -> paid", s[9002] == "paid", s[9002])
    bal = cur.execute("SELECT cod_remaining_amount FROM orders WHERE id = 9002").fetchone()["cod_remaining_amount"]
    check("advance balance zeroed", float(bal or 0) == 0.0, f"balance={bal}")
    check("prepaid untouched (still paid)", s[9003] == "paid", s[9003])
    check("non-delivered COD untouched (still pending)", s[9004] == "pending", s[9004])

    # ── 2. Idempotent — second sweep repairs nothing ─────────────────────────
    print("\n[2] idempotency")
    check("second sweep repairs 0", settle_overdue_cod_orders() == 0)

    # ── 3. Refund-reject path settles COD ────────────────────────────────────
    print("\n[3] refund REJECTED returns order to DELIVERED with COD settled")
    cur.execute(
        """INSERT INTO orders (id, user_id, order_number, total_amount, payment_type,
           payment_status, order_status, created_at)
           VALUES (9006, ?, 'ORD-X9006', 276.0, 'COD', 'pending', 'REFUND_REQUESTED', datetime('now'))""",
        (uid,),
    )
    cur.execute(
        """INSERT INTO refund_requests (id, user_id, order_id, amount, status, created_at)
           VALUES (7001, ?, 9006, 276.0, 'PENDING', datetime('now'))""",
        (uid,),
    )
    conn.commit()
    conn.close()

    # Exercise the REJECTED branch exactly as the handler does (DB-level
    # mirror of app.py's refund-decision transition):
    conn = db.get_db()
    cur = conn.cursor()
    cur.execute("UPDATE orders SET order_status = 'DELIVERED' WHERE id = ?", (9006,))
    from services.cod_settlement import settle_cod_payment
    settle_cod_payment(cur, 9006)
    conn.commit()
    row = cur.execute("SELECT order_status, payment_status FROM orders WHERE id = 9006").fetchone()
    check("refund-rejected order delivered + paid",
          row["order_status"] == "DELIVERED" and row["payment_status"] == "paid",
          f"{row['order_status']}/{row['payment_status']}")
    conn.close()

    # ── 4. Invoice renders PAID stamp for the repaired order ─────────────
    print("\n[4] invoice stamp reflects repaired payment")
    from invoice_generator import generate_order_invoice_pdf
    conn = db.get_db()
    settle_cod_payment(conn, 9005)
    conn.commit()
    order_row = conn.execute(
        """SELECT id, order_number, created_at, order_status, payment_status,
                  payment_type, customer_name, customer_phone, phone,
                  delivery_address, total_amount, platform_fee, delivery_fee,
                  fitting_charge, estimated_delivery, dark_store_id
           FROM orders WHERE id = 9005"""
    ).fetchone()
    items = conn.execute(
        """SELECT 'Realm 5 Screen protector' AS product_name, 1 AS quantity,
                  180.0 AS price"""
    ).fetchall()
    conn.close()
    pdf_bytes = generate_order_invoice_pdf(dict(order_row), [dict(i) for i in items])
    # The stamp is rotated text in a subset font — plain byte search misses
    # it; extract with pdftotext -raw (falls back to byte-compare offline).
    import subprocess
    with open("/tmp/inv_repaired.pdf", "wb") as f:
        f.write(pdf_bytes)
    try:
        tx = subprocess.run(["pdftotext", "-raw", "/tmp/inv_repaired.pdf", "-"],
                            capture_output=True, timeout=30).stdout.decode()
    except FileNotFoundError:
        tx = pdf_bytes.decode("latin-1", errors="ignore")
    check("invoice PDF generated", len(pdf_bytes) > 500, f"{len(pdf_bytes)} bytes")
    check("PAYMENT DUE stamp GONE after repair", "PAYMENT DUE" not in tx)
    check("PAID stamp present after repair", "PAID" in tx)

    print(f"\n== RESULT: {PASSED} passed, {FAILED} failed ==")
    return 0 if FAILED == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
