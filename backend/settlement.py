"""
Vendor (warehouse) settlement engine
====================================

Amazon-style marketplace settlement model:

  * Customer pays the full amount to the platform (unchanged — no existing
    checkout/payment logic is touched).
  * When an order reaches DELIVERED, a per-warehouse settlement is *armed*
    with due_at = delivery anchor + return/exchange/cancellation window
    (system_settings 'vendor_settlement_window_days', falls back to the
    referral window, then 7 days — same window the refund flow enforces).
  * Once the window passes AND the order is still valid (no pending/approved
    refund request, not cancelled/refunded), the sweep credits the warehouse
    wallet and marks the settlement 'settled'.
  * Settled amount = product value actually received (order_items subtotal
    minus proportional returned qty) minus the order's applied discount,
    minus platform commission (system_settings 'vendor_commission_rate',
    default 3%).
  * Delivery fee, platform fee and fitting charges are platform revenue and
    are NEVER part of a vendor settlement.
  * Tax (TDS/GST) is reserved via the tax_deducted column (default 0) for
    future use — nothing is deducted today.

The sweep is idempotent and runs on a timer (see app.py scheduler), mirroring
the existing referral-reward sweep. Settlement attribution follows order
fulfillment: the warehouse recorded in warehouse_order_assignments (falling
back to orders.dark_store_id / store_id) receives the settlement.
"""

import os
import sys
from datetime import datetime, timedelta

# Add parent directory to path so `from database import get_db` works
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import get_db

DEFAULT_COMMISSION_RATE = 3.0
DEFAULT_SETTLEMENT_WINDOW_DAYS = 7
VALID_SETTLE_ORDER_STATUS = "DELIVERED"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _open(conn):
    """Returns (conn, owns) — the connection to use and whether we own it."""
    if conn is not None:
        return conn, False
    return get_db(), True


def _row_get(row, key, default=None):
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return default


def _safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _read_setting(cursor, key, default):
    try:
        row = cursor.execute(
            "SELECT value FROM system_settings WHERE key = ?", (key,)
        ).fetchone()
        if row and row[0] is not None:
            value = _safe_float(row[0])
            if value >= 0:
                return value
    except Exception as e:
        print(f"[VENDOR SETTLEMENT] error reading {key}: {e}")
    return default


def get_commission_rate(conn=None):
    """Uniform platform commission % for warehouse settlements (default 3)."""
    conn, owns = _open(conn)
    try:
        return _read_setting(conn, "vendor_commission_rate", DEFAULT_COMMISSION_RATE)
    finally:
        if owns:
            conn.close()


def _get_settlement_window_days_cursor(cursor):
    """Window days from an already-open cursor/connection."""
    days = _read_setting(cursor, "vendor_settlement_window_days", -1)
    if days >= 0:
        return int(days)
    days = _read_setting(cursor, "referral_reward_window_days", -1)
    if days >= 0:
        return int(days)
    return DEFAULT_SETTLEMENT_WINDOW_DAYS


def get_settlement_window_days(conn=None):
    """Return/exchange/cancellation window in days before a settlement pays."""
    conn, owns = _open(conn)
    try:
        return _get_settlement_window_days_cursor(conn)
    finally:
        if owns:
            conn.close()


def _compute_due_at(order_row, cursor=None):
    """Due timestamp = delivery anchor + return window (mirrors referral flow:
    status_delivered_at → delivered_at → created_at)."""
    window_days = (
        _get_settlement_window_days_cursor(cursor)
        if cursor is not None
        else get_settlement_window_days()
    )
    if window_days == 0:
        return datetime.now().isoformat()
    anchor = None
    if order_row is not None:
        for col in ("status_delivered_at", "delivered_at", "created_at"):
            try:
                val = order_row[col]
            except (KeyError, IndexError, TypeError):
                val = None
            if val:
                anchor = val
                break
    try:
        anchor_dt = datetime.fromisoformat(str(anchor)) if anchor else datetime.now()
    except (ValueError, TypeError):
        anchor_dt = datetime.now()
    return (anchor_dt + timedelta(days=window_days)).isoformat()


