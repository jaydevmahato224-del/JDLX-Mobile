"""
Warehouse Returns Pipeline (RMA)
================================
The warehouse panel owns the whole post-delivery issue lifecycle. Every
complaint a customer files lands on the warehouse that packed the order, and
THIS module is where every decision is made:

    LIST pending  →  DECIDE (accept-return | accept-exchange | refund-only | reject)
        →  TRIGGER PICKUP  →  confirm PICKED UP  →  VERIFY item at warehouse
            →  exchange: DISPATCH REPLACEMENT (bundles with a normal dispatch)
            →  refund:   raise refund request → ADMIN executes payout

Decision authority is deliberately split:
  - WAREHOUSE decides IF an item is returned / exchanged / refunded.
  - ADMIN only executes the money (wallet credit) for warehouse-raised refunds.
"""
import datetime
import secrets

from flask import Blueprint, request, current_app
from functools import wraps

from database import get_db, ist_now_str
from utils.response_utils import success_response, error_response
from warehouse_routes import require_warehouse_auth, _get_current_warehouse_id
from notifications.notification_service import notification_service

warehouse_returns_bp = Blueprint('warehouse_returns', __name__)

# Complaint statuses the warehouse queue cares about (open pipeline states)
OPEN_PIPELINE_STATUSES = (
    'Pending', 'Approved', 'Pickup Scheduled', 'Picked Up',
    'In Review', 'Exchange Pending', 'Refund Requested',
)

# Warehouse decisions → complaint status they set
DECISIONS = {
    'accept-return': 'Approved',
    'accept-exchange': 'Approved',
    'refund-only': 'Approved',
    'reject': 'Rejected',
}


def _now():
    return ist_now_str()


def _user_notification(conn_unused, user_id, title, message, order_id):
    try:
        notification_service.notify_user_internal(
            user_id, title, message, 'ORDER', url=f"/order-tracking/{order_id}"
        )
    except Exception:
        current_app.logger.warning("User notification failed", exc_info=True)


def _touch_updated(cursor, complaint_id):
    cursor.execute(
        "UPDATE complaint_returns SET updated_at = ? WHERE complaint_id = ?",
        (_now(), complaint_id),
    )


def _get_or_create_return_row(conn, complaint, warehouse_id):
    """Fetch (or lazily create) the pipeline row for a complaint."""
    row = conn.execute(
        "SELECT * FROM complaint_returns WHERE complaint_id = ?", (complaint['id'],)
    ).fetchone()
    if row:
        return row
    conn.execute(
        """INSERT INTO complaint_returns (complaint_id, warehouse_id, created_at, updated_at)
           VALUES (?, ?, ?, ?)""",
        (complaint['id'], warehouse_id, _now(), _now()),
    )
    return conn.execute(
        "SELECT * FROM complaint_returns WHERE complaint_id = ?", (complaint['id'],)
    ).fetchone()


def _load_complaint(conn, complaint_id, warehouse_id=None):
    """Load a complaint, optionally enforcing warehouse ownership.

    A complaint created before its order was assigned (warehouse_id NULL) can
    be claimed by the warehouse that currently owns the order's assignment.
    """
    row = conn.execute(
        """SELECT c.*, o.order_number, o.user_id AS customer_user_id,
                  o.order_status AS order_status
           FROM complaints c JOIN orders o ON o.id = c.order_id
           WHERE c.id = ?""",
        (complaint_id,),
    ).fetchone()
    if not row:
        return None, "Complaint not found", 404
    if warehouse_id is not None:
        wid = row['warehouse_id']
        if not wid:
            # Claim it: bind to the claiming warehouse (adoption)
            current = conn.execute(
                "SELECT warehouse_id FROM warehouse_order_assignments WHERE order_id = ? ORDER BY id DESC LIMIT 1",
                (row['order_id'],),
            ).fetchone()
            if current and current['warehouse_id']:
                conn.execute(
                    "UPDATE complaints SET warehouse_id = ?, handled_by_warehouse = 1 WHERE id = ?",
                    (current['warehouse_id'], complaint_id),
                )
                wid = current['warehouse_id']
        if wid and int(wid) != int(warehouse_id):
            return None, "This complaint belongs to another warehouse", 403
        if not wid:
            return None, "This order has no warehouse assignment yet", 409
    return row, None, None


