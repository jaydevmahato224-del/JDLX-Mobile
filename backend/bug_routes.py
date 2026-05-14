import os
import uuid
import datetime
from flask import Blueprint, request, current_app
from werkzeug.utils import secure_filename
from functools import wraps
from auth.role_guard import _current_user_claims
from database import get_db
from utils.response_utils import success_response, error_response

bug_bp = Blueprint('bug', __name__)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp', 'gif'}
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads', 'bug_reports')

VALID_PAGE_LOCATIONS = {
    'Home page', 'Product listing', 'Product detail page',
    'Cart', 'Checkout / Payment', 'My orders',
    'Login / Signup', 'Other'
}

VALID_SEVERITIES = {'Low', 'Medium', 'High', 'Critical'}

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

@bug_bp.route('/api/bug-report', methods=['POST'])
@token_required
def submit_bug_report():
    user_id = request.user.get('user_id')
    
    # Get form data
    page_location = request.form.get('page_location')
    severity = request.form.get('severity')
    description = request.form.get('description')
    steps_to_reproduce = request.form.get('steps_to_reproduce')
    browser = request.form.get('browser')
    os_name = request.form.get('os')
    screen_resolution = request.form.get('screen_resolution')
    page_url = request.form.get('page_url')
    user_agent = request.form.get('user_agent')

    # Basic Validation
    if not all([page_location, severity, description]):
        return error_response("page_location, severity, and description are required", 400)

    if severity not in VALID_SEVERITIES:
        return error_response(f"Invalid severity. Allowed: {', '.join(VALID_SEVERITIES)}", 400)

    if page_location not in VALID_PAGE_LOCATIONS:
        return error_response(f"Invalid page location. Allowed: {', '.join(VALID_PAGE_LOCATIONS)}", 400)

    if len(description) < 20:
        return error_response("Description must be at least 20 characters long", 400)

    # Handle Screenshot Upload
    screenshot_path = None
    if 'screenshot' in request.files:
        file = request.files['screenshot']
        if file and file.filename != '':
            if not allowed_file(file.filename):
                return error_response("Invalid file extension. Allowed: png, jpg, jpeg, webp, gif", 400)
            
            os.makedirs(UPLOAD_FOLDER, exist_ok=True)
            ext = file.filename.rsplit('.', 1)[1].lower()
            filename = f"{uuid.uuid4().hex}.{ext}"
            file_path = os.path.join(UPLOAD_FOLDER, filename)
            file.save(file_path)
            screenshot_path = f"/static/uploads/bug_reports/{filename}"

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO bug_reports (
                user_id, page_location, severity, description, steps_to_reproduce,
                screenshot_path, browser, os, screen_resolution, page_url,
                user_agent, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New')
        """, (
            user_id, page_location, severity, description, steps_to_reproduce,
            screenshot_path, browser, os_name, screen_resolution, page_url,
            user_agent
        ))
        conn.commit()
        bug_id = cursor.lastrowid
        return success_response({"bug_id": bug_id}, "Bug report submitted successfully", 201)
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()

@bug_bp.route('/api/my-bug-reports', methods=['GET'])
@token_required
def list_my_bug_reports():
    user_id = request.user.get('user_id')
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, page_location, severity, description, status, developer_notes, created_at
            FROM bug_reports
            WHERE user_id = ?
            ORDER BY created_at DESC
        """, (user_id,))
        rows = cursor.fetchall()
        
        reports = []
        for row in rows:
            report = dict(row)
            # Truncate description to 100 chars
            if report['description'] and len(report['description']) > 100:
                report['description'] = report['description'][:97] + "..."
            reports.append(report)
            
        return success_response(reports)
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()

@bug_bp.route('/api/my-bug-reports/<int:report_id>', methods=['GET'])
@token_required
def get_bug_report_details(report_id):
    user_id = request.user.get('user_id')
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM bug_reports WHERE id = ?", (report_id,))
        row = cursor.fetchone()
        
        if not row:
            return error_response("Bug report not found", 404)
            
        report = dict(row)
        if report['user_id'] != user_id:
            return error_response("Access denied", 403)
            
        return success_response(report)
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()
