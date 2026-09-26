import os
import uuid
import datetime
from flask import Blueprint, request, current_app
from werkzeug.utils import secure_filename
from functools import wraps
from auth.role_guard import _current_user_claims
from database import get_db
from utils.response_utils import success_response, error_response

refund_bp = Blueprint('refund', __name__)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads', 'refunds')

# 'Refund only' was removed: a payout without the item ever coming back is not
# an offered flow. Users must choose 'Return and Refund' (item goes back) or
# 'Exchange'. Old rows in the DB may still carry 'Refund only' — read paths
# render whatever is stored, only NEW submissions are restricted.
VALID_REQUEST_TYPES = {'Return and Refund', 'Exchange'}
VALID_REASONS = {
    'Item damaged on arrival', 'Wrong item delivered',
    'Item not as described', 'Changed my mind',
    'Item stopped working', 'Other'
}

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

@refund_bp.route('/api/refund-request', methods=['POST'])
@token_required
def submit_refund_request():
    """RETIRED: customers no longer raise refunds directly.

    Refund authority moved to the warehouse returns pipeline (see
    warehouse_returns.py): customers file a complaint at POST /api/complaint,
    the warehouse decides return/exchange/refund. This endpoint is kept as an
    explicit 410 so stale storefront builds fail loudly instead of silently
    creating orphan rows the pipeline never sees.
    """
    return error_response(
        "Direct refund requests are discontinued. Please raise a product issue from "
        "Support → Report an Issue; the warehouse will review it and issue any "
        "refund through the returns process.",
        410,
    )


@refund_bp.route('/api/refund-requests', methods=['GET'])
@token_required
def list_refund_requests():
    """Customer's refund history (read-only, includes pipeline refunds).

    Rows created by the warehouse returns pipeline (source='warehouse_complaint')
    show the same fields — the storefront history page remains useful for
    legacy rows and for tracking pipeline-approved refunds.
    """
    user_id = request.user.get('user_id')
    conn = get_db()
    try:
        query = """
            SELECT r.*, o.total_amount as order_amount, o.created_at as order_date
            FROM refund_requests r
            JOIN orders o ON r.order_id = o.id
            WHERE r.user_id = ?
            ORDER BY r.created_at DESC
        """
        rows = conn.execute(query, (user_id,)).fetchall()
        return success_response([dict(row) for row in rows])
    finally:
        conn.close()

@refund_bp.route('/api/refund-requests/<int:request_id>', methods=['GET'])
@token_required
def get_refund_details(request_id):
    user_id = request.user.get('user_id')
    conn = get_db()
    try:
        query = """
            SELECT r.*, o.total_amount as order_amount, o.created_at as order_date, o.order_status as order_status
            FROM refund_requests r
            JOIN orders o ON r.order_id = o.id
            WHERE r.id = ? AND r.user_id = ?
        """
        row = conn.execute(query, (request_id, user_id)).fetchone()
        
        if not row:
            return error_response("Request not found or access denied", 403)
            
        return success_response(dict(row))
    finally:
        conn.close()

@refund_bp.route('/api/refund-eligibility/<int:order_id>', methods=['GET'])
@token_required
def check_refund_eligibility(order_id):
    user_id = request.user.get('user_id')
    conn = get_db()
    try:
        order = conn.execute(
            "SELECT id, order_status as status, total_amount, created_at, status_delivered_at FROM orders WHERE id = ? AND user_id = ?",
            (order_id, user_id)
        ).fetchone()

        if not order:
            return success_response({"eligible": False, "reason": "Order not found"})

        status = (order['status'] or '').lower()
        if status not in ['delivered', 'completed']:
            return success_response({"eligible": False, "reason": "Order has not been delivered yet"})

        delivery_time_str = order['status_delivered_at'] or order['created_at']
        try:
            delivery_time = datetime.datetime.fromisoformat(delivery_time_str)
        except (ValueError, TypeError):
            delivery_time = datetime.datetime.now()

        # Same IST alignment as above — DB stores IST wall-clock.
        now_ist = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
        delta = now_ist - delivery_time
        if delta.days > 7:
            return success_response({"eligible": False, "reason": "The 7-day return window has expired"})

        existing = conn.execute(
            "SELECT status FROM refund_requests WHERE order_id = ? AND user_id = ?",
            (order_id, user_id)
        ).fetchone()

        if existing and existing['status'] != 'Rejected':
            return success_response({"eligible": False, "reason": "A refund request for this order has already been submitted"})

        return success_response({
            "eligible": True,
            "order_amount": order['total_amount'],
            "days_remaining": 7 - delta.days
        })
    finally:
        conn.close()
