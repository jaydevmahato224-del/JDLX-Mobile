"""
COD Payment Settlement
======================
Single helper that settles a COD order's payment when the order is DELIVERED.

Why this exists
---------------
Every COD order is created with payment_status='pending' (money is collected
at the door). Before this helper, NOTHING flipped that status on delivery, so
delivered COD orders kept showing "pending" on invoices, the admin orders
filter and the tracking page — while prepaid orders correctly showed "paid".

What it does (idempotent, additive — no business logic removed)
---------------------------------------------------------------
- Pure COD (no advance):        payment_status  pending  -> 'paid'
- COD with wallet advance:      payment_status  pending  -> 'paid'  and
                                cod_remaining_amount -> 0 (the rider collected
                                the balance at the door)
- Prepaid orders:               untouched (already 'paid')
- Already 'paid'/'advance_paid' rows before delivery: untouched (an advance
                                stays 'advance_paid' until delivery settles it)

Call sites (all three delivery paths):
    app.py            Shiprocket webhook 'delivered'
    app.py            admin status endpoint (manual DELIVERED)
    warehouse_routes  manual delivery OTP verify (self-delivered)

Backfill sweep:
    Orders delivered BEFORE this helper existed keep 'pending' forever (the
    fix is not retroactive). settle_overdue_cod_orders() repairs those rows
    in batches; it is wired into the periodic scheduler alongside the
    vendor-settlement sweep and is safe to run any time — idempotent and
    bounded so it never hammers the DB.
"""
from database import ist_now_str


def settle_cod_payment(cursor, order_id, delivered_at=None):
    """Flip a COD order's payment to 'paid' once it is DELIVERED.

    MUST be called inside the caller's transaction (before its commit) so the
    order-status and payment updates land atomically. Idempotent: safe to call
    multiple times — it only touches rows that are still pending.

    Returns True when a change was applied, False when nothing to do.
    """
    row = cursor.execute(
        """SELECT payment_type, payment_status, cod_advance_paid, cod_remaining_amount,
                  order_status
           FROM orders WHERE id = ?""",
        (order_id,),
    ).fetchone()
    if not row:
        return False

    # Safety net: settle ONLY on a delivered order. Callers already guard the
    # transition, but this makes the helper safe to call from anywhere
    # (sweeper jobs, retries) without ever marking an undelivered COD paid.
    if (row["order_status"] or "").upper() not in ("DELIVERED", "COMPLETED"):
        return False

    payment_type = (row["payment_type"] or "COD").upper()
    payment_status = (row["payment_status"] or "pending").lower()

    # Prepaid orders were paid at checkout; nothing to settle.
    if payment_type != "COD":
        return False
    # Only PENDING rows settle here. 'advance_paid' with a balance remaining
    # also settles (the door collection covers the rest); a fully-paid or
    # already-'paid' row must never be re-touched.
    if payment_status not in ("pending", "advance_paid"):
        return False

    if payment_status == "advance_paid":
        # Advance was recorded via payment_routes; the rider collected the
        # remaining balance at delivery.
        cursor.execute(
            """UPDATE orders
               SET payment_status = 'paid',
                   cod_remaining_amount = 0
               WHERE id = ? AND payment_status = 'advance_paid'""",
            (order_id,),
        )
    else:
        cursor.execute(
            """UPDATE orders
               SET payment_status = 'paid',
                   cod_remaining_amount = 0
               WHERE id = ? AND LOWER(payment_status) = 'pending'""",
            (order_id,),
        )
    return cursor.rowcount > 0


def settle_overdue_cod_orders(batch_size=100):
    """Backfill: settles COD orders that reached DELIVERED but never had their
    payment flipped (delivered before the settlement fix shipped, or through
    a path that predates the helper).

    Idempotent by construction — it only touches rows that are still
    pending/advance_paid — and bounded to `batch_size` rows per run so the
    first sweep after deploy stays cheap. Returns the number of repaired
    orders. Runs its own commit via the shared connection; safe to call from
    a scheduler job.
    """
    from database import get_db

    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT id FROM orders
               WHERE UPPER(COALESCE(payment_type, 'COD')) = 'COD'
                 AND UPPER(COALESCE(order_status, '')) IN ('DELIVERED', 'COMPLETED')
                 AND LOWER(COALESCE(payment_status, 'pending')) IN ('pending', 'advance_paid')
               ORDER BY id ASC
               LIMIT ?""",
            (batch_size,),
        ).fetchall()
        if not rows:
            return 0
        repaired = 0
        cur = conn.cursor()
        for r in rows:
            if settle_cod_payment(cur, r["id"]):
                repaired += 1
        conn.commit()
        return repaired
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