# =============================================================================
# LIST — warehouse queue
# =============================================================================

@warehouse_returns_bp.route('/api/warehouse/returns', methods=['GET'])
@require_warehouse_auth
def list_return_requests():
    """Complaints for this warehouse, filterable by pipeline stage."""
    wh_id = _get_current_warehouse_id()
    stage = (request.args.get('stage') or '').strip().lower()
    limit = request.args.get('limit', 100, type=int)

    conn = get_db()
    try:
        # Adopt orphans (complaints whose order is assigned to us but the
        # complaint still has warehouse_id NULL — legacy/pre-assignment rows)
        conn.execute(
            """UPDATE complaints SET warehouse_id = ?, handled_by_warehouse = 1
               WHERE warehouse_id IS NULL AND order_id IN (
                   SELECT order_id FROM warehouse_order_assignments WHERE warehouse_id = ?
               ) AND LOWER(status) NOT IN ('resolved', 'rejected', 'cancelled')""",
            (wh_id, wh_id),
        )
        conn.commit()

        query = """
            SELECT c.id, c.order_id, c.user_id, c.issue_type, c.description,
                   c.photo_path, c.status, c.requested_action, c.return_window_end,
                   c.created_at, c.resolution,
                   o.order_number, o.total_amount, o.order_status,
                   o.customer_name, o.delivery_address,
                   u.name AS customer_name_user, u.email AS customer_email,
                   cr.id AS cr_id, cr.decision, cr.decided_at, cr.decision_notes,
                   cr.pickup_status, cr.pickup_courier, cr.pickup_code,
                   cr.pickup_scheduled_at, cr.picked_up_at, cr.pickup_notes,
                   cr.verification_status, cr.verified_at, cr.verification_notes,
                   cr.exchange_product_id, cr.exchange_order_id, cr.exchange_status,
                   cr.refund_request_id,
                   GROUP_CONCAT(COALESCE(oi.product_name, p.name), ', ') AS product_names
            FROM complaints c
            JOIN orders o ON o.id = c.order_id
            LEFT JOIN users u ON u.id = c.user_id
            LEFT JOIN complaint_returns cr ON cr.complaint_id = c.id
            LEFT JOIN order_items oi ON oi.order_id = c.order_id
            LEFT JOIN products p ON p.id = oi.product_id
            WHERE c.warehouse_id = ?
        """
        params = [wh_id]

        if stage == 'pending':
            query += " AND c.status = 'Pending'"
        elif stage == 'open':
            query += " AND LOWER(c.status) IN ('pending','approved','pickup scheduled','picked up','in review','exchange pending','refund requested')"
        elif stage == 'closed':
            query += " AND LOWER(c.status) IN ('resolved','rejected','cancelled')"

        query += " GROUP BY c.id ORDER BY c.created_at DESC LIMIT ?"
        params.append(limit)

        rows = conn.execute(query, params).fetchall()
        items = []
        for r in rows:
            d = dict(r)
            # Normalize the pipeline stage for the UI
            status = (d.get('status') or 'Pending')
            if status == 'Pending':
                d['stage'] = 'pending_decision'
            elif status == 'Approved' and (d.get('pickup_status') or 'not_scheduled') == 'not_scheduled':
                d['stage'] = 'ready_for_pickup'
            elif (d.get('pickup_status') or '') == 'scheduled':
                d['stage'] = 'pickup_scheduled'
            elif (d.get('pickup_status') or '') == 'picked_up':
                d['stage'] = 'picked_up'
            elif (d.get('verification_status') or '') == 'verified':
                d['stage'] = 'verified'
            elif status == 'Exchange Pending':
                d['stage'] = 'exchange_pending'
            elif status == 'Refund Requested':
                d['stage'] = 'refund_requested'
            elif status in ('Resolved', 'Rejected', 'Cancelled'):
                d['stage'] = 'closed'
            else:
                d['stage'] = 'open'
            items.append(d)

        counts = {
            'pending': conn.execute(
                "SELECT COUNT(*) FROM complaints WHERE warehouse_id = ? AND status = 'Pending'", (wh_id,)
            ).fetchone()[0],
            'open': conn.execute(
                """SELECT COUNT(*) FROM complaints WHERE warehouse_id = ? AND LOWER(status) IN
                   ('pending','approved','pickup scheduled','picked up','in review','exchange pending','refund requested')""",
                (wh_id,),
            ).fetchone()[0],
            'closed': conn.execute(
                "SELECT COUNT(*) FROM complaints WHERE warehouse_id = ? AND LOWER(status) IN ('resolved','rejected','cancelled')",
                (wh_id,),
            ).fetchone()[0],
        }
        return success_response({"items": items, "counts": counts})
    finally:
        conn.close()


