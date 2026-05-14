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

VALID_REQUEST_TYPES = {'Refund only', 'Return and Refund', 'Exchange'}
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
    user_id = request.user.get('user_id')
    order_id = request.form.get('order_id')
    reason = request.form.get('reason')
    request_type = request.form.get('request_type')
    description = request.form.get('description')

    if not all([order_id, reason, request_type, description]):
        return error_response("Missing required fields", 400)

    if request_type not in VALID_REQUEST_TYPES:
        return error_response(f"Invalid request type. Allowed: {', '.join(VALID_REQUEST_TYPES)}", 400)

    if reason not in VALID_REASONS:
        return error_response(f"Invalid reason. Allowed: {', '.join(VALID_REASONS)}", 400)

    conn = get_db()
    try:
        # 1. Verify ownership and get order info
        order = conn.execute(
            "SELECT id, status, total_amount, created_at, status_delivered_at FROM orders WHERE id = ? AND user_id = ?",
            (order_id, user_id)
        ).fetchone()

        if not order:
            return error_response("Order not found or access denied", 403)

        # 2. Check status
        status = (order['status'] or '').lower()
        if status not in ['delivered', 'completed']:
            return error_response("Sirf deliver hue orders ka refund request kar sakte hain", 400)

        # 3. Check 7-day return window
        # Use status_delivered_at if present, else created_at
        delivery_time_str = order['status_delivered_at'] or order['created_at']
        try:
            delivery_time = datetime.datetime.fromisoformat(delivery_time_str)
        except (ValueError, TypeError):
            # Fallback for non-iso strings if any
            delivery_time = datetime.datetime.now() # Should not happen with current DB setup
        
        if (datetime.datetime.now() - delivery_time).days > 7:
            return error_response("The 7-day return window has expired", 400)

        # 4. Check for existing non-rejected request
        existing = conn.execute(
            "SELECT id, status FROM refund_requests WHERE order_id = ? AND user_id = ?",
            (order_id, user_id)
        ).fetchone()

        if existing and existing['status'] != 'Rejected':
            return error_response("A refund request for this order has already been submitted", 409)

        # 5. Handle photo upload
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
                photo_path = f"/static/uploads/refunds/{filename}"

        # 6. Insert request
        refund_amount = order['total_amount']
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO refund_requests (user_id, order_id, reason, request_type, description, photo_path, refund_amount, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')""",
            (user_id, order_id, reason, request_type, description, photo_path, refund_amount)
        )
        conn.commit()
        request_id = cursor.lastrowid

        return success_response({
            "request_id": request_id,
            "refund_amount": refund_amount
        }, "Refund request submitted successfully", 201)
    finally:
        conn.close()

@refund_bp.route('/api/refund-requests', methods=['GET'])
@token_required
def list_refund_requests():
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
            SELECT r.*, o.total_amount as order_amount, o.created_at as order_date, o.status as order_status
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
            "SELECT id, status, total_amount, created_at, status_delivered_at FROM orders WHERE id = ? AND user_id = ?",
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
        
        delta = datetime.datetime.now() - delivery_time
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
