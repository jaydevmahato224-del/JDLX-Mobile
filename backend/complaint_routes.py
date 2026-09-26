"""
Complaint / Return / Exchange Routes
====================================
SINGLE entry point for every post-delivery product issue. Customers file a
complaint here (optionally with a return/exchange intent); the warehouse that
fulfilled the order resolves it from its own panel:

    Customer complaint (Pending)
        → warehouse DECIDES: accept-return | accept-exchange | refund-only | reject
        → pickup triggered → picked up → verified at warehouse
        → replacement dispatched (exchange) OR refund raised for admin payout

Direct customer refund requests are retired: refund decisions belong to the
warehouse, the admin panel only executes the payout (see warehouse_returns.py).
"""
import os
import uuid
import datetime
from flask import Blueprint, request, current_app
from werkzeug.utils import secure_filename
from functools import wraps
from auth.role_guard import _current_user_claims
from database import get_db, ist_now_str
from utils.response_utils import success_response, error_response
from notifications.notification_service import notification_service
import product_rules

complaint_bp = Blueprint('complaint', __name__)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads', 'complaints')

# Complaint categories; the first three are product problems that can carry a
# return/exchange intent. Pure service issues (missing item, other) stay
# plain complaints — warehouse replies, nothing ships back.
PRODUCT_ISSUE_TYPES = ('Damaged product', 'Wrong product delivered', 'Product not working')
ALL_ISSUE_TYPES = PRODUCT_ISSUE_TYPES + ('Missing item in order', 'Other')

VALID_ACTIONS = ('return', 'exchange')


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user_claims, error = _current_user_claims()
        if error:
            message, code = error
            return error_response(message, code)
        return f(*args, **kwargs)
    return decorated


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def _order_products(conn, order_id):
    """Product ids for an order (deduplicated, order preserved)."""
    rows = conn.execute(
        "SELECT DISTINCT product_id FROM order_items WHERE order_id = ?", (order_id,)
    ).fetchall()
    return [r['product_id'] for r in rows if r['product_id'] is not None]


def _resolve_warehouse_id(conn, order_id):
    """Warehouse that fulfilled this order (assignment created at pack time)."""
    row = conn.execute(
        """SELECT warehouse_id FROM warehouse_order_assignments
           WHERE order_id = ? ORDER BY id DESC LIMIT 1""",
        (order_id,),
    ).fetchone()
    return row['warehouse_id'] if row else None


def _notify_user(user_id, title, message, complaint_id):
    try:
        notification_service.notify_user_internal(
            user_id, title, message, 'ORDER', url=f"/profile/my-requests?complaint={complaint_id}"
        )
    except Exception:
        current_app.logger.warning("Complaint notification failed", exc_info=True)


def _notify_warehouse(conn, warehouse_id, title, message):
    """In-app bell notification for the warehouse partner.

    Commits on the SHARED request connection — this helper is called after the
    main handler already committed, and the request-scoped connection's
    deferred close would otherwise roll this INSERT away.
    """
    if not warehouse_id:
        return
    try:
        conn.execute(
            "INSERT INTO warehouse_notifications (warehouse_id, title, message, type) VALUES (?, ?, ?, ?)",
            (warehouse_id, title, message, 'RETURN'),
        )
        conn.commit()
    except Exception:
        current_app.logger.warning("Warehouse notification failed", exc_info=True)