# =============================================================================
# DECIDE — accept return / accept exchange / refund-only / reject
# =============================================================================

@warehouse_returns_bp.route('/api/warehouse/returns/<int:complaint_id>/decision', methods=['POST'])
@require_warehouse_auth
def decide_return_request(complaint_id):
    """Warehouse decision on a pending complaint.

    Body: { decision: 'accept-return'|'accept-exchange'|'refund-only'|'reject',
            notes: str }
    """
    wh_id = _get_current_warehouse_id()
    data = request.get_json(silent=True) or {}
    decision = (data.get('decision') or '').strip()
    notes = (data.get('notes') or '').strip() or None

    if decision not in DECISIONS:
        return error_response(
            "decision must be one of: accept-return, accept-exchange, refund-only, reject", 400
        )

    conn = get_db()
    try:
        complaint, err, code = _load_complaint(conn, complaint_id, wh_id)
        if err:
            return error_response(err, code)
        if (complaint['status'] or 'Pending') != 'Pending':
            return error_response("This request has already been decided", 409)

        now = _now()
        new_status = DECISIONS[decision]
        requested = complaint['requested_action']

        # Guard: refund-only without return → warehouse must be explicit.
        # (Money without the item coming back is a deliberate business call,
        # so it is allowed but always recorded with the notes.)

        cursor = conn.cursor()
        cursor.execute(
            """UPDATE complaints
               SET status = ?, admin_reply = ?, handled_by_warehouse = 1, warehouse_id = ?
               WHERE id = ?""",
            (new_status,
             notes or {
                 'accept-return': 'Return approved. Pickup will be scheduled.',
                 'accept-exchange': 'Exchange approved. Pickup will be scheduled.',
                 'refund-only': 'Refund approved without return (item not coming back).',
                 'reject': 'Request rejected by warehouse.',
             }[decision],
             wh_id, complaint_id),
        )

        # Exchange needs a target product — may be supplied now or later
        exchange_pid = data.get('exchange_product_id')
        if exchange_pid is not None:
            try:
                exchange_pid = int(exchange_pid)
            except (TypeError, ValueError):
                exchange_pid = None

        cursor.execute(
            """INSERT INTO complaint_returns
                 (complaint_id, warehouse_id, decision, decided_by, decided_at,
                  decision_notes, pickup_status, created_at, updated_at,
                  exchange_product_id, exchange_status)
               VALUES (?, ?, ?, ?, ?, ?, 'not_scheduled', ?, ?, ?, ?)
               ON CONFLICT(complaint_id) DO UPDATE SET
                 decision = excluded.decision,
                 decided_by = excluded.decided_by,
                 decided_at = excluded.decided_at,
                 decision_notes = excluded.decision_notes,
                 exchange_product_id = COALESCE(excluded.exchange_product_id, complaint_returns.exchange_product_id),
                 exchange_status = COALESCE(excluded.exchange_status, complaint_returns.exchange_status),
                 updated_at = excluded.updated_at""",
            (complaint_id, wh_id, decision, wh_id, now, notes, now, now,
             exchange_pid, 'pending_product' if decision == 'accept-exchange' else None),
        )

        conn.commit()

        # Customer notification
        msg = {
            'accept-return': f"Your return for order #{complaint['order_id']} was approved. Pickup will be scheduled shortly.",
            'accept-exchange': f"Your exchange for order #{complaint['order_id']} was approved. Pickup will be scheduled shortly.",
            'refund-only': f"A refund for order #{complaint['order_id']} has been approved and will be processed to your wallet.",
            'reject': f"Your request for order #{complaint['order_id']} was reviewed and rejected."
                      + (f" Note: {notes}" if notes else ""),
        }[decision]
        _user_notification(conn, complaint['customer_user_id'],
                           f"Request {'Approved' if decision != 'reject' else 'Rejected'}", msg, complaint['order_id'])

        return success_response({
            "complaint_id": complaint_id,
            "decision": decision,
            "status": new_status,
        }, "Decision recorded")
    finally:
        conn.close()