def _has_open_refund(order_id, cursor):
    """True while a refund/return/exchange request is pending or approved
    (same hold the referral reward uses) — settlement waits for it to resolve."""
    try:
        row = cursor.execute(
            "SELECT COUNT(*) FROM refund_requests WHERE order_id = ? AND UPPER(status) != 'REJECTED'",
            (order_id,),
        ).fetchone()
        return bool(row and row[0])
    except Exception:
        return False


def _resolve_order_warehouse(cursor, order_row):
    """The warehouse that fulfilled this order. Prefers the explicit
    warehouse_order_assignments row, then orders.dark_store_id / store_id."""
    order_id = _row_get(order_row, "id", None)
    if order_id:
        try:
            row = cursor.execute(
                "SELECT warehouse_id FROM warehouse_order_assignments WHERE order_id = ? LIMIT 1",
                (order_id,),
            ).fetchone()
            if row and row[0]:
                return int(row[0])
        except Exception:
            pass
    for col in ("dark_store_id", "store_id"):
        val = _row_get(order_row, col, None)
        if val:
            return int(val)
    return None


def _compute_order_product_value(order_row, cursor):
    """Product value received for this order's settlement:
    sum of order_items.subtotal (scaled by returned qty) minus the order's
    applied discount (offer_usage.discount_applied). Delivery/platform/fitting
    fees are excluded by construction.

    Returns (item_total, discount_share).
    """
    order_id = _row_get(order_row, "id", None)
    gross = 0.0
    if order_id:
        try:
            rows = cursor.execute(
                "SELECT quantity, returned_qty, subtotal FROM order_items WHERE order_id = ?",
                (order_id,),
            ).fetchall()
            for r in rows:
                qty = _safe_float(_row_get(r, "quantity", 1))
                returned = _safe_float(_row_get(r, "returned_qty", 0))
                effective = max(qty - returned, 0.0)
                subtotal = _safe_float(_row_get(r, "subtotal", 0))
                if qty > 0:
                    gross += subtotal * (effective / qty)
        except Exception as e:
            print(f"[VENDOR SETTLEMENT] error reading order_items for {order_id}: {e}")

    discount = 0.0
    if order_id:
        try:
            row = cursor.execute(
                "SELECT discount_applied FROM offer_usage WHERE order_id = ? ORDER BY id DESC LIMIT 1",
                (order_id,),
            ).fetchone()
            if row and row[0] is not None:
                discount = _safe_float(row[0])
        except Exception:
            discount = 0.0

    discount_share = min(discount, gross) if gross > 0 else 0.0
    item_total = max(gross - discount_share, 0.0)
    return round(item_total, 2), round(discount_share, 2)


def _credit_wallet(cursor, warehouse_id, amount):
    """Credits the warehouse wallet (creates the wallet row if missing)."""
    if amount <= 0:
        return
    cursor.execute(
        "INSERT OR IGNORE INTO vendor_wallets (warehouse_id, balance, lifetime_earnings) VALUES (?, 0, 0)",
        (warehouse_id,),
    )
    cursor.execute(
        "UPDATE vendor_wallets SET balance = balance + ?, lifetime_earnings = lifetime_earnings + ?, "
        "updated_at = CURRENT_TIMESTAMP WHERE warehouse_id = ?",
        (amount, amount, warehouse_id),
    )


# ---------------------------------------------------------------------------
# engine
# ---------------------------------------------------------------------------