@complaint_bp.route('/api/complaint', methods=['POST'])
@token_required
def post_complaint():
    """Unified product-issue complaint (optionally return/exchange request).

    Rules are resolved live per product (product → category → global settings),
    never hard-coded. The complaint is routed to the warehouse that packed the
    order; if the order has no warehouse assignment yet, warehouse_id stays
    NULL and it surfaces on the admin side instead (never lost).
    """
    user_id = request.user.get('user_id')
    order_id = request.form.get('order_id')
    issue_type = request.form.get('issue_type')
    description = request.form.get('description')
    requested_action = (request.form.get('requested_action') or '').strip().lower() or None
    product_id_raw = request.form.get('product_id')

    if not order_id or not issue_type or not description:
        return error_response("Missing required fields", 400)

    if issue_type not in ALL_ISSUE_TYPES:
        return error_response("Invalid issue type", 400)

    if requested_action is not None and requested_action not in VALID_ACTIONS:
        return error_response("requested_action must be 'return' or 'exchange'", 400)

    # A return/exchange intent only makes sense for a product problem
    if requested_action and issue_type not in PRODUCT_ISSUE_TYPES:
        return error_response(
            "Return/exchange can only be requested for a product issue "
            "(damaged / wrong / not working)", 400
        )

    conn = get_db()
    try:
        # Verify order belongs to user
        order = conn.execute(
            """SELECT id, order_status, status_delivered_at, created_at
               FROM orders WHERE id = ? AND user_id = ?""",
            (order_id, user_id),
        ).fetchone()

        if not order:
            return error_response("Order not found or access denied", 403)

        # Product scope: a specific product, or the whole order
        order_product_ids = _order_products(conn, order_id)
        if not order_product_ids:
            return error_response("This order has no products to raise an issue on", 400)

        target_pid = None
        if product_id_raw not in (None, '', 'all'):
            try:
                target_pid = int(product_id_raw)
            except (TypeError, ValueError):
                return error_response("Invalid product_id", 400)
            if target_pid not in order_product_ids:
                return error_response("This product is not part of the order", 400)
        scope_ids = [target_pid] if target_pid else order_product_ids

        # How many open complaints already exist on this order?
        existing_open = conn.execute(
            """SELECT COUNT(*) FROM complaints
               WHERE order_id = ? AND LOWER(status) IN ('pending', 'approved',
                     'pickup_scheduled', 'picked_up', 'in_review', 'exchange_pending', 'refund_requested')""",
            (order_id,),
        ).fetchone()[0]

        # ---- Product rules (flexible, per product; strictest merge) ----
        if requested_action:
            # For single-product complaints the rule set is exact; whole-order
            # complaints merge to the strictest interpretation.
            if len(scope_ids) == 1:
                rules = product_rules.get_effective_rules(scope_ids[0])
            else:
                rules = product_rules.get_effective_rules(None)
                per = product_rules.get_rules_snapshot(scope_ids)
                for r in per.values():
                    rules['return_enabled'] = bool(rules.get('return_enabled')) and bool(r.get('return_enabled'))
                    rules['exchange_enabled'] = bool(rules.get('exchange_enabled')) and bool(r.get('exchange_enabled'))
                    try:
                        if float(r.get('window_days') or 0) < float(rules.get('window_days') or 0):
                            rules['window_days'] = r['window_days']
                    except (TypeError, ValueError):
                        pass

            allowed, why, snapshot = product_rules.check_complaint_allowed(
                order, scope_ids, requested_action, existing_open
            )
            if not allowed:
                return error_response(why, 400)
            window_end = snapshot.get('return_window_end')
            rules = snapshot['rules']
        else:
            # Plain complaint (service issue): no product-rule gating, but the
            # per-order open cap still applies to keep the queue clean.
            rules = product_rules.get_effective_rules(scope_ids[0]) if len(scope_ids) == 1 else product_rules.get_effective_rules(None)
            window_end = product_rules.compute_return_window_end(rules, order['status_delivered_at'] or order['created_at'])
            cap = rules.get('max_requests_per_order')
            try:
                cap = int(cap)
            except (TypeError, ValueError):
                cap = 1
            if cap > 0 and existing_open >= cap:
                return error_response(
                    f"This order already has {existing_open} open request(s). "
                    f"Policy allows at most {cap} at a time.", 400
                )

        # ---- Route to warehouse ----
        warehouse_id = _resolve_warehouse_id(conn, order_id)

        photo_path = None
        if 'photo' in request.files:
            file = request.files['photo']
            if file and file.filename != '':
                if not allowed_file(file.filename):
                    return error_response("Invalid file extension. Allowed: png, jpg, jpeg, webp", 400)
                os.makedirs(UPLOAD_FOLDER, exist_ok=True)
                ext = file.filename.rsplit('.', 1)[1].lower()
                filename = f"{uuid.uuid4().hex}.{ext}"
                file_path = os.path.join(UPLOAD_FOLDER, filename)
                file.save(file_path)
                photo_path = f"/static/uploads/complaints/{filename}"

        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO complaints (user_id, order_id, issue_type, description,
                                       photo_path, status, admin_reply, warehouse_id,
                                       requested_action, return_window_end)
               VALUES (?, ?, ?, ?, ?, 'Pending', NULL, ?, ?, ?)""",
            (user_id, order_id, issue_type, description, photo_path,
             warehouse_id, requested_action, window_end),
        )
        complaint_id = cursor.lastrowid
        conn.commit()

        # ---- Notifications (never break the submit) ----
        _notify_warehouse(
            conn, warehouse_id,
            "New product issue raised",
            f"Order #{order_id}: {issue_type}"
            + (f" — customer requested {requested_action.upper()}" if requested_action else ""),
        )
        _notify_user(
            user_id, "Request received",
            f"Your {requested_action + ' ' if requested_action else ''}request for order #{order_id} "
            "has been sent to the warehouse. We'll update you shortly.",
            complaint_id,
        )

        return success_response({
            "complaint_id": complaint_id,
            "warehouse_id": warehouse_id,
            "requested_action": requested_action,
            "return_window_end": window_end,
        }, "Complaint submitted successfully", 201)
    finally:
        conn.close()


@complaint_bp.route('/api/my-requests', methods=['GET'])
@token_required
def get_my_requests():
    """Customer view: complaints WITH their warehouse returns pipeline state."""
    user_id = request.user.get('user_id')
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT c.id, c.order_id, c.issue_type, c.description, c.status,
                      c.admin_reply, c.resolution, c.requested_action,
                      c.return_window_end, c.created_at,
                      o.order_number,
                      cr.decision, cr.pickup_status, cr.pickup_code,
                      cr.verification_status, cr.exchange_status
               FROM complaints c
               JOIN orders o ON o.id = c.order_id
               LEFT JOIN complaint_returns cr ON cr.complaint_id = c.id
               WHERE c.user_id = ?
               ORDER BY c.created_at DESC""",
            (user_id,),
        ).fetchall()

        requests_list = []
        for row in rows:
            try:
                dt = datetime.datetime.fromisoformat(row['created_at']) if isinstance(row['created_at'], str) else row['created_at']
                formatted_date = dt.strftime("%d %b %Y")
            except Exception:
                formatted_date = row['created_at']

            requests_list.append({
                "id": row['id'],
                "type": "Complaint",
                "order_id": row['order_id'],
                "order_number": row['order_number'],
                "issue_type": row['issue_type'],
                "description": row['description'],
                "status": row['status'],
                "admin_reply": row['admin_reply'],
                "resolution": row['resolution'],
                "requested_action": row['requested_action'],
                "return_window_end": row['return_window_end'],
                "created_at": formatted_date,
                "returns": {
                    "decision": row['decision'],
                    "pickup_status": row['pickup_status'],
                    "pickup_code": row['pickup_code'],
                    "verification_status": row['verification_status'],
                    "exchange_status": row['exchange_status'],
                } if row['decision'] else None,
            })

        return success_response(requests_list, "Requests retrieved successfully")
    finally:
        conn.close()