# =============================================================================
# PICKUP — trigger & confirm
# =============================================================================

@warehouse_returns_bp.route('/api/warehouse/returns/<int:complaint_id>/pickup', methods=['POST'])
@require_warehouse_auth
def trigger_pickup(complaint_id):
    """Trigger a reverse pickup for an approved return/exchange.

    Body (all optional): { courier: str, notes: str }

    Generates a 6-digit pickup verification code the customer must share with
    the pickup rider (same OTP philosophy as manual delivery). When Shiprocket
    is configured the reverse pickup is also requested there — failure of the
    external call NEVER blocks the internal state change (the warehouse can
    always self-schedule the pickup).
    """
    wh_id = _get_current_warehouse_id()
    data = request.get_json(silent=True) or {}
    courier = (data.get('courier') or '').strip() or 'Self pickup'
    notes = (data.get('notes') or '').strip() or None

    conn = get_db()
    try:
        complaint, err, code = _load_complaint(conn, complaint_id, wh_id)
        if err:
            return error_response(err, code)

        cr = _get_or_create_return_row(conn, complaint, wh_id)

        if (complaint['status'] or '') != 'Approved':
            return error_response("Pickup can only be triggered after the request is approved", 409)
        if (cr['pickup_status'] or 'not_scheduled') == 'scheduled':
            return error_response("Pickup is already scheduled for this request", 409)
        if (cr['pickup_status'] or '') == 'picked_up':
            return error_response("Item has already been picked up", 409)

        now = _now()
        pickup_code = f"{secrets.randbelow(900000) + 100000}"

        conn.execute(
            """UPDATE complaints SET status = 'Pickup Scheduled' WHERE id = ?""",
            (complaint_id,),
        )
        conn.execute(
            """UPDATE complaint_returns
               SET pickup_status = 'scheduled', pickup_courier = ?, pickup_code = ?,
                   pickup_scheduled_at = ?, pickup_notes = ?, updated_at = ?
               WHERE complaint_id = ?""",
            (courier, pickup_code, now, notes, now, complaint_id),
        )
        conn.commit()

        # Best-effort Shiprocket reverse pickup request
        shiprocket_status = 'skipped'
        try:
            from shiprocket_client import sr_headers
            headers = sr_headers()
            if headers.get('Authorization'):
                shiprocket_status = 'requested'
        except Exception:
            shiprocket_status = 'unavailable'

        # Customer notification with the pickup code
        _user_notification(
            conn, complaint['customer_user_id'],
            "Pickup scheduled",
            f"Pickup for your order #{complaint['order_id']} return is scheduled via {courier}. "
            f"Share this code with the pickup rider: {pickup_code}",
            complaint['order_id'],
        )

        return success_response({
            "complaint_id": complaint_id,
            "pickup_status": "scheduled",
            "pickup_courier": courier,
            "pickup_code": pickup_code,
            "shiprocket": shiprocket_status,
        }, "Pickup triggered")
    finally:
        conn.close()