def arm_order_settlements(order_id, conn=None):
    """Creates the pending settlement row for a DELIVERED order (idempotent via
    UNIQUE(order_id, warehouse_id)). Returns 1 when armed, else 0."""
    conn, owns = _open(conn)
    try:
        cursor = conn.cursor()
        order = cursor.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not order:
            return 0
        status = str(_row_get(order, "order_status", "") or "").upper()
        if status != VALID_SETTLE_ORDER_STATUS:
            return 0
        warehouse_id = _resolve_order_warehouse(cursor, order)
        if not warehouse_id:
            return 0
        due_at = _compute_due_at(order, cursor)
        rate = _read_setting(cursor, "vendor_commission_rate", DEFAULT_COMMISSION_RATE)
        cursor.execute(
            """
            INSERT OR IGNORE INTO vendor_settlements
                (order_id, warehouse_id, item_total, discount_share, commission_rate,
                 commission_amount, tax_deducted, net_amount, status, settlement_due_at)
            VALUES (?, ?, 0, 0, ?, 0, 0, 0, 'pending', ?)
            """,
            (order_id, warehouse_id, rate, due_at),
        )
        # Re-arm a previously-voided settlement when the order is delivered
        # again (e.g. admin cancels the order, then re-confirms/delivers it).
        # The UNIQUE(order_id, warehouse_id) guard would otherwise block the
        # INSERT above and the warehouse would never be paid. Void rows were
        # never credited, so resetting them to pending with a fresh due date
        # is safe and idempotent.
        cursor.execute(
            """
            UPDATE vendor_settlements
            SET status = 'pending', settlement_due_at = ?, commission_rate = ?,
                item_total = 0, discount_share = 0, commission_amount = 0,
                tax_deducted = 0, net_amount = 0, settled_at = NULL
            WHERE order_id = ? AND warehouse_id = ? AND status = 'void'
            """,
            (due_at, rate, order_id, warehouse_id),
        )
        conn.commit()
        return 1
    finally:
        if owns:
            conn.close()