@complaint_bp.route('/api/complaint/<int:complaint_id>', methods=['GET'])
@token_required
def get_complaint_detail(complaint_id):
    """Single complaint detail (owner or admin/warehouse role) with pipeline state."""
    user_id = request.user.get('user_id')
    role = request.user.get('role', 'user')
    conn = get_db()
    try:
        row = conn.execute(
            """SELECT c.*, o.order_number, o.total_amount
               FROM complaints c JOIN orders o ON o.id = c.order_id
               WHERE c.id = ?""",
            (complaint_id,),
        ).fetchone()
        if not row:
            return error_response("Complaint not found", 404)
        if row['user_id'] != user_id and role not in ('admin', 'super_admin'):
            return error_response("Access denied", 403)

        cr = conn.execute(
            "SELECT * FROM complaint_returns WHERE complaint_id = ?", (complaint_id,)
        ).fetchone()

        data = dict(row)
        data['returns'] = dict(cr) if cr else None
        return success_response(data)
    finally:
        conn.close()


@complaint_bp.route('/api/complaint/<int:complaint_id>/cancel', methods=['POST'])
@token_required
def cancel_complaint(complaint_id):
    """Customer cancels own complaint — only while it's still Pending."""
    user_id = request.user.get('user_id')
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id, user_id, status, order_id FROM complaints WHERE id = ?",
            (complaint_id,),
        ).fetchone()
        if not row or row['user_id'] != user_id:
            return error_response("Complaint not found or access denied", 403)
        if (row['status'] or 'Pending') != 'Pending':
            return error_response("Only requests that are still pending can be cancelled", 400)

        conn.execute(
            "UPDATE complaints SET status = 'Cancelled', admin_reply = 'Cancelled by customer' WHERE id = ?",
            (complaint_id,),
        )
        conn.commit()
        return success_response({"complaint_id": complaint_id}, "Request cancelled")
    finally:
        conn.close()