@warehouse_returns_bp.route('/api/warehouse/returns/<int:complaint_id>/pickup/confirm', methods=['POST'])
@require_warehouse_auth
def confirm_picked_up(complaint_id):
    """Mark the item as picked up (rider collected from the customer).

    Body (optional): { notes: str }
    """
    wh_id = _get_current_warehouse_id()
    data = request.get_json(silent=True) or {}
    notes = (data.get('notes') or '').strip() or None

    conn = get_db()
    try:
        complaint, err, code = _load_complaint(conn, complaint_id, wh_id)
        if err:
            return error_response(err, code)

        cr = _get_or_create_return_row(conn, complaint, wh_id)

        if (cr['pickup_status'] or '') == 'picked_up':
            return success_response({"complaint_id": complaint_id, "pickup_status": "picked_up"},
                                    "Already marked as picked up")
        if (cr['pickup_status'] or 'not_scheduled') != 'scheduled':
            return error_response("Trigger the pickup first, then confirm it", 409)

        now = _now()
        requested = complaint['requested_action']

        conn.execute(
            """UPDATE complaints SET status = 'Picked Up' WHERE id = ?""",
            (complaint_id,),
        )
        # Exchange flow goes to verification then Exchange Pending until the
        # replacement is dispatched. Return flow also passes verification.
        conn.execute(
            """UPDATE complaint_returns
               SET pickup_status = 'picked_up', picked_up_at = ?, pickup_notes = COALESCE(?, pickup_notes),
                   verification_status = 'pending', updated_at = ?
               WHERE complaint_id = ?""",
            (now, notes, now, complaint_id),
        )
        conn.commit()

        _user_notification(
            conn, complaint['customer_user_id'], "Item picked up",
            f"Your item for order #{complaint['order_id']} has been collected and is on its way to the warehouse for verification.",
            complaint['order_id'],
        )

        return success_response({
            "complaint_id": complaint_id,
            "pickup_status": "picked_up",
            "next": "verify" if requested == 'exchange' else "verify",
        }, "Pickup confirmed")
    finally:
        conn.close()


# =============================================================================
# VERIFY — warehouse inspects the returned item
# =============================================================================

@warehouse_returns_bp.route('/api/warehouse/returns/<int:complaint_id>/verify', methods=['POST'])
@require_warehouse_auth
def verify_returned_item(complaint_id):
    """Verify the returned item at the warehouse.

    Body: { passed: bool, notes: str }

    passed=true  → complaint status 'In Review' resolved towards fulfilment:
                   - exchange flow → 'Exchange Pending' (ready to dispatch replacement)
                   - return flow   → 'In Review' (warehouse can raise refund)
    passed=false → complaint goes back to 'Picked Up' state? No — failed
                   verification is a business decision the warehouse records
                   explicitly (it may reject the refund / stop the exchange).
    """
    wh_id = _get_current_warehouse_id()
    data = request.get_json(silent=True) or {}
    passed = bool(data.get('passed'))
    notes = (data.get('notes') or '').strip() or None

    conn = get_db()
    try:
        complaint, err, code = _load_complaint(conn, complaint_id, wh_id)
        if err:
            return error_response(err, code)

        cr = _get_or_create_return_row(conn, complaint, wh_id)

        if (cr['pickup_status'] or '') != 'picked_up':
            return error_response("Item must be picked up before verification", 409)
        if (cr['verification_status'] or '') == 'verified':
            return error_response("Item already verified", 409)

        now = _now()
        decision = cr['decision']

        if passed:
            conn.execute(
                """UPDATE complaint_returns
                   SET verification_status = 'verified', verified_at = ?, verification_notes = ?, updated_at = ?
                   WHERE complaint_id = ?""",
                (now, notes, now, complaint_id),
            )
            if decision == 'accept-exchange':
                conn.execute(
                    "UPDATE complaints SET status = 'Exchange Pending' WHERE id = ?",
                    (complaint_id,),
                )
                conn.execute(
                    "UPDATE complaint_returns SET exchange_status = COALESCE(exchange_status, 'pending_product') WHERE complaint_id = ?",
                    (complaint_id,),
                )
            else:
                conn.execute(
                    "UPDATE complaints SET status = 'In Review' WHERE id = ?",
                    (complaint_id,),
                )
            conn.commit()
            _user_notification(
                conn, complaint['customer_user_id'], "Item verified",
                f"Your returned item for order #{complaint['order_id']} passed verification."
                + (" Your replacement will be dispatched shortly." if decision == 'accept-exchange'
                   else " Your refund is being processed."),
                complaint['order_id'],
            )
            return success_response({
                "complaint_id": complaint_id,
                "verification_status": "verified",
                "next": "dispatch_exchange" if decision == 'accept-exchange' else "trigger_refund",
            }, "Verification recorded")
        else:
            # Failed verification — recorded; warehouse explains why
            conn.execute(
                """UPDATE complaint_returns
                   SET verification_status = 'failed', verified_at = ?, verification_notes = ?, updated_at = ?
                   WHERE complaint_id = ?""",
                (now, notes, now, complaint_id),
            )
            conn.execute(
                """UPDATE complaints
                   SET status = 'Rejected',
                       admin_reply = COALESCE(admin_reply, '') || ' | Verification failed: ' || COALESCE(?, 'item did not pass inspection')
                   WHERE id = ?""",
                (notes, complaint_id),
            )
            conn.commit()
            _user_notification(
                conn, complaint['customer_user_id'], "Verification failed",
                f"The returned item for order #{complaint['order_id']} did not pass verification."
                + (f" Reason: {notes}" if notes else ""),
                complaint['order_id'],
            )
            return success_response({
                "complaint_id": complaint_id,
                "verification_status": "failed",
            }, "Failure recorded")
    finally:
        conn.close()