def settle_due_settlements(conn=None):
    """Settles every due, still-valid settlement into warehouse wallets and
    voids settlements whose order was cancelled/refunded. Idempotent.
    Returns (settled_count, voided_count)."""
    conn, owns = _open(conn)
    try:
        cursor = conn.cursor()

        # 1. Void pending settlements whose order is no longer deliverable
        #    (cancelled / refunded / rejected) — immediately, regardless of due
        #    date, so cancelled orders don't linger as 'pending' until their
        #    window would have passed.
        cursor.execute(
            """
            UPDATE vendor_settlements SET status = 'void'
            WHERE status = 'pending'
              AND order_id IN (
                  SELECT id FROM orders
                  WHERE UPPER(COALESCE(order_status, '')) != 'DELIVERED'
              )
            """
        )
        voided = cursor.rowcount or 0

        # 2. Settle every due, still-valid settlement into warehouse wallets.
        now = datetime.now().isoformat()
        cursor.execute(
            """
            SELECT id, order_id, warehouse_id, commission_rate
            FROM vendor_settlements
            WHERE status = 'pending'
              AND settlement_due_at IS NOT NULL
              AND settlement_due_at <= ?
            """,
            (now,),
        )
        rows = cursor.fetchall()

        settled = 0
        for srow in rows:
            settlement_id = _row_get(srow, "id", srow[0])
            order_id = _row_get(srow, "order_id", srow[1])
            warehouse_id = _row_get(srow, "warehouse_id", srow[2])
            rate = _safe_float(
                _row_get(srow, "commission_rate", srow[3]), DEFAULT_COMMISSION_RATE
            )

            order = cursor.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
            if not order:
                continue
            # Refund hold: wait until the refund/return request resolves.
            if _has_open_refund(order_id, cursor):
                continue

            item_total, discount_share = _compute_order_product_value(order, cursor)
            commission_amount = round(item_total * rate / 100.0, 2)
            net_amount = round(max(item_total - commission_amount, 0.0), 2)

            cursor.execute(
                """
                UPDATE vendor_settlements
                SET item_total = ?, discount_share = ?, commission_amount = ?,
                    net_amount = ?, status = 'settled', settled_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (item_total, discount_share, commission_amount, net_amount, settlement_id),
            )
            _credit_wallet(cursor, warehouse_id, net_amount)
            settled += 1

        conn.commit()
        if settled or voided:
            print(f"[VENDOR SETTLEMENT] settled={settled} voided={voided}")
        return settled, voided
    finally:
        if owns:
            conn.close()


def run_vendor_settlement_sweep(conn=None):
    """Full sweep: arm newly-DELIVERED orders, then settle due ones.
    Returns (armed, settled, voided)."""
    conn, owns = _open(conn)
    try:
        cursor = conn.cursor()
        armed = 0
        try:
            cursor.execute(
                """
                SELECT o.id FROM orders o
                WHERE o.order_status = 'DELIVERED'
                  AND (
                      NOT EXISTS (
                          SELECT 1 FROM vendor_settlements vs WHERE vs.order_id = o.id
                      )
                      OR EXISTS (
                          SELECT 1 FROM vendor_settlements vs
                          WHERE vs.order_id = o.id AND vs.status = 'void'
                      )
                  )
                """
            )
            for row in cursor.fetchall():
                if arm_order_settlements(_row_get(row, "id", row[0]), conn=conn):
                    armed += 1
        except Exception as e:
            print(f"[VENDOR SETTLEMENT] arm pass failed: {e}")

        settled, voided = settle_due_settlements(conn=conn)
        return armed, settled, voided
    finally:
        if owns:
            conn.close()


# ---------------------------------------------------------------------------
# payouts (withdrawal requests)
# ---------------------------------------------------------------------------

def request_vendor_payout(warehouse_id, amount, conn=None):
    """Owner withdraw: holds the amount out of the wallet and creates a
    'requested' payout. Returns (ok, message)."""
    if amount is None or amount <= 0:
        return False, "Amount must be greater than zero"
    conn, owns = _open(conn)
    try:
        cursor = conn.cursor()
        cursor.execute("INSERT OR IGNORE INTO vendor_wallets (warehouse_id, balance, lifetime_earnings) VALUES (?, 0, 0)", (warehouse_id,))
        row = cursor.execute(
            "SELECT balance FROM vendor_wallets WHERE warehouse_id = ?", (warehouse_id,)
        ).fetchone()
        balance = _safe_float(_row_get(row, "balance", 0)) if row else 0.0
        if balance < amount:
            return False, "Insufficient wallet balance"
        cursor.execute(
            "UPDATE vendor_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE warehouse_id = ?",
            (amount, warehouse_id),
        )
        cursor.execute(
            "INSERT INTO vendor_payouts (warehouse_id, amount, status) VALUES (?, ?, 'requested')",
            (warehouse_id, amount),
        )
        conn.commit()
        return True, "Payout requested"
    finally:
        if owns:
            conn.close()


def process_vendor_payout(payout_id, decision, admin_note=None, conn=None):
    """Admin action on a payout request. decision: 'paid' or 'rejected'.
    Rejection refunds the held amount back to the wallet."""
    conn, owns = _open(conn)
    try:
        cursor = conn.cursor()
        row = cursor.execute(
            "SELECT id, warehouse_id, amount, status FROM vendor_payouts WHERE id = ?",
            (payout_id,),
        ).fetchone()
        if not row:
            return False, "Payout not found"
        status = str(_row_get(row, "status", "") or "").lower()
        if status != "requested":
            return False, f"Payout already {status}"
        warehouse_id = _row_get(row, "warehouse_id", row[1])
        amount = _safe_float(_row_get(row, "amount", 0))

        if decision == "paid":
            new_status = "paid"
        elif decision == "rejected":
            new_status = "rejected"
            _credit_wallet(cursor, warehouse_id, amount)
        else:
            return False, "Invalid decision"

        cursor.execute(
            "UPDATE vendor_payouts SET status = ?, admin_note = ?, processed_at = CURRENT_TIMESTAMP, "
            "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (new_status, admin_note, payout_id),
        )
        conn.commit()
        return True, f"Payout {new_status}"
    finally:
        if owns:
            conn.close()