@complaint_bp.route('/api/my-orders', methods=['GET'])
@token_required
def get_my_orders_dropdown():
    """Order dropdown for the complaint form (all orders) — also feeds
    /profile/refund-request historically; that page is retired."""
    user_id = request.user.get('user_id')
    conn = get_db()
    try:
        query = """
            SELECT o.id, o.order_number, o.created_at, o.order_status, GROUP_CONCAT(p.name, ', ') as product_names
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN products p ON oi.product_id = p.id
            WHERE o.user_id = ?
            GROUP BY o.id
            ORDER BY o.created_at DESC
        """
        rows = conn.execute(query, (user_id,)).fetchall()

        orders = []
        for row in rows:
            orders.append({
                "id": row['id'],
                "order_number": row['order_number'] or f"ORD-{row['id']}",
                "created_at": row['created_at'],
                "order_status": row['order_status'],
                "product_names": row['product_names'],
            })
        return success_response(orders)
    finally:
        conn.close()


@complaint_bp.route('/api/complaint-options/<int:order_id>', methods=['GET'])
@token_required
def get_complaint_options(order_id):
    """What the customer may request for this order RIGHT NOW (drives the UI).

    Resolves the effective product rules (product → category → global) and
    returns which actions are enabled, the window deadline and per-product
    detail so the complaint form can render exactly what policy allows.
    """
    user_id = request.user.get('user_id')
    conn = get_db()
    try:
        order = conn.execute(
            """SELECT id, order_status, status_delivered_at, created_at
               FROM orders WHERE id = ? AND user_id = ?""",
            (order_id, user_id),
        ).fetchone()
        if not order:
            return error_response("Order not found or access denied", 403)

        product_ids = _order_products(conn, order_id)
        existing_open = conn.execute(
            """SELECT COUNT(*) FROM complaints
               WHERE order_id = ? AND LOWER(status) IN ('pending', 'approved',
                     'pickup_scheduled', 'picked_up', 'in_review', 'exchange_pending', 'refund_requested')""",
            (order_id,),
        ).fetchone()[0]

        per_product = product_rules.get_rules_snapshot(product_ids) if product_ids else {}

        # Strictest merge for the order-level flags
        if product_ids:
            rules = dict(per_product[product_ids[0]])
            for r in per_product.values():
                rules['return_enabled'] = bool(rules.get('return_enabled')) and bool(r.get('return_enabled'))
                rules['exchange_enabled'] = bool(rules.get('exchange_enabled')) and bool(r.get('exchange_enabled'))
                try:
                    if float(r.get('window_days') or 0) < float(rules.get('window_days') or 0):
                        rules['window_days'] = r['window_days']
                except (TypeError, ValueError):
                    pass
        else:
            rules = product_rules.get_effective_rules(None)

        delivered = (order['order_status'] or '').upper() in ('DELIVERED', 'COMPLETED')
        window_end = product_rules.compute_return_window_end(
            rules, order['status_delivered_at'] or order['created_at']
        )
        expired = False
        if delivered and window_end:
            try:
                expired = datetime.datetime.now() > datetime.datetime.fromisoformat(window_end)
            except (ValueError, TypeError):
                expired = False

        cap = rules.get('max_requests_per_order')
        try:
            cap = int(cap)
        except (TypeError, ValueError):
            cap = 1
        cap_reached = cap > 0 and existing_open >= cap

        products = []
        if product_ids:
            placeholders = ",".join("?" * len(product_ids))
            prows = conn.execute(
                f"SELECT id, name, images FROM products WHERE id IN ({placeholders})",
                product_ids,
            ).fetchall()
            for pr in prows:
                r = per_product.get(pr['id'], {})
                products.append({
                    "product_id": pr['id'],
                    "name": pr['name'],
                    "return_enabled": bool(r.get('return_enabled', True)),
                    "exchange_enabled": bool(r.get('exchange_enabled', True)),
                    "window_days": r.get('window_days', 0),
                })

        return success_response({
            "order_id": order_id,
            "delivered": delivered,
            "return_enabled": bool(rules.get('return_enabled')),
            "exchange_enabled": bool(rules.get('exchange_enabled')),
            "window_days": rules.get('window_days'),
            "window_end": window_end,
            "window_expired": expired,
            "requests_open": existing_open,
            "max_requests_per_order": cap,
            "cap_reached": cap_reached,
            "products": products,
        })
    finally:
        conn.close()