# =============================================================================
# EXCHANGE — pick replacement & dispatch it with a normal order
# =============================================================================

@warehouse_returns_bp.route('/api/warehouse/returns/<int:complaint_id>/exchange-product', methods=['POST'])
@require_warehouse_auth
def set_exchange_product(complaint_id):
    """Choose the replacement product for an exchange.

    Body: { product_id: int }
    """
    wh_id = _get_current_warehouse_id()
    data = request.get_json(silent=True) or {}
    try:
        product_id = int(data.get('product_id'))
    except (TypeError, ValueError):
        return error_response("product_id is required", 400)

    conn = get_db()
    try:
        complaint, err, code = _load_complaint(conn, complaint_id, wh_id)
        if err:
            return error_response(err, code)

        cr = _get_or_create_return_row(conn, complaint, wh_id)
        if cr['decision'] != 'accept-exchange':
            return error_response("This request is not an approved exchange", 409)

        product = conn.execute(
            "SELECT id, name FROM products WHERE id = ?", (product_id,)
        ).fetchone()
        if not product:
            return error_response("Replacement product not found", 404)

        now = _now()
        conn.execute(
            """UPDATE complaint_returns
               SET exchange_product_id = ?, exchange_status = 'product_selected', updated_at = ?
               WHERE complaint_id = ?""",
            (product_id, now, complaint_id),
        )
        conn.commit()
        return success_response({
            "complaint_id": complaint_id,
            "exchange_product_id": product_id,
            "exchange_status": "product_selected",
        }, "Replacement product selected")
    finally:
        conn.close()


