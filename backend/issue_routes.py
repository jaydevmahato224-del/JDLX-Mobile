from flask import Blueprint, request
from database import get_db
from utils.response_utils import success_response, error_response
from notifier import send_individual_email
import datetime

issue_bp = Blueprint('issue', __name__)

@issue_bp.route('/api/report-issue', methods=['POST'])
def report_issue():
    data = request.json
    if not data:
        return error_response("No data provided", 400)

    error_type = data.get('error_type')
    page = data.get('page')
    timestamp = data.get('timestamp')
    user_id = data.get('user_id', 'Guest')
    description = data.get('description', '')

    if not all([error_type, page, timestamp]):
        return error_response("Missing required fields", 400)

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO issue_reports (user_id, error_type, page, description, timestamp)
            VALUES (?, ?, ?, ?, ?)
        """, (user_id, error_type, page, description, timestamp))
        conn.commit()
        
        # Send email to admin
        subject = f"🚨 JDLX App Error Report - [{error_type}]"
        body = f"""
        New Error Report from JDLX App:
        
        Error Type: {error_type}
        Page: {page}
        Timestamp: {timestamp}
        User ID: {user_id}
        
        User Description:
        {description if description else 'No description provided.'}
        
        --
        This is an automated report from the JDLX Mobile Error System.
        """
        
        send_individual_email("jdlxofficial@gmail.com", "Admin", subject, body)
        
        return success_response(None, "Report sent! Thank you for helping us improve.", 201)
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()
