import os
import uuid
import datetime
import jwt
from flask import Blueprint, jsonify, request, current_app
from werkzeug.utils import secure_filename
from functools import wraps
from auth.role_guard import _current_user_claims
from database import get_db
from utils.response_utils import success_response, error_response

complaint_bp = Blueprint('complaint', __name__)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads', 'complaints')

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

@complaint_bp.route('/api/complaint', methods=['POST'])
@token_required
def post_complaint():
    user_id = request.user.get('user_id')
    order_id = request.form.get('order_id')
    issue_type = request.form.get('issue_type')
    description = request.form.get('description')

    if not order_id or not issue_type or not description:
        return error_response("Missing required fields", 400)

    conn = get_db()
    try:
        # Verify order belongs to user
        order = conn.execute(
            "SELECT id FROM orders WHERE id = ? AND user_id = ?",
            (order_id, user_id)
        ).fetchone()

        if not order:
            return error_response("Order not found or access denied", 403)

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
            """INSERT INTO complaints (user_id, order_id, issue_type, description, photo_path, status)
               VALUES (?, ?, ?, ?, ?, 'Pending')""",
            (user_id, order_id, issue_type, description, photo_path)
        )
        conn.commit()
        complaint_id = cursor.lastrowid
        
        return success_response({"complaint_id": complaint_id}, "Complaint submitted successfully", 201)
    finally:
        conn.close()

@complaint_bp.route('/api/my-requests', methods=['GET'])
@token_required
def get_my_requests():
    user_id = request.user.get('user_id')
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT id, order_id, issue_type, description, status, admin_reply, created_at
               FROM complaints WHERE user_id = ? ORDER BY created_at DESC""",
            (user_id,)
        ).fetchall()

        requests_list = []
        for row in rows:
            # Format date as "DD Mon YYYY"
            try:
                # sqlite3 timestamps can be strings
                dt = datetime.datetime.fromisoformat(row['created_at']) if isinstance(row['created_at'], str) else row['created_at']
                formatted_date = dt.strftime("%d %b %Y")
            except Exception:
                formatted_date = row['created_at']

            requests_list.append({
                "id": row['id'],
                "type": "Complaint",
                "order_id": row['order_id'],
                "issue_type": row['issue_type'],
                "description": row['description'],
                "status": row['status'],
                "admin_reply": row['admin_reply'],
                "created_at": formatted_date
            })

        return success_response(requests_list, "Requests retrieved successfully")
    finally:
        conn.close()

@complaint_bp.route('/api/my-orders', methods=['GET'])
@token_required
def get_my_orders_dropdown():
    user_id = request.user.get('user_id')
    conn = get_db()
    try:
        # Fetch orders with product names for dropdown
        query = """
            SELECT o.id, o.created_at, GROUP_CONCAT(p.name, ', ') as product_names
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
                "created_at": row['created_at'],
                "product_names": row['product_names']
            })
            
        return success_response(orders, "Orders retrieved successfully")
    finally:
        conn.close()