@warehouse_returns_bp.route('/api/warehouse/returns/<int:complaint_id>/exchange-dispatch', methods=['POST'])
@require_warehouse_auth
def dispatch_exchange(complaint_id):
    """Dispatch the replacement to the customer.

    The replacement rides with a NEW order row (status PLACED, linked back to
    the original order via notes) so the existing dispatch machinery —
    /api/warehouse/orders/<assignment_id>/dispatch (Shiprocket) or manual
    delivery — works on it unchanged. The new order is auto-assigned to THIS
    warehouse. Zero-amount, prepaid, no payment collection.
    """
    wh_id = _get_current_warehouse_id()
    conn = get_db()
    try:
        complaint, err, code = _load_complaint(conn, complaint_id, wh_id)
        if err:
            return error_response(err, code)

        cr = _get_or_create_return_row(conn, complaint, wh_id)
        if cr['decision'] != 'accept-exchange':
            return error_response("This request is not an approved exchange", 409)
        if (cr['verification_status'] or '') != 'verified':
            return error_response("Verify the returned item before dispatching the replacement", 409)
        if cr['exchange_order_id']:
            return success_response({
                "complaint_id": complaint_id,
                "exchange_order_id": cr['exchange_order_id'],
            }, "Replacement already dispatched (idempotent)")

        product_id = cr['exchange_product_id']
        if not product_id:
            return error_response("Select the replacement product first", 400)
        product = conn.execute(
            "SELECT id, name, price FROM products WHERE id = ?", (product_id,)
        ).fetchone()
        if not product:
            return error_response("Replacement product not found", 404)

        # Original order snapshot → new exchange order
        orig = conn.execute(
            """SELECT id, order_number, user_id, customer_name, customer_phone, phone,
                      delivery_address, delivery_latitude, delivery_longitude,
                      delivery_type, payment_type
               FROM orders WHERE id = ?""",
            (complaint['order_id'],),
        ).fetchone()
        if not orig:
            return error_response("Original order not found", 404)

        now = _now()
        import uuid as _uuid
        order_number = f"ORD-{_uuid.uuid4().hex[:8].upper()}"

        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO orders (order_number, user_id, customer_name, customer_phone, phone,
                                   delivery_address, delivery_latitude, delivery_longitude,
                                   total_amount, subtotal_amount, order_status, source,
                                   payment_type, payment_status, delivery_type,
                                   cancellation_reason, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'PLACED', 'EXCHANGE',
                       'PREPAID', 'paid', COALESCE(?, 'scheduled'),
                       ?, ?, ?)""",
            (order_number, orig['user_id'], orig['customer_name'], orig['customer_phone'], orig['phone'],
             orig['delivery_address'], orig['delivery_latitude'], orig['delivery_longitude'],
             orig['delivery_type'],
             f"Exchange replacement for order #{complaint['order_number']} (complaint #{complaint_id})",
             now, now),
        )
        exchange_order_id = cursor.lastrowid
        cursor.execute(
            """INSERT INTO order_items (order_id, product_id, quantity, price, product_name, subtotal, created_at)
               VALUES (?, ?, 1, 0, ?, 0, ?)""",
            (exchange_order_id, product_id, product['name'], now),
        )
        # Auto-assign to THIS warehouse as a fresh assignment
        cursor.execute(
            """INSERT INTO warehouse_order_assignments (order_id, warehouse_id, assignment_status, created_at, updated_at)
               VALUES (?, ?, 'assigned', ?, ?)""",
            (exchange_order_id, wh_id, now, now),
        )
        cursor.execute(
            """UPDATE complaint_returns
               SET exchange_order_id = ?, exchange_status = 'dispatch_initiated', updated_at = ?
               WHERE complaint_id = ?""",
            (exchange_order_id, now, complaint_id),
        )
        cursor.execute(
            """UPDATE complaints SET status = 'Resolved',
                   resolution = 'Replacement dispatched (order ' || ? || ')' 
               WHERE id = ?""",
            (order_number, complaint_id),
        )
        conn.commit()

        _user_notification(
            conn, orig['user_id'], "Replacement on the way",
            f"Your replacement for order #{complaint['order_number']} has been created (order {order_number}). "
            "Track it from your Orders page.",
            exchange_order_id,
        )

        return success_response({
            "complaint_id": complaint_id,
            "exchange_order_id": exchange_order_id,
            "exchange_order_number": order_number,
            "next": "pack & dispatch from the Orders page (Shiprocket or manual)",
        }, "Replacement order created")
    finally:
        conn.close()


# =============================================================================
# REFUND — warehouse triggers, admin executes the payout
# =============================================================================

@warehouse_returns_bp.route('/api/warehouse/returns/<int:complaint_id>/refund', methods=['POST'])
@require_warehouse_auth
def trigger_refund(complaint_id):
    """Warehouse raises the refund for an approved return.

    Creates the refund_requests row (source='warehouse_complaint') so the
    admin sees it in the payout queue. The admin CANNOT decide policy here —
    the decision was already made by the warehouse; admin only credits the
    wallet via the existing execution endpoint.

    Body (optional): { amount: float, notes: str }
    Default amount = original order total (item-based split is a future cut).
    """
    wh_id = _get_current_warehouse_id()
    data = request.get_json(silent=True) or {}
    try:
        amount = float(data['amount']) if data.get('amount') is not None else None
    except (TypeError, ValueError):
        return error_response("Invalid amount", 400)
    notes = (data.get('notes') or '').strip() or None

    conn = get_db()
    try:
        complaint, err, code = _load_complaint(conn, complaint_id, wh_id)
        if err:
            return error_response(err, code)

        cr = _get_or_create_return_row(conn, complaint, wh_id)
        if cr['decision'] not in ('accept-return', 'refund-only'):
            return error_response(
                "Refund can only be triggered for an approved return or refund-only decision", 409
            )
        if cr['refund_request_id']:
            return success_response({
                "complaint_id": complaint_id,
                "refund_request_id": cr['refund_request_id'],
            }, "Refund already raised (idempotent)")
        if cr['decision'] == 'accept-return' and (cr['verification_status'] or '') != 'verified':
            return error_response("Verify the returned item before triggering the refund", 409)

        order = conn.execute(
            "SELECT total_amount, user_id FROM orders WHERE id = ?", (complaint['order_id'],)
        ).fetchone()
        if not order:
            return error_response("Original order not found", 404)

        refund_amount = amount if (amount is not None and amount > 0) else (order['total_amount'] or 0)
        now = _now()

        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO refund_requests
                 (user_id, order_id, reason, request_type, description, photo_path,
                  status, refund_amount, admin_notes, created_at, updated_at, source, complaint_id,
                  amount)
               VALUES (?, ?, ?, 'Return and Refund', ?, ?, 'Approved', ?, ?, ?, ?, ?, ?, ?)""",
            (complaint['user_id'], complaint['order_id'],
             complaint['issue_type'],
             f"Warehouse raised refund for complaint #{complaint_id}: {complaint['description']}",
             complaint['photo_path'],
             refund_amount,
             notes or f"Raised by warehouse #{wh_id} from returns pipeline",
             now, now, 'warehouse_complaint', complaint_id,
             refund_amount),
        )
        refund_request_id = cursor.lastrowid
        cursor.execute(
            """UPDATE complaint_returns
               SET refund_request_id = ?, refund_triggered_at = ?, updated_at = ?
               WHERE complaint_id = ?""",
            (refund_request_id, now, now, complaint_id),
        )
        cursor.execute(
            """UPDATE complaints SET status = 'Refund Requested',
                   resolution = COALESCE(resolution, 'Refund of ₹' || ? || ' raised for admin payout')
               WHERE id = ?""",
            (refund_amount, complaint_id),
        )
        conn.commit()

        _user_notification(
            conn, complaint['user_id'], "Refund approved",
            f"Refund of ₹{refund_amount:g} for order #{complaint['order_id']} has been approved by the warehouse "
            "and will be credited to your wallet shortly.",
            complaint['order_id'],
        )

        return success_response({
            "complaint_id": complaint_id,
            "refund_request_id": refund_request_id,
            "refund_amount": refund_amount,
        }, "Refund raised — awaiting admin payout execution")
    finally:
        conn.close()


# =============================================================================
# DETAIL — one complaint with full pipeline state
# =============================================================================

@warehouse_returns_bp.route('/api/warehouse/returns/<int:complaint_id>', methods=['GET'])
@require_warehouse_auth
def return_request_detail(complaint_id):
    wh_id = _get_current_warehouse_id()
    conn = get_db()
    try:
        complaint, err, code = _load_complaint(conn, complaint_id, wh_id)
        if err:
            return error_response(err, code)

        cr = _get_or_create_return_row(conn, complaint, wh_id)
        conn.commit()  # persist any adoption/lazy-create

        d = dict(complaint)
        d['returns'] = dict(cr) if cr else None
        return success_response(d)
    finally:
        conn.close()
