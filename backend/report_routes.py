import os
import uuid
import datetime
from flask import Blueprint, request, current_app
from werkzeug.utils import secure_filename
from functools import wraps
from auth.role_guard import _current_user_claims
from database import get_db
from utils.response_utils import success_response, error_response

report_bp = Blueprint('report', __name__)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads', 'order_reports')

VALID_REPORT_TYPES = {
    'Item not delivered', 'Wrong item received', 'Missing item in package',
    'Damaged in transit', 'Duplicate charge', 'Other'
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

@report_bp.route('/api/order-report', methods=['POST'])
@token_required
def submit_order_report():
    user_id = request.user.get('user_id')
    order_id = request.form.get('order_id')
    report_type = request.form.get('report_type')
    description = request.form.get('description')

    if not order_id or not report_type or not description:
        return error_response("Missing required fields", 400)

    if report_type not in VALID_REPORT_TYPES:
        return error_response(f"Invalid report type. Allowed: {', '.join(VALID_REPORT_TYPES)}", 400)

    conn = get_db()
    try:
        # 1. Verify ownership and check status
        order = conn.execute(
            "SELECT id, order_status FROM orders WHERE id = ? AND user_id = ?",
            (order_id, user_id)
        ).fetchone()

        if not order:
            return error_response("Order not found or access denied", 403)
        
        status = (order['order_status'] or '').lower()
        if status not in ['delivered', 'completed']:
            return error_response("Sirf deliver hue orders report kar sakte hain", 400)

        # 2. Check for duplicate report
        existing = conn.execute(
            "SELECT id FROM order_reports WHERE order_id = ? AND user_id = ?",
            (order_id, user_id)
        ).fetchone()

        if existing:
            return error_response("Is order ki report pehle se submit hai", 409)

        # 3. Handle photo upload
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
                photo_path = f"/static/uploads/order_reports/{filename}"

        # 4. Insert report
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO order_reports (user_id, order_id, report_type, description, photo_path, status)
               VALUES (?, ?, ?, ?, ?, 'Submitted')""",
            (user_id, order_id, report_type, description, photo_path)
        )
        conn.commit()
        report_id = cursor.lastrowid
        
        return success_response({"report_id": report_id}, "Report submitted successfully", 201)
    finally:
        conn.close()

@report_bp.route('/api/order-reports', methods=['GET'])
@token_required
def list_reports():
    user_id = request.user.get('user_id')
    conn = get_db()
    try:
        query = """
            SELECT r.*, o.total_amount, o.created_at as order_date, o.order_number
            FROM order_reports r
            JOIN orders o ON r.order_id = o.id
            WHERE r.user_id = ?
            ORDER BY r.created_at DESC
        """
        rows = conn.execute(query, (user_id,)).fetchall()
        return success_response([dict(row) for row in rows])
    finally:
        conn.close()

@report_bp.route('/api/order-reports/<int:report_id>', methods=['GET'])
@token_required
def get_report_details(report_id):
    user_id = request.user.get('user_id')
    conn = get_db()
    try:
        query = """
            SELECT r.*, o.total_amount, o.created_at as order_date, o.order_number, o.order_status
            FROM order_reports r
            JOIN orders o ON r.order_id = o.id
            WHERE r.id = ? AND r.user_id = ?
        """
        row = conn.execute(query, (report_id, user_id)).fetchone()
        
        if not row:
            return error_response("Report not found or access denied", 403)
            
        return success_response(dict(row))
    finally:
        conn.close()
