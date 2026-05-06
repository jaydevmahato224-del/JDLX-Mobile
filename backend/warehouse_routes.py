"""
Warehouse Routes
================
Handles the full warehouse partner lifecycle:
  - Google OAuth login flow  (/warehouse/login/google)
  - Google OAuth request flow (/warehouse/request/google)
  - Onboarding request  (POST  /api/warehouse/register)
  - Request status       (GET   /api/warehouse/request-status)
  - Session             (GET   /api/warehouse/session)
  - Dashboard data      (GET   /api/warehouse/dashboard)
  - Settings update     (PATCH /api/warehouse/settings)
  - Admin endpoints     (GET/PATCH /api/admin/warehouses/*)
"""

import os
import sys
import json
import uuid
import re
import random
import datetime
import logging
import sqlite3
import subprocess
import traceback
from functools import wraps
from threading import Thread
from urllib.parse import quote

# Third-party imports
import jwt
import pdfplumber
from flask import Blueprint, jsonify, request, redirect, session, url_for, current_app, abort
from werkzeug.utils import secure_filename
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

# Local imports
from utils.response_utils import success_response, error_response
from notifier import (
    send_warehouse_application_email, 
    send_warehouse_registration_confirmation_email,
    send_individual_email,
    send_warehouse_action_email,
    send_warehouse_kyc_pending_email,
    send_product_restock_alert
)
from services.inventory_service import trigger_low_stock_notifications
from notifications.notification_service import notification_service

# Ensure local user packages are available for OCR
USER_SITE = os.path.expanduser("~/.local/lib/python3.12/site-packages")
if USER_SITE not in sys.path:
    sys.path.append(USER_SITE)

# Configuration and Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_PATH = os.path.join(BASE_DIR, "jdlx.db")
WAREHOUSE_REQUEST_UPLOAD_DIR = os.path.join("static", "uploads", "warehouse_requests")
PRODUCT_IMAGES_UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads", "product_images")
ALLOWED_UPLOAD_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}

warehouse_bp = Blueprint("warehouse", __name__)



# ── DB helper ────────────────────────────────────────────────────────────────

def get_db():
    """Returns a sqlite3 connection with Row factory."""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def generate_unique_partner_id(cursor):
    """Generates a unique 6-digit partner ID."""
    while True:
        partner_id = str(random.randint(100000, 999999))
        # Check uniqueness in both tables
        exists = cursor.execute("SELECT id FROM warehouses WHERE partner_id = ?", (partner_id,)).fetchone()
        if exists:
            continue
        exists = cursor.execute("SELECT id FROM warehouse_applications WHERE partner_id = ?", (partner_id,)).fetchone()
        if exists:
            continue
        return partner_id


def generate_unique_store_code(cursor):
    """Generates a unique 4-digit store code with DS- prefix."""
    while True:
        code = f"DS-{random.randint(1000, 9999)}"
        # Check uniqueness in dark_stores
        exists = cursor.execute("SELECT id FROM dark_stores WHERE store_code = ?", (code,)).fetchone()
        if exists:
            continue
        return code


def _allowed_upload(filename):
    """Checks if a filename has an allowed extension."""
    if not filename:
        return False
    ext = os.path.splitext(filename)[1].lower()
    return ext in ALLOWED_UPLOAD_EXTENSIONS


def _save_uploaded_asset(file_storage, prefix):
    """Saves an uploaded file and returns its relative URL."""
    if not file_storage or not getattr(file_storage, "filename", ""):
        return None
    
    filename = secure_filename(file_storage.filename)
    if not _allowed_upload(filename):
        raise ValueError("Only JPG, JPEG, PNG, WEBP, or PDF files are allowed.")
    
    os.makedirs(WAREHOUSE_REQUEST_UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(filename)[1].lower()
    stamp = datetime.datetime.utcnow().strftime("%Y%m%d%H%M%S")
    final_name = f"{prefix}_{stamp}_{uuid.uuid4().hex[:10]}{ext}"
    target_path = os.path.join(WAREHOUSE_REQUEST_UPLOAD_DIR, final_name)
    file_storage.save(target_path)
    
    return f"/static/uploads/warehouse_requests/{final_name}"


def _ensure_warehouse_kyc_schema(conn):
    """Ensures necessary KYC columns and tables exist in the database."""
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS warehouse_notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            warehouse_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            type TEXT DEFAULT 'SYSTEM',
            is_read INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(warehouse_id) REFERENCES warehouses(id)
        )
        """
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_warehouse_notifications_warehouse ON warehouse_notifications(warehouse_id, created_at DESC)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_warehouse_notifications_read ON warehouse_notifications(warehouse_id, is_read)"
    )

    cursor.execute("PRAGMA table_info(warehouses)")
    warehouse_columns = [row[1] for row in cursor.fetchall()]
    
    if "profile_kyc_status" not in warehouse_columns:
        cursor.execute("ALTER TABLE warehouses ADD COLUMN profile_kyc_status TEXT DEFAULT 'verified'")
    if "kyc_notice_sent" not in warehouse_columns:
        cursor.execute("ALTER TABLE warehouses ADD COLUMN kyc_notice_sent INTEGER DEFAULT 0")
    if "kyc_notice_sent_at" not in warehouse_columns:
        cursor.execute("ALTER TABLE warehouses ADD COLUMN kyc_notice_sent_at TIMESTAMP")
    
    conn.commit()



def _is_missing_warehouse_kyc_payload(app_row):
    """
    Checks if an application row is missing mandatory KYC fields.
    Returns True if fields are missing, False otherwise.
    """
    if not app_row:
        return True

    required_text_fields = [
        app_row["document_upload"],
        app_row["owner_image"],
        app_row["kyc_details"],
        app_row["request_mail_message"],
    ]
    
    for value in required_text_fields:
        if not value or not str(value).strip():
            return True

    try:
        photos = json.loads(app_row["warehouse_photos"] or "[]")
    except (ValueError, TypeError, json.JSONDecodeError):
        photos = []
        
    if not isinstance(photos, list):
        return True
        
    clean_photos = [photo for photo in photos if photo and str(photo).strip()]
    return len(clean_photos) == 0


def _sync_legacy_warehouse_kyc_rollout(conn):
    """
    Syncs legacy warehouse records with the new KYC requirements.
    Sends notifications and emails to warehouses with pending KYC.
    """
    _ensure_warehouse_kyc_schema(conn)
    
    warehouses = conn.execute(
        """
        SELECT id, email, owner_name, warehouse_name,
               COALESCE(profile_kyc_status, 'verified') AS profile_kyc_status,
               COALESCE(kyc_notice_sent, 0) AS kyc_notice_sent
        FROM warehouses
        """
    ).fetchall()

    pending_mail_jobs = []
    for warehouse in warehouses:
        app_row = conn.execute(
            """
            SELECT document_upload, warehouse_photos, owner_image, kyc_details, request_mail_message
            FROM warehouse_applications
            WHERE email = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (warehouse["email"],),
        ).fetchone()

        is_pending = _is_missing_warehouse_kyc_payload(app_row)
        next_status = "pending" if is_pending else "verified"

        if warehouse["profile_kyc_status"] != next_status:
            conn.execute(
                "UPDATE warehouses SET profile_kyc_status = ? WHERE id = ?",
                (next_status, warehouse["id"]),
            )

        if is_pending and int(warehouse["kyc_notice_sent"] or 0) == 0:
            title = "Profile Pending: KYC Update Required"
            message = (
                "New warehouse KYC fields are now mandatory. Upload owner image, store image(s), "
                "KYC details, and your request message to complete profile verification."
            )
            conn.execute(
                """
                INSERT INTO warehouse_notifications (warehouse_id, title, message, type)
                VALUES (?, ?, ?, ?)
                """,
                (warehouse["id"], title, message, "KYC_UPDATE"),
            )
            conn.execute(
                """
                UPDATE warehouses
                SET kyc_notice_sent = 1,
                    kyc_notice_sent_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (warehouse["id"],),
            )
            pending_mail_jobs.append(
                (warehouse["email"], warehouse["owner_name"], warehouse["warehouse_name"])
            )

    conn.commit()

    for mail_job in pending_mail_jobs:
        Thread(target=send_warehouse_kyc_pending_email, args=mail_job, daemon=True).start()


# ── JWT helpers ──────────────────────────────────────────────────────────────

def _get_jwt_secret():
    """Returns the JWT secret from environment or default."""
    return os.environ.get("JWT_SECRET", "jdlx_secret_keys_123")


def issue_warehouse_token(warehouse_id, email, role="owner"):
    """Generates a 7-day JWT token for a warehouse user."""
    payload = {
        "warehouse_id": warehouse_id,
        "email": email,
        "role": role,
        "type": "warehouse",
        "exp": datetime.datetime.utcnow() + datetime.timedelta(days=7),
    }
    return jwt.encode(payload, _get_jwt_secret(), algorithm="HS256")


def decode_warehouse_token(token):
    """Decodes a warehouse JWT token."""
    return jwt.decode(token, _get_jwt_secret(), algorithms=["HS256"])



@warehouse_bp.route("/api/warehouse/upload", methods=["POST"])
def warehouse_upload_product_image():
    """Endpoint for warehouse partners to upload product images."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return error_response("Missing warehouse token", 401)
    
    token = auth.split(" ", 1)[1]
    try:
        decode_warehouse_token(token)
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return error_response("Invalid or expired token", 401)
    except Exception as e:
        return error_response(f"Auth error: {str(e)}", 401)

    if 'file' not in request.files:
        return error_response("No file part", 400)
    
    file = request.files['file']
    if file.filename == '':
        return error_response("No selected file", 400)
    
    try:
        filename = secure_filename(file.filename)
        ext = os.path.splitext(filename)[1].lower()
        if ext not in ALLOWED_UPLOAD_EXTENSIONS:
             return error_response("File type not allowed. Use JPG, PNG, WEBP or PDF.", 400)
             
        stamp = datetime.datetime.utcnow().strftime("%Y%m%d%H%M%S")
        final_name = f"product_{stamp}_{uuid.uuid4().hex[:10]}{ext}"
        
        os.makedirs(PRODUCT_IMAGES_UPLOAD_DIR, exist_ok=True)
        target_path = os.path.join(PRODUCT_IMAGES_UPLOAD_DIR, final_name)
        file.save(target_path)
        
        file_url = f"/static/uploads/product_images/{final_name}"
        return success_response({"url": file_url}, "Image uploaded successfully", 201)
    except Exception as e:
        current_app.logger.error(f"Product image upload failed: {str(e)}")
        return error_response(str(e), 500)


def require_warehouse_auth(f):
    """Decorator to require a valid warehouse JWT token."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return error_response("Missing warehouse token", 401)
        
        token = auth.split(" ", 1)[1]
        try:
            payload = decode_warehouse_token(token)
            if payload.get("type") != "warehouse":
                return error_response("Invalid token type", 401)
        except jwt.ExpiredSignatureError:
            return error_response("Warehouse session expired", 401)
        except jwt.InvalidTokenError:
            return error_response("Invalid warehouse token", 401)
        except Exception:
            return error_response("Authentication failed", 401)
            
        request.warehouse_payload = payload
        return f(*args, **kwargs)
    return decorated


def _check_warehouse_restriction(email):
    """Helper to check if a warehouse is suspended or banned."""
    conn = get_db()
    try:
        wh = conn.execute("SELECT account_status FROM warehouses WHERE email = ?", (email,)).fetchone()
        if not wh:
            # Check application status as fallback
            app = conn.execute(
                """
                SELECT verification_status 
                FROM warehouse_applications 
                WHERE email = ? 
                ORDER BY id DESC 
                LIMIT 1
                """, 
                (email,)
            ).fetchone()
            
            if app and app["verification_status"] in ("suspended", "banned"):
                return app["verification_status"]
            return None
        
        status = wh["account_status"]
        return status if status in ("suspended", "banned") else None
    finally:
        conn.close()



# ── Google OAuth flows ───────────────────────────────────────────────────────
# The frontend redirects the browser to these non-API endpoints.
# We use the already-registered `google` oauth client from app.py.

# ── Google OAuth flows ───────────────────────────────────────────────────────
# The frontend redirects the browser to these non-API endpoints.
# We use the already-registered `google` oauth client from app.py.

@warehouse_bp.route("/warehouse/login/google")
def warehouse_login_google():
    """Initiate Google OAuth for warehouse login."""
    oauth = current_app.config["OAUTH_CLIENT"]
    redirect_uri = url_for("warehouse.warehouse_login_google_callback", _external=True)
    return oauth.google.authorize_redirect(redirect_uri)


@warehouse_bp.route("/warehouse/login/google/callback")
def warehouse_login_google_callback():
    """Handle Google callback for warehouse login."""
    oauth = current_app.config["OAUTH_CLIENT"]
    warehouse_frontend = os.environ.get("WAREHOUSE_FRONTEND_URL", "http://localhost:5175").rstrip("/")
    
    try:
        token_data = oauth.google.authorize_access_token()
        user_info = token_data.get("userinfo") or oauth.google.userinfo()
        email = user_info.get("email", "").lower().strip()
    except Exception as e:
        logging.error(f"Warehouse OAuth callback failed: {str(e)}", exc_info=True)
        return redirect(f"{warehouse_frontend}/warehouse/login?error=oauth_failed")

    conn = get_db()
    try:
        try:
            _sync_legacy_warehouse_kyc_rollout(conn)
        except Exception as rollout_error:
            current_app.logger.warning(f"Warehouse KYC rollout sync warning: {rollout_error}")

        wh = conn.execute(
            """SELECT w.*, ds.id AS store_id, ds.store_code
               FROM warehouses w
               LEFT JOIN dark_stores ds ON w.warehouse_name = ds.name
               WHERE w.email = ?""", (email,)
        ).fetchone()
        
        if not wh:
            return redirect(f"{warehouse_frontend}/warehouse/login?error=not_authorized")

        jwt_token = issue_warehouse_token(wh["id"], email, wh["warehouse_role"])
        user_obj = {
            "id": wh["id"],
            "store_id": wh["store_id"],
            "warehouse_name": wh["warehouse_name"],
            "owner_name": wh["owner_name"],
            "email": wh["email"],
            "warehouse_role": wh["warehouse_role"],
            "address": wh["address"],
            "pincode": wh["pincode"],
            "warehouse_capacity": wh["warehouse_capacity"],
            "operations_status": wh["operations_status"],
            "weather_status": wh["weather_status"],
            "service_radius_km": wh["service_radius_km"],
            "quick_mode_enabled": wh["quick_mode_enabled"],
            "profile_kyc_status": wh["profile_kyc_status"],
        }
        
        encoded_user = quote(json.dumps(user_obj))
        return redirect(
            f"{warehouse_frontend}/warehouse/login?oauth_token={jwt_token}&oauth_user={encoded_user}"
        )
    finally:
        conn.close()


@warehouse_bp.route("/warehouse/request/google")
def warehouse_request_google():
    """Consolidated Google OAuth for warehouse onboarding request."""
    flow = request.args.get('flow', 'warehouse_request')
    return redirect(url_for("login_google", flow=flow))


@warehouse_bp.route("/warehouse/request/google/callback")
def warehouse_request_google_callback():
    """Handle Google callback for warehouse request (identity verification only)."""
    oauth = current_app.config["OAUTH_CLIENT"]
    warehouse_frontend = os.environ.get("WAREHOUSE_FRONTEND_URL", "http://localhost:5175").rstrip("/")
    
    try:
        token_data = oauth.google.authorize_access_token()
        user_info = token_data.get("userinfo") or oauth.google.userinfo()
        email = user_info.get("email", "").lower().strip()
        name = user_info.get("name", "")
    except Exception:
        return redirect(f"{warehouse_frontend}/warehouse/request?error=oauth_failed")

    # Issue a short-lived request token
    payload = {
        "email": email,
        "name": name,
        "type": "warehouse_request",
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=2),
    }
    request_token = jwt.encode(payload, _get_jwt_secret(), algorithm="HS256")

    user_obj = {"email": email, "name": name}
    encoded_user = quote(json.dumps(user_obj))
    
    flow = session.pop('oauth_flow', 'warehouse_request')
    if flow == 'delivery_request':
        return redirect(
            f"{warehouse_frontend}/warehouse/request-delivery?oauth_token={request_token}&oauth_user={encoded_user}"
        )
        
    return redirect(
        f"{warehouse_frontend}/warehouse/request?oauth_token={request_token}&oauth_user={encoded_user}"
    )


# ── Warehouse Google Token Auth (GIS / credential token flow) ────────────────
# Uses the same approach as /api/auth/google — no server redirect needed.

@warehouse_bp.route("/api/warehouse/auth/google", methods=["POST"])
def warehouse_auth_google():
    """Verify a Google ID token (from @react-oauth/google) and return a warehouse JWT."""
    data = request.get_json(silent=True) or {}
    credential = data.get("credential") or data.get("token")
    if not credential:
        return error_response("Missing Google credential", 400)

    google_client_id = os.environ.get(
        "GOOGLE_CLIENT_ID",
        "473832938691-0et3o47opidpim0k0ufau8tq1qtn4sc9.apps.googleusercontent.com",
    )
    
    try:
        # Verify Google token with 30s clock skew tolerance
        idinfo = google_id_token.verify_oauth2_token(
            credential, 
            google_requests.Request(), 
            google_client_id, 
            clock_skew_in_seconds=30
        )
        email = idinfo.get("email", "").lower().strip()
        name = idinfo.get("name", "")
        if not email:
            return error_response("Could not extract email from Google token", 400)
    except ValueError as exc:
        return error_response(f"Invalid Google token: {str(exc)}", 401)

    conn = get_db()
    try:
        try:
            _sync_legacy_warehouse_kyc_rollout(conn)
        except Exception as rollout_error:
            current_app.logger.warning(f"Warehouse KYC rollout sync warning: {rollout_error}")

        # Restriction Check
        restriction = _check_warehouse_restriction(email)
        if restriction:
            return error_response(f"Your account has been {restriction}.", 403, data={"restriction": restriction})

        wh = conn.execute(
            """SELECT w.*, ds.id AS store_id, ds.store_code
               FROM warehouses w
               LEFT JOIN dark_stores ds ON w.warehouse_name = ds.name
               WHERE w.email = ?""", (email,)
        ).fetchone()
        
        if not wh:
            return error_response("Not authorized", 403, data={"email": email, "name": name})

        jwt_token = issue_warehouse_token(wh["id"], email, wh["warehouse_role"])
        return jsonify({
            "token": jwt_token,
            "user": {
                "id": wh["id"],
                "store_id": wh["store_id"],
                "warehouse_name": wh["warehouse_name"],
                "owner_name": wh["owner_name"],
                "email": wh["email"],
                "warehouse_role": wh["warehouse_role"],
                "address": wh["address"],
                "pincode": wh["pincode"],
                "warehouse_capacity": wh["warehouse_capacity"],
                "operations_status": wh["operations_status"],
                "weather_status": wh["weather_status"],
                "service_radius_km": wh["service_radius_km"],
                "quick_mode_enabled": wh["quick_mode_enabled"],
                "profile_kyc_status": wh["profile_kyc_status"],
            },
        }), 200
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/auth/google/request", methods=["POST"])
def warehouse_auth_google_request():
    """Verify a Google ID token for warehouse onboarding (identity only, returns request token)."""
    data = request.get_json(silent=True) or {}
    credential = data.get("credential") or data.get("token")
    if not credential:
        return error_response("Missing Google credential", 400)

    google_client_id = os.environ.get(
        "GOOGLE_CLIENT_ID",
        "473832938691-0et3o47opidpim0k0ufau8tq1qtn4sc9.apps.googleusercontent.com",
    )
    
    try:
        # Verify Google token with 30s clock skew tolerance
        idinfo = google_id_token.verify_oauth2_token(
            credential, 
            google_requests.Request(), 
            google_client_id, 
            clock_skew_in_seconds=30
        )
        email = idinfo.get("email", "").lower().strip()
        name = idinfo.get("name", "")
    except ValueError as exc:
        return error_response(f"Invalid Google token: {str(exc)}", 401)

    payload = {
        "email": email,
        "name": name,
        "type": "warehouse_request",
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=2),
    }
    req_token = jwt.encode(payload, _get_jwt_secret(), algorithm="HS256")
    return jsonify({"token": req_token, "email": email, "name": name}), 200


# ── Partner Server-Side OAuth Flow ──────────────────────────────────────────
# Uses the exact client_id and client_secret provided for the partner portal.
# This avoids needing JS Origins configured in Google Cloud Console.

@warehouse_bp.route("/partner/login/google")
def partner_login_google():
    """Initiate server-side Google OAuth for partners."""
    flow = request.args.get("flow", "warehouse_login")
    redirect_uri = os.environ.get("PARTNER_GOOGLE_REDIRECT_URI") or url_for("warehouse.partner_auth_google_callback", _external=True)
    oauth = current_app.config["OAUTH_CLIENT"]

    # Keep the requested business flow in the Flask session and let Authlib
    # manage its own CSRF state token for the OAuth round-trip.
    session["partner_oauth_flow"] = flow
    print(f"DEBUG: Initiating partner OAuth with session flow: {flow}")
    return oauth.google.authorize_redirect(redirect_uri)


@warehouse_bp.route("/partner/auth/google/callback")
def partner_auth_google_callback():
    """Handle server-side Google callback for partners."""
    oauth = current_app.config["OAUTH_CLIENT"]
    
    # Redirection Origins
    admin_frontend = os.environ.get("ADMIN_FRONTEND_URL", "http://localhost:5174").rstrip("/")
    warehouse_frontend = os.environ.get("WAREHOUSE_FRONTEND_URL", "http://localhost:5175").rstrip("/")
    
    try:
        # Use Authlib for robust token exchange
        token_data = oauth.google.authorize_access_token()
        user_info = token_data.get("userinfo") or oauth.google.userinfo()
        email = user_info.get("email", "").lower().strip()
        name = user_info.get("name", "").strip()
        print(f"DEBUG Success: Authlib verified email: {email}")
        
        flow = session.pop("partner_oauth_flow", None) or request.args.get("flow") or "warehouse_login"
        print(f"DEBUG: flow identified as {flow}")
    except Exception as e:
        traceback.print_exc()
        err_details = quote(str(e)[:100])
        print(f"DEBUG Error: Authlib verification failed: {str(e)}")
        # If generic OAuth failed, return to warehouse login by default
        return redirect(f"{warehouse_frontend}/warehouse/login?error=oauth_failed&details={err_details}")

    # Branching based on requested flow
    if flow == "admin":
        print(f"TRACE: flow == admin for email {email}")
        conn = get_db()
        try:
            user = conn.execute("""
                SELECT u.id, u.email, u.role
                FROM users u
                WHERE LOWER(u.email) = ?
            """, (email.lower(),)).fetchone()
            
            initial_email = os.environ.get("INITIAL_SUPER_ADMIN_EMAIL", "").strip().lower()
            is_initial_super = (initial_email and email.lower() == initial_email)
            
            if not user and not is_initial_super:
                return redirect(f"{admin_frontend}/admin/login?error=not_authorized")
                
            role = user['role'] if user else ('super_admin' if is_initial_super else 'user')
            
            if role not in ('admin', 'super_admin'):
                return redirect(f"{admin_frontend}/admin/login?error=not_authorized")
            
            is_super = (role == 'super_admin')
            user_id = user['id'] if user else -1
            
            payload = {
                'user_id': user_id,
                'email': email,
                'is_super_admin': is_super,
                'role': role,
                'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
            }
            secret = current_app.config.get('JWT_SECRET') or _get_jwt_secret()
            jwt_token = jwt.encode(payload, secret, algorithm='HS256')
            
            user_obj = {
                "id": user_id,
                "email": email,
                "role": role,
                "is_super_admin": is_super
            }
            encoded_user = quote(json.dumps(user_obj))
            
            # Redirect to the Admin Frontend on port 5174
            final_redirect = f"{admin_frontend}/admin/dashboard?oauth_token={jwt_token}&oauth_user={encoded_user}"
            return redirect(final_redirect)
        finally:
            conn.close()

    elif flow == "warehouse_login":
        conn = get_db()
        try:
            try:
                _sync_legacy_warehouse_kyc_rollout(conn)
            except Exception as rollout_error:
                current_app.logger.warning(f"Warehouse KYC rollout sync warning: {rollout_error}")

            wh = conn.execute(
                """SELECT w.*, ds.id AS store_id, ds.store_code
                   FROM warehouses w
                   LEFT JOIN dark_stores ds ON w.warehouse_name = ds.name
                   WHERE w.email = ?""", (email,)
            ).fetchone()
            
            if not wh:
                return redirect(f"{warehouse_frontend}/warehouse/login?error=not_authorized")

            jwt_token = issue_warehouse_token(wh["id"], email, wh["warehouse_role"])
            user_obj = {
                "id": wh["id"],
                "store_id": wh["store_id"],
                "partner_id": wh["partner_id"],
                "warehouse_name": wh["warehouse_name"],
                "owner_name": wh["owner_name"],
                "email": wh["email"],
                "warehouse_role": wh["warehouse_role"],
                "role": wh["warehouse_role"], # Added for frontend compatibility
                "address": wh["address"],
                "pincode": wh["pincode"],
                "warehouse_capacity": wh["warehouse_capacity"],
                "operations_status": wh["operations_status"],
                "weather_status": wh["weather_status"],
                "service_radius_km": wh["service_radius_km"],
                "quick_mode_enabled": wh["quick_mode_enabled"],
                "profile_kyc_status": wh["profile_kyc_status"],
            }
            encoded_user = quote(json.dumps(user_obj))
            return redirect(f"{warehouse_frontend}/warehouse/login?oauth_token={jwt_token}&oauth_user={encoded_user}")
        finally:
            conn.close()

    elif flow == "warehouse_request":
        payload = {
            "email": email,
            "name": name,
            "type": "warehouse_request",
            "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=2),
        }
        request_token = jwt.encode(payload, _get_jwt_secret(), algorithm="HS256")
        user_obj = {"email": email, "name": name}
        encoded_user = quote(json.dumps(user_obj))
        return redirect(f"{warehouse_frontend}/warehouse/request?oauth_token={request_token}&oauth_user={encoded_user}")

    elif flow == "delivery_login":
        return redirect(f"{warehouse_frontend}/warehouse/login?error=delivery_under_construction")

    return redirect(f"{warehouse_frontend}/warehouse/login?error=unknown_flow")


# ── Store Availability (Public) ──────────────────────────────────────────────

@warehouse_bp.route("/api/warehouse/availability", methods=["GET"])
def warehouse_availability():
    """
    Public endpoint — returns whether the store is currently open and accepting orders.
    The frontend store (port 5173) polls this to show OPEN / CLOSED status in the hero banner.
    Logic: reads `operations_status` from the first active warehouse record.
    """
    conn = get_db()
    try:
        # Prefer a warehouse whose linked dark_store is also active
        wh = conn.execute(
            """
            SELECT w.operations_status, w.weather_status, w.service_radius_km, w.quick_mode_enabled,
                   ds.active AS store_active, ds.pincode
            FROM warehouses w
            LEFT JOIN dark_stores ds ON w.warehouse_name = ds.name
            WHERE w.account_status = 'active'
            ORDER BY w.id ASC
            LIMIT 1
            """
        ).fetchone()

        if not wh:
            return jsonify({
                "ordering_enabled": False,
                "can_order": False,
                "message": "No active store found in your area.",
                "weather_status": "clear",
            }), 200

        ops_status = (wh["operations_status"] or "closed").lower().strip()
        is_open = ops_status == "open"
        weather = (wh["weather_status"] or "clear").lower().strip()
        quick_mode = bool(wh["quick_mode_enabled"])
        radius = wh["service_radius_km"] or 4.0

        # Build human-readable message
        if not is_open:
            msg = "Store is currently closed. Please check back later."
        elif weather == "bad_weather":
            msg = "Deliveries may be delayed due to bad weather."
        elif quick_mode:
            msg = "⚡ Hyperlocal Quick Delivery Active (10-15 mins)"
        else:
            msg = "Delivering in 20-30 mins"

        # Count active products (global for now, or per-warehouse if needed)
        product_count = conn.execute("SELECT COUNT(*) FROM products WHERE stock > 0").fetchone()[0]

        data = {
            "ordering_enabled": is_open,
            "can_order": is_open,
            "operations_status": ops_status,
            "weather_status": weather,
            "quick_mode_enabled": quick_mode,
            "quick_delivery_max_distance": radius,
            "service_radius_km": radius,
            "active_products": product_count,
            "message": msg,
            "success": True # Add success: true to satisfy both raw and wrapped expectations
        }
        # Return directly for frontend compatibility
        return jsonify(data)
    finally:
        conn.close()



# ── Warehouse Onboarding ─────────────────────────────────────────────────────

@warehouse_bp.route("/api/warehouse/register", methods=["POST"])
def warehouse_register():
    """Submit a warehouse onboarding request."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = request.form.to_dict() if request.form else {}
        
    required = ["warehouse_name", "owner_name", "email", "address"]
    missing = [f for f in required if not data.get(f)]
    if missing:
        return error_response(f"Missing required fields: {', '.join(missing)}", 400)

    try:
        owner_image = _save_uploaded_asset(request.files.get("owner_image"), "owner")
        kyc_document = _save_uploaded_asset(request.files.get("kyc_document"), "kyc")
        warehouse_images = []
        for image_file in request.files.getlist("warehouse_images"):
            saved_image = _save_uploaded_asset(image_file, "store")
            if saved_image:
                warehouse_images.append(saved_image)
    except ValueError as upload_error:
        return error_response(str(upload_error), 400)

    kyc_details = (data.get("kyc_details") or "").strip()
    request_mail_message = (data.get("request_mail_message") or "").strip()
    warehouse_photos_json = json.dumps(warehouse_images) if warehouse_images else None

    email = data["email"].lower().strip()
    conn = get_db()
    try:
        # Check if already approved
        wh = conn.execute("SELECT id FROM warehouses WHERE email = ?", (email,)).fetchone()
        if wh:
            return error_response("This email is already an approved warehouse partner.", 409)

        # Check for existing non-rejected application
        existing = conn.execute(
            """
            SELECT id, verification_status 
            FROM warehouse_applications 
            WHERE email = ? 
            ORDER BY id DESC 
            LIMIT 1
            """,
            (email,),
        ).fetchone()
        
        if existing and existing["verification_status"] == "pending":
            return error_response("A pending application for this email already exists.", 409)

        new_partner_id = generate_unique_partner_id(conn)
        conn.execute(
            """INSERT INTO warehouse_applications
               (warehouse_name, owner_name, email, phone, address, pincode,
                warehouse_capacity, warehouse_type, verification_status, partner_id,
                document_upload, warehouse_photos, owner_image, kyc_details, request_mail_message)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)""",
            (
                data.get("warehouse_name"),
                data.get("owner_name"),
                email,
                data.get("phone"),
                data.get("address"),
                data.get("pincode"),
                data.get("warehouse_capacity"),
                data.get("warehouse_type", "micro_fulfillment"),
                new_partner_id,
                kyc_document,
                warehouse_photos_json,
                owner_image,
                kyc_details,
                request_mail_message,
            ),
        )
        conn.commit()

        # Send registration confirmation email asynchronously
        Thread(
            target=send_warehouse_registration_confirmation_email,
            args=(email, data.get("owner_name"), data.get("warehouse_name")),
            daemon=True
        ).start()

        return success_response({"partner_id": new_partner_id}, "Warehouse request submitted. Awaiting admin approval.", 201)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/request-status")
def warehouse_request_status():
    """Check the status of a warehouse application by email."""
    email = request.args.get("email", "").lower().strip()
    if not email:
        return error_response("email query parameter is required", 400)

    conn = get_db()
    try:
        app_row = conn.execute(
            "SELECT * FROM warehouse_applications WHERE email = ? ORDER BY id DESC LIMIT 1",
            (email,),
        ).fetchone()
        
        if not app_row:
            return jsonify({"verification_status": None, "application": None}), 200

        try:
            warehouse_photos = json.loads(app_row["warehouse_photos"] or "[]")
        except (ValueError, TypeError, json.JSONDecodeError):
            warehouse_photos = []

        data = {
            "verification_status": app_row["verification_status"],
            "application": {
                "id": app_row["id"],
                "warehouse_name": app_row["warehouse_name"],
                "owner_name": app_row["owner_name"],
                "email": app_row["email"],
                "phone": app_row["phone"],
                "address": app_row["address"],
                "pincode": app_row["pincode"],
                "warehouse_capacity": app_row["warehouse_capacity"],
                "warehouse_type": app_row["warehouse_type"],
                "verification_status": app_row["verification_status"],
                "admin_notes": app_row["admin_notes"],
                "document_upload": app_row["document_upload"],
                "warehouse_photos": warehouse_photos,
                "owner_image": app_row["owner_image"],
                "kyc_details": app_row["kyc_details"],
                "request_mail_message": app_row["request_mail_message"],
            }
        }
        return success_response(data, "Request status retrieved")
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()


# ── Warehouse Auth-Protected Routes ─────────────────────────────────────────

@warehouse_bp.route("/api/warehouse/session")
@require_warehouse_auth
def warehouse_session():
    """Return current warehouse user/profile from DB."""
    wh_id = request.warehouse_payload["warehouse_id"]
    conn = get_db()
    try:
        try:
            _sync_legacy_warehouse_kyc_rollout(conn)
        except Exception as rollout_error:
            current_app.logger.warning(f"Warehouse KYC rollout sync warning: {rollout_error}")

        wh = conn.execute(
            """SELECT w.*, ds.store_code, ds.id AS store_id 
               FROM warehouses w 
               LEFT JOIN dark_stores ds ON w.warehouse_name = ds.name 
               WHERE w.id = ?""", 
            (wh_id,)
        ).fetchone()
        
        if not wh:
            return error_response("Warehouse not found", 404)
        
        if wh["account_status"] in ("suspended", "banned"):
            return error_response(f"This account is {wh['account_status']}.", 403, data={"status": wh['account_status']})
            
        user_data = {
            "id": wh["id"],
            "partner_id": wh["partner_id"],
            "store_id": wh["store_id"],
            "store_code": wh["store_code"],
            "warehouse_name": wh["warehouse_name"],
            "owner_name": wh["owner_name"],
            "email": wh["email"],
            "warehouse_role": wh["warehouse_role"],
            "role": wh["warehouse_role"], # Added for frontend compatibility
            "address": wh["address"],
            "pincode": wh["pincode"],
            "warehouse_capacity": wh["warehouse_capacity"],
            "operations_status": wh["operations_status"],
            "weather_status": wh["weather_status"],
            "service_radius_km": wh["service_radius_km"],
            "quick_mode_enabled": wh["quick_mode_enabled"],
            "profile_kyc_status": wh["profile_kyc_status"],
        }
        
        return jsonify({
            "user": user_data,
            "warehouse": user_data,
        }), 200
    finally:
        conn.close()



@warehouse_bp.route("/api/warehouse/notifications", methods=["GET"])
@require_warehouse_auth
def warehouse_notifications():
    """Return in-app notifications for warehouse partners."""
    wh_id = request.warehouse_payload["warehouse_id"]
    limit_raw = request.args.get("limit", "50")
    
    try:
        limit = max(1, min(int(limit_raw), 100))
    except (ValueError, TypeError):
        limit = 50

    conn = get_db()
    try:
        try:
            _sync_legacy_warehouse_kyc_rollout(conn)
        except Exception as rollout_error:
            current_app.logger.warning(f"Warehouse KYC rollout sync warning: {rollout_error}")

        rows = conn.execute(
            """
            SELECT id, title, message, type, is_read, created_at
            FROM warehouse_notifications
            WHERE warehouse_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (wh_id, limit),
        ).fetchall()
        
        unread_count_row = conn.execute(
            "SELECT COUNT(*) AS count FROM warehouse_notifications WHERE warehouse_id = ? AND is_read = 0",
            (wh_id,),
        ).fetchone()
        
        unread_count = unread_count_row["count"] if unread_count_row else 0

        return jsonify({
            "notifications": [dict(row) for row in rows],
            "unread_count": unread_count,
        }), 200
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/notifications/<int:notification_id>/read", methods=["PATCH"])
@require_warehouse_auth
def warehouse_mark_notification_read(notification_id):
    """Mark a single warehouse notification as read."""
    wh_id = request.warehouse_payload["warehouse_id"]
    conn = get_db()
    try:
        _ensure_warehouse_kyc_schema(conn)
        conn.execute(
            """
            UPDATE warehouse_notifications
            SET is_read = 1
            WHERE id = ? AND warehouse_id = ?
            """,
            (notification_id, wh_id),
        )
        conn.commit()
        return success_response(None, "Notification marked as read", 200)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/notifications/read-all", methods=["POST"])
@require_warehouse_auth
def warehouse_mark_all_notifications_read():
    """Mark all notifications as read for current warehouse."""
    wh_id = request.warehouse_payload["warehouse_id"]
    conn = get_db()
    try:
        _ensure_warehouse_kyc_schema(conn)
        conn.execute(
            "UPDATE warehouse_notifications SET is_read = 1 WHERE warehouse_id = ?",
            (wh_id,),
        )
        conn.commit()
        return success_response(None, "All notifications marked as read", 200)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/dashboard")
@require_warehouse_auth
def warehouse_dashboard():
    """Dashboard stats: order cards, performance metrics, recent orders, inventory."""
    wh_id = request.warehouse_payload["warehouse_id"]
    conn = get_db()
    try:
        # Order stats
        total = conn.execute(
            "SELECT COUNT(*) as n FROM warehouse_order_assignments WHERE warehouse_id = ?", 
            (wh_id,)
        ).fetchone()["n"]
        
        pending = conn.execute(
            """
            SELECT COUNT(*) as n 
            FROM warehouse_order_assignments 
            WHERE warehouse_id = ? 
            AND assignment_status IN ('assigned','accepted','packing')
            """,
            (wh_id,),
        ).fetchone()["n"]
        
        packed = conn.execute(
            "SELECT COUNT(*) as n FROM warehouse_order_assignments WHERE warehouse_id = ? AND assignment_status = 'packed'",
            (wh_id,),
        ).fetchone()["n"]
        
        dispatched = conn.execute(
            "SELECT COUNT(*) as n FROM warehouse_order_assignments WHERE warehouse_id = ? AND assignment_status = 'dispatched'",
            (wh_id,),
        ).fetchone()["n"]
        
        rejected = conn.execute(
            "SELECT COUNT(*) as n FROM warehouse_order_assignments WHERE warehouse_id = ? AND assignment_status = 'rejected'",
            (wh_id,),
        ).fetchone()["n"]

        # Inventory stats
        low_stock = conn.execute(
            """SELECT COUNT(*) as n FROM warehouse_inventory 
               WHERE warehouse_id = ? 
               AND (stock_quantity - reserved_stock) <= low_stock_threshold""",
            (wh_id,),
        ).fetchone()["n"]
        
        total_inventory = conn.execute(
            "SELECT COUNT(*) as n FROM warehouse_inventory WHERE warehouse_id = ?", 
            (wh_id,)
        ).fetchone()["n"]

        # Performance
        accepted = conn.execute(
            "SELECT COUNT(*) as n FROM warehouse_order_assignments WHERE warehouse_id = ? AND assignment_status NOT IN ('assigned','rejected')",
            (wh_id,),
        ).fetchone()["n"]
        
        acceptance_rate = round((accepted / total * 100) if total > 0 else 0, 1)

        # Recent orders (last 10)
        recent_rows = conn.execute(
            """SELECT woa.id, woa.order_id, woa.assignment_status, woa.created_at,
                      o.total_amount, o.delivery_address, o.delivery_type,
                      GROUP_CONCAT(p.name, ', ') as product_names,
                      SUM(oi.quantity) as total_quantity
               FROM warehouse_order_assignments woa
               JOIN orders o ON o.id = woa.order_id
               LEFT JOIN order_items oi ON oi.order_id = o.id
               LEFT JOIN products p ON p.id = oi.product_id
               WHERE woa.warehouse_id = ?
               GROUP BY woa.id
               ORDER BY woa.created_at DESC
               LIMIT 10""",
            (wh_id,),
        ).fetchall()


        # Inventory summary (lowest stock first)
        inv_rows = conn.execute(
            """SELECT wi.id, COALESCE(p.name, wi.product_name) as product_name, 
                      COALESCE(wi.sku, CAST(p.id AS TEXT)) as sku, wi.stock_quantity, 
                      wi.reserved_stock, (wi.stock_quantity - wi.reserved_stock) as available_stock, 
                      wi.low_stock_threshold, wi.bin_location
               FROM warehouse_inventory wi
               LEFT JOIN products p ON p.id = wi.product_id
               WHERE wi.warehouse_id = ?
               ORDER BY (wi.stock_quantity - wi.reserved_stock) ASC
               LIMIT 20""",
            (wh_id,),
        ).fetchall()

        # Current warehouse settings
        wh_settings = conn.execute(
            "SELECT operations_status, weather_status, quick_mode_enabled FROM warehouses WHERE id = ?", 
            (wh_id,)
        ).fetchone()

        data = {
            "cards": {
                "total_orders_assigned": total,
                "pending_orders": pending,
                "packed_orders": packed,
                "dispatched_orders": dispatched,
                "rejected_orders": rejected,
                "low_stock_alerts": low_stock,
                "total_inventory": total_inventory,
            },
            "performance_metrics": {
                "acceptance_rate": acceptance_rate,
                "accepted_orders": accepted,
                "completed_dispatches": dispatched,
            },
            "recent_orders": [
                {
                    "id": r["id"],
                    "order_id": r["order_id"],
                    "assignment_status": r["assignment_status"],
                    "created_at": r["created_at"],
                    "total_amount": r["total_amount"],
                    "delivery_address": r["delivery_address"],
                    "product_names": r["product_names"] or "Unknown products",
                    "total_quantity": r["total_quantity"] or 0,
                }
                for r in recent_rows
            ],
            "inventory_summary": [dict(r) for r in inv_rows],
            "settings": dict(wh_settings) if wh_settings else {}
        }
        return success_response(data, "Dashboard data retrieved successfully")
    except Exception as e:
        current_app.logger.error(f"ERROR in warehouse_dashboard: {str(e)}", exc_info=True)
        return error_response(str(e), 500)
    finally:
        conn.close()

@warehouse_bp.route("/api/warehouse/restock", methods=["GET"])
@require_warehouse_auth
def get_warehouse_restock_requests():
    """List all restock requests for this warehouse/store."""
    wh_id = request.warehouse_payload["warehouse_id"]
    
    conn = get_db()
    try:
        wh = conn.execute("SELECT warehouse_name FROM warehouses WHERE id = ?", (wh_id,)).fetchone()
        store_id = None
        if wh:
            ds = conn.execute("SELECT id FROM dark_stores WHERE name = ?", (wh["warehouse_name"],)).fetchone()
            if ds:
                store_id = ds["id"]

        query = """
            SELECT rr.*, p.name as product_name, p.images as product_image
            FROM restock_requests rr
            JOIN products p ON rr.product_id = p.id
            WHERE rr.store_id = ?
            ORDER BY rr.created_at DESC
        """
        rows = conn.execute(query, (store_id,)).fetchall()
        return success_response([dict(r) for r in rows], "Restock requests retrieved")
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/restock", methods=["POST"])
@require_warehouse_auth
def create_warehouse_restock_request():
    """Submit a new restock request for a product."""
    wh_id = request.warehouse_payload["warehouse_id"]
    data = request.json
    product_id = data.get("product_id")
    quantity = data.get("requested_quantity")
    purchase_price = data.get("purchase_price", 0)
    selling_price = data.get("selling_price", 0)
    
    if not product_id or not quantity:
        return error_response("Product ID and quantity are required", 400)
        
    conn = get_db()
    try:
        wh = conn.execute("SELECT warehouse_name FROM warehouses WHERE id = ?", (wh_id,)).fetchone()
        store_id = None
        if wh:
            ds = conn.execute("SELECT id FROM dark_stores WHERE name = ?", (wh["warehouse_name"],)).fetchone()
            if ds:
                store_id = ds["id"]
        
        p = conn.execute("SELECT supplier_id FROM products WHERE id = ?", (product_id,)).fetchone()
        supplier_id = p["supplier_id"] if p else None

        conn.execute(
            """
            INSERT INTO restock_requests 
            (product_id, supplier_id, requested_quantity, store_id, status, purchase_price, selling_price) 
            VALUES (?, ?, ?, ?, 'PENDING', ?, ?)
            """,
            (product_id, supplier_id, quantity, store_id, purchase_price, selling_price)
        )
        conn.commit()
        return success_response(None, "Restock request submitted successfully", 201)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/vendors/search", methods=["GET"])
@require_warehouse_auth
def search_warehouse_vendors():
    """Search for vendors by name."""
    query = request.args.get("q", "")
    conn = get_db()
    try:
        vendors = conn.execute(
            "SELECT * FROM suppliers WHERE name LIKE ? LIMIT 10", 
            (f"%{query}%",)
        ).fetchall()
        return success_response([dict(v) for v in vendors])
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/vendors", methods=["POST"])
@require_warehouse_auth
def create_warehouse_vendor():
    """Add a new vendor to the catalog."""
    data = request.json
    name = data.get("name")
    contact = data.get("contact", "")
    email = data.get("email", "")
    gst_in = data.get("gst_in", "")
    role = data.get("role", "Wholesaler")
    
    if not name:
        return error_response("Vendor name is required", 400)
    
    conn = get_db()
    try:
        # Check if exists
        exists = conn.execute("SELECT id FROM suppliers WHERE name = ?", (name,)).fetchone()
        if exists:
            return error_response("Vendor already exists", 400)
        
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO suppliers (name, contact, email, gst_in, role) 
            VALUES (?, ?, ?, ?, ?)
        """, (name, contact, email, gst_in, role))
        conn.commit()
        return success_response({"id": cursor.lastrowid}, "Vendor added successfully")
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/vendors/<int:vendor_id>", methods=["PUT"])
@require_warehouse_auth
def update_warehouse_vendor(vendor_id):
    """Update vendor details."""
    data = request.json
    name = data.get("name")
    contact = data.get("contact", "")
    email = data.get("email", "")
    gst_in = data.get("gst_in", "")
    role = data.get("role")
    
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE suppliers 
            SET name = ?, contact = ?, email = ?, gst_in = ?, role = ?
            WHERE id = ?
        """, (name, contact, email, gst_in, role, vendor_id))
        conn.commit()
        return success_response(None, "Vendor updated successfully")
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/purchases", methods=["GET"])
@require_warehouse_auth
def get_warehouse_purchases():
    """List recent direct purchases for the warehouse."""
    wh_id = request.warehouse_payload["warehouse_id"]
    conn = get_db()
    try:
        wh = conn.execute("SELECT warehouse_name FROM warehouses WHERE id = ?", (wh_id,)).fetchone()
        ds = conn.execute("SELECT id, name FROM dark_stores WHERE name = ?", (wh["warehouse_name"],)).fetchone()
        store_id = ds["id"]
        
        purchases = conn.execute("""
            SELECT p.*, 
                   (SELECT COUNT(*) FROM purchase_items WHERE purchase_id = p.id) as item_count
            FROM purchases p 
            WHERE p.store_id = ? 
            ORDER BY p.created_at DESC
        """, (store_id,)).fetchall()
        
        # Get count for next invoice number
        total_count_row = conn.execute("SELECT COUNT(*) as count FROM purchases WHERE store_id = ?", (store_id,)).fetchone()
        total_count = total_count_row["count"] if total_count_row else 0
        
        return success_response({
            "purchases": [dict(p) for p in purchases],
            "store_name": ds["name"],
            "next_index": total_count + 1
        })
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/purchases", methods=["POST"])
@require_warehouse_auth
def create_direct_purchase():
    """Create a direct purchase and update inventory."""
    wh_id = request.warehouse_payload["warehouse_id"]
    data = request.json
    
    vendor_name = data.get("vendor_name")
    invoice_no = data.get("invoice_no")
    invoice_date = data.get("invoice_date")
    items = data.get("items", []) # List of {product_id, quantity, unit_price, selling_price}
    
    if not items:
        return error_response("No items in purchase", 400)
    
    conn = get_db()
    try:
        wh = conn.execute("SELECT warehouse_name FROM warehouses WHERE id = ?", (wh_id,)).fetchone()
        ds = conn.execute("SELECT id FROM dark_stores WHERE name = ?", (wh["warehouse_name"],)).fetchone()
        store_id = ds["id"]
        
        total_amount = sum(float(i['quantity']) * float(i['unit_price']) for i in items)
        
        # 1. Create Purchase record
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO purchases (vendor_name, invoice_no, invoice_date, total_amount, store_id, status)
            VALUES (?, ?, ?, ?, ?, 'COMPLETED')
        """, (vendor_name, invoice_no, invoice_date, total_amount, store_id))
        purchase_id = cursor.lastrowid
        
        for item in items:
            # 2. Add Purchase items
            cursor.execute("""
                INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_price, selling_price)
                VALUES (?, ?, ?, ?, ?)
            """, (purchase_id, item['product_id'], item['quantity'], item['unit_price'], item['selling_price']))
            
            # 3. Update Inventory immediately
            # Check if item exists in inventory
            inv = cursor.execute(
                "SELECT stock_quantity FROM warehouse_inventory WHERE store_id = ? AND product_id = ?", 
                (store_id, item['product_id'])
            ).fetchone()
            
            if inv:
                cursor.execute(
                    "UPDATE warehouse_inventory SET stock_quantity = stock_quantity + ? WHERE store_id = ? AND product_id = ?",
                    (item['quantity'], store_id, item['product_id'])
                )
            else:
                cursor.execute(
                    "INSERT INTO warehouse_inventory (store_id, product_id, stock_quantity) VALUES (?, ?, ?)",
                    (store_id, item['product_id'], item['quantity'])
                )
        
        conn.commit()
        return success_response({"purchase_id": purchase_id}, "Purchase completed and inventory updated")
    except Exception as e:
        conn.rollback()
        return error_response(str(e), 500)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/orders", methods=["GET"])
@require_warehouse_auth
def get_warehouse_orders():
    """List all orders assigned to this warehouse with optional status filtering."""
    wh_id = request.warehouse_payload["warehouse_id"]
    status = request.args.get("status")
    limit = request.args.get("limit", 50, type=int)
    
    conn = get_db()
    try:
        query = """
            SELECT woa.id, woa.order_id, woa.assignment_status, woa.created_at,
                   o.total_amount, o.delivery_address, o.customer_phone as phone, o.delivery_type,
                   GROUP_CONCAT(
                       p.name || ' (x' || oi.quantity || ')' ||
                       CASE
                           WHEN oi.device_model IS NOT NULL AND oi.device_model != ''
                           THEN ' - Device: ' || oi.device_model
                           ELSE ''
                       END,
                       ', '
                   ) as items,
                   MAX(CASE
                       WHEN LOWER(COALESCE(c.name, p.category, '')) = 'sticker'
                            OR COALESCE(c.device_customization_enabled, 0) = 1
                       THEN 1 ELSE 0
                   END) as has_custom_cutting,
                   SUM(oi.quantity) as total_quantity
            FROM warehouse_order_assignments woa
            JOIN orders o ON o.id = woa.order_id
            LEFT JOIN order_items oi ON oi.order_id = o.id
            LEFT JOIN products p ON p.id = oi.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE woa.warehouse_id = ?
        """
        params = [wh_id]
        
        if status:
            query += " AND woa.assignment_status = ?"
            params.append(status)
            
        query += " GROUP BY woa.id ORDER BY woa.created_at DESC LIMIT ?"
        params.append(limit)
        
        rows = conn.execute(query, params).fetchall()
        orders = [dict(r) for r in rows]
        
        return success_response(orders, "Orders retrieved successfully")
    except Exception as e:
        current_app.logger.error(f"Failed to get warehouse orders: {str(e)}")
        return error_response(str(e), 500)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/products/<int:product_id>/category", methods=["PUT"])
@require_warehouse_auth
def update_product_category(product_id):
    """Update the category of a global product."""
    data = request.json
    category = data.get("category")
    if not category:
        return error_response("Category is required", 400)
    
    conn = get_db()
    try:
        conn.execute("UPDATE products SET category = ? WHERE id = ?", (category, product_id))
        conn.commit()
        return success_response(None, "Product category updated successfully")
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/categories", methods=["GET"])
@require_warehouse_auth
def get_all_categories():
    """List all unique product categories."""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != ''"
        ).fetchall()
        categories = [r["category"] for r in rows]
        return success_response(categories)
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/categories", methods=["POST"])
@require_warehouse_auth
def warehouse_create_category():
    """Create a new product category (warehouse staff can create categories)."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    emoji = (data.get("emoji") or "📦").strip()
    icon = (data.get("icon") or "").strip()

    if not name:
        return error_response("Category name is required", 400)

    conn = get_db()
    try:
        # Check for duplicate
        existing = conn.execute(
            "SELECT id FROM categories WHERE LOWER(name) = LOWER(?)", (name,)
        ).fetchone()
        if existing:
            return error_response("A category with this name already exists", 409)

        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO categories (name, icon, emoji) VALUES (?, ?, ?)",
            (name, icon, emoji)
        )
        conn.commit()
        new_id = cursor.lastrowid
        return success_response(
            {"id": new_id, "name": name, "emoji": emoji, "icon": icon},
            "Category created successfully",
            201
        )
    except Exception as e:
        # Fallback: emoji column may not exist, retry without it
        try:
            conn.rollback()
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO categories (name, icon) VALUES (?, ?)",
                (name, icon)
            )
            conn.commit()
            new_id = cursor.lastrowid
            return success_response(
                {"id": new_id, "name": name, "emoji": emoji, "icon": icon},
                "Category created successfully",
                201
            )
        except Exception as e2:
            return error_response(str(e2), 500)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/scan-invoice", methods=["POST"])
@require_warehouse_auth
def scan_invoice():
    """Extract product data from an uploaded invoice (PDF or Image)."""
    if 'file' not in request.files:
        return error_response("No file uploaded", 400)
    
    file = request.files['file']
    if file.filename == '':
        return error_response("No file selected", 400)

    # Save temp file
    temp_path = os.path.join(BASE_DIR, f"temp_{uuid.uuid4().hex}_{file.filename}")
    file.save(temp_path)
    
    conn = get_db()
    try:
        extracted_items = []
        
        # 1. Try PDF extraction if applicable
        if file.filename.lower().endswith('.pdf'):
            try:
                with pdfplumber.open(temp_path) as pdf:
                    text = ""
                    for page in pdf.pages:
                        text += (page.extract_text() or "") + "\n"
                    
                    if text.strip():
                        extracted_items = match_products_from_text(text, conn)
            except Exception as pdf_err:
                current_app.logger.warning(f"PDF extraction failed: {str(pdf_err)}")
        
        # 2. If still empty, try Image OCR via Node worker
        if not extracted_items:
            try:
                # Run node ocr_worker.js
                result = subprocess.run(
                    ['node', 'ocr_worker.js', temp_path],
                    capture_output=True,
                    text=True,
                    timeout=30,
                    cwd=os.path.dirname(os.path.abspath(__file__))
                )
                if result.returncode == 0:
                    ocr_text = result.stdout
                    if ocr_text.strip():
                        extracted_items = match_products_from_text(ocr_text, conn)
                else:
                    current_app.logger.error(f"Node OCR worker failed: {result.stderr}")
            except Exception as ocr_err:
                current_app.logger.error(f"Node OCR call failed: {str(ocr_err)}")
                
        if not extracted_items:
            return error_response(
                "Scanner could not find any matching products in this file. "
                "Please ensure the image is clear or try a PDF invoice.", 
                422
            )

        return success_response({
            "items": extracted_items,
            "count": len(extracted_items)
        }, "Invoice data extracted successfully")

    except Exception as e:
        current_app.logger.error(f"Invoice extraction failed: {str(e)}", exc_info=True)
        return error_response(f"Extraction failed: {str(e)}", 500)
    finally:
        conn.close()
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass


def match_products_from_text(text, conn):
    """Matches product names found in text against the database."""
    extracted_items = []
    # Get all products for matching
    rows = conn.execute("SELECT id, name FROM products").fetchall()
    products = [dict(r) for r in rows]
    
    lines = text.split('\n')
    for line in lines:
        line = line.strip()
        if not line: 
            continue
            
        # Find product matches
        for p in products:
            if p['name'].lower() in line.lower():
                # Try to find numbers (prices/qty)
                nums = re.findall(r'\d+(?:\.\d{1,2})?', line)
                if nums:
                    # Heuristic: last decimal number is usually the price
                    price = float(nums[-1]) if '.' in nums[-1] else float(nums[0])
                    extracted_items.append({
                        "product": p,
                        "quantity": 1,
                        "unit_price": price
                    })
                    break
    return extracted_items


@warehouse_bp.route("/api/warehouse/inventory", methods=["GET"])
@require_warehouse_auth
def warehouse_get_inventory():
    """List all inventory items for current warehouse."""
    wh_id = request.warehouse_payload["warehouse_id"]
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT wi.id, COALESCE(p.name, wi.product_name) as product_name, 
                      COALESCE(wi.sku, CAST(p.id AS TEXT)) as sku, wi.stock_quantity, 
                      (wi.reserved_stock + COALESCE((SELECT SUM(quantity) FROM cart WHERE product_id = p.id), 0)) as reserved_stock,
                      COALESCE((SELECT SUM(quantity) FROM cart WHERE product_id = p.id AND user_id IS NOT NULL), 0) as user_reserved,
                      COALESCE((SELECT SUM(quantity) FROM cart WHERE product_id = p.id AND session_id IS NOT NULL AND user_id IS NULL), 0) as guest_reserved,
                      wi.low_stock_threshold, wi.bin_location,
                      wi.brand as local_brand, p.brand as global_brand,
                      wi.unit, wi.cost_price, 
                      COALESCE(NULLIF(wi.selling_price, 0), p.price, 0) as selling_price,
                      wi.mrp, wi.discount_pct, wi.discount_amt, wi.gst_pct,
                      p.price as global_price,
                      wi.status,
                      p.id as product_id, c.name as category, p.category_id, p.sub_category, p.images,
                      p.description, p.delivery_time, p.units_per_pack, p.material_type,
                      p.weight, p.dimensions, p.is_fragile, p.is_temp_sensitive,
                      p.is_perishable, p.expiry_date, p.is_featured,
                      p.return_policy,
                      c.return_policy as category_return_policy,
                      ROUND(COALESCE((SELECT AVG(rating) FROM product_reviews WHERE product_id = p.id), 0), 1) as average_rating
               FROM warehouse_inventory wi
               LEFT JOIN products p ON p.id = wi.product_id
               LEFT JOIN categories c ON p.category_id = c.id
               WHERE wi.warehouse_id = ?
               ORDER BY wi.id DESC""",
            (wh_id,),
        ).fetchall()
        return jsonify([dict(r) for r in rows]), 200
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/inventory", methods=["POST"])
@require_warehouse_auth
def warehouse_add_inventory():
    """Add a product to warehouse inventory."""
    wh_id = request.warehouse_payload["warehouse_id"]
    data = request.get_json(silent=True) or {}
    product_id = data.get("product_id")
    sku = data.get("sku")
    stock_quantity = data.get("stock_quantity", 0)
    low_stock_threshold = data.get("low_stock_threshold", 2)
    bin_location = data.get("bin_location")
    brand = data.get("brand")
    unit = data.get("unit", "pcs")
    cost_price = data.get("cost_price", 0.0)
    selling_price = data.get("selling_price", 0.0)
    status = data.get("status", "active")

    if not product_id or not sku:
        return error_response("product_id and sku are required", 400)

    conn = get_db()
    try:
        # Check if already exists in this warehouse
        existing = conn.execute(
            "SELECT id FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?",
            (wh_id, product_id),
        ).fetchone()
        
        if existing:
            return error_response("This product is already in your inventory", 409)

        # Get product name for fallback
        product = conn.execute("SELECT name FROM products WHERE id = ?", (product_id,)).fetchone()
        if not product:
            return error_response("Product not found in global catalog", 404)

        conn.execute(
            """INSERT INTO warehouse_inventory 
               (warehouse_id, product_id, product_name, sku, stock_quantity, available_stock,
                low_stock_threshold, bin_location, brand, unit, cost_price, 
                selling_price, mrp, discount_pct, gst_pct, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                wh_id, product_id, product["name"], sku, stock_quantity, stock_quantity,
                low_stock_threshold, bin_location, brand, unit, cost_price, 
                selling_price, data.get('mrp', 0.0), data.get('discount_pct', 0.0), 
                data.get('gst_pct'), status
            ),
        )
        
        # Sync global products.stock
        conn.execute(
            """UPDATE products SET stock = (
                SELECT COALESCE(SUM(MAX(0, stock_quantity - reserved_stock)), 0)
                FROM warehouse_inventory WHERE product_id = ?
            ) WHERE id = ?""",
            (product_id, product_id)
        )
        
        conn.commit()
        return success_response(None, "SKU added to inventory and synced with catalog", 201)
    finally:
        conn.close()




@warehouse_bp.route("/api/warehouse/products", methods=["POST"])
@require_warehouse_auth
def warehouse_create_product():
    """Create a new global product and automatically add it to this warehouse inventory."""
    data = request.json
    wh_id = request.warehouse_payload["warehouse_id"]
    
    name = data.get('name')
    price = data.get('price')
    category = data.get('category')
    category_id = data.get('category_id')
    images = data.get('images')
    if isinstance(images, list):
        images = json.dumps(images)
    delivery_time = data.get('delivery_time', '10-30 mins')
    initial_stock = data.get('stock_quantity', 0)
    sku = data.get('sku')
    barcode = data.get('barcode', '').strip() or None
    global_sku_code = data.get('global_sku_code', '').strip() or None
    
    description = data.get('description', '')

    if not name or price is None:
        return error_response("Missing name or price", 400)
    
    # Validate barcode if provided (e.g., 13-digit format)
    if barcode:
        if not barcode.isdigit() or not (8 <= len(barcode) <= 14):
            return error_response("Invalid barcode format. Must be 8-14 digits.", 400)
        
    conn = get_db()
    try:
        cursor = conn.cursor()
        
        # Check barcode uniqueness if provided
        if barcode:
            existing = cursor.execute("SELECT id FROM products WHERE barcode = ?", (barcode,)).fetchone()
            if existing:
                return error_response(f"Product with barcode {barcode} already exists in global catalog.", 409)

            # 1. Insert into products
        cursor.execute(
            """
            INSERT INTO products (
                name, description, sub_category, price, category, category_id, images, 
                delivery_time, barcode, global_sku_code, brand, units_per_pack, material_type,
                weight, dimensions, is_fragile, is_temp_sensitive, is_perishable, expiry_date, is_featured
            ) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name, description, data.get('sub_category'), price, category, category_id, images, 
                delivery_time, barcode, global_sku_code, data.get('brand'), data.get('units_per_pack'), 
                data.get('material_type'), data.get('weight'), data.get('dimensions'),
                data.get('is_fragile', 0), data.get('is_temp_sensitive', 0), 
                data.get('is_perishable', 0), data.get('expiry_date'),
                data.get('is_featured', 0)
            )
        )
        product_id = cursor.lastrowid
        
        # 2. Logic for Unique Identifier (SKU)
        final_sku = sku or global_sku_code or barcode
        
        if not final_sku:
            final_sku = str(random.randint(100000, 999999))
            # Verify uniqueness in warehouse inventory
            while cursor.execute("SELECT id FROM warehouse_inventory WHERE sku = ?", (final_sku,)).fetchone():
                final_sku = str(random.randint(100000, 999999))
        
        # 3. Add to warehouse_inventory
        cursor.execute(
            """INSERT INTO warehouse_inventory 
               (warehouse_id, product_id, product_name, sku, stock_quantity, available_stock,
                low_stock_threshold, cost_price, selling_price, mrp, 
                discount_pct, discount_amt, gst_pct, brand, unit)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                wh_id, product_id, name, final_sku, initial_stock, initial_stock, 2, 
                data.get('cost_price', 0), data.get('selling_price', 0),
                data.get('mrp', 0.0), data.get('discount_pct', 0.0),
                data.get('discount_amt', 0.0),
                data.get('gst_pct'), data.get('brand'), data.get('unit', 'pcs')
            )
        )

        # Sync global products.stock
        conn.execute(
            """UPDATE products SET stock = (
                SELECT COALESCE(SUM(MAX(0, stock_quantity - reserved_stock)), 0)
                FROM warehouse_inventory WHERE product_id = ?
            ) WHERE id = ?""",
            (product_id, product_id)
        )
        
        conn.commit()
        return success_response({"product_id": product_id, "sku": final_sku}, "Product created, added to inventory, and synced with catalog", 201)
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/inventory/<int:item_id>", methods=["PATCH"])
@require_warehouse_auth
def warehouse_patch_inventory(item_id):
    """Update stock or details of an inventory item."""
    wh_id = request.warehouse_payload["warehouse_id"]
    data = request.get_json(silent=True) or {}
    
    allowed = {
        "stock_quantity", "low_stock_threshold", "bin_location", "sku", 
        "brand", "unit", "cost_price", "selling_price", "status",
        "mrp", "discount_pct", "discount_amt", "gst_pct", "is_featured"
    }
    updates = {k: v for k, v in data.items() if k in allowed}
    
    if not updates and "images" not in data and "description" not in data:
        return error_response("No valid fields to update", 400)

    conn = get_db()
    try:
        inv = conn.execute("SELECT product_id FROM warehouse_inventory WHERE id = ? AND warehouse_id = ?", (item_id, wh_id)).fetchone()
        if not inv:
            return error_response("Inventory item not found", 404)
            
        # Update product metadata (images, description, brand, etc) if provided
        product_meta_fields = [
            "name", "images", "description", "brand", "units_per_pack", "material_type", 
            "category_id", "sub_category", "weight", "dimensions", "is_fragile", 
            "is_temp_sensitive", "is_perishable", "expiry_date", "is_featured"
        ]
        meta_updates = []
        meta_values = []
        for field in product_meta_fields:
            if field in data:
                val = data[field]
                if field == "images" and isinstance(val, list):
                    val = json.dumps(val)
                meta_updates.append(f"{field} = ?")
                meta_values.append(val)
        
        if meta_updates:
            meta_values.append(inv["product_id"])
            conn.execute(f"UPDATE products SET {', '.join(meta_updates)} WHERE id = ?", meta_values)

        # Update inventory fields if any
        # Remove fields that belong to global product metadata from inventory updates
        for global_field in ["is_featured"]:
            updates.pop(global_field, None)

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            values = list(updates.values()) + [item_id, wh_id]
            cursor = conn.execute(
                f"UPDATE warehouse_inventory SET {set_clause} WHERE id = ? AND warehouse_id = ?",
                values,
            )
            if cursor.rowcount == 0 and "images" not in data:
                return error_response("Inventory item not found", 404)

        # Auto-sync available_stock = stock_quantity - reserved_stock
        if "stock_quantity" in updates or "reserved_stock" in updates:
            inv = conn.execute(
                "SELECT product_id, stock_quantity, reserved_stock FROM warehouse_inventory WHERE id = ? AND warehouse_id = ?",
                (item_id, wh_id)
            ).fetchone()
            if inv:
                new_available = max(0, (inv["stock_quantity"] or 0) - (inv["reserved_stock"] or 0))
                conn.execute(
                    "UPDATE warehouse_inventory SET available_stock = ? WHERE id = ?",
                    (new_available, item_id)
                )
                # Sync global products.stock (sum of all warehouses)
                conn.execute(
                    """UPDATE products SET stock = (
                        SELECT COALESCE(SUM(MAX(0, stock_quantity - reserved_stock)), 0)
                        FROM warehouse_inventory WHERE product_id = ?
                    ) WHERE id = ?""",
                    (inv["product_id"], inv["product_id"])
                )

        conn.commit()
        # Clear cache to reflect updates immediately
        try:
            from app import cache
            cache.clear()
        except Exception:
            pass
        return success_response(None, "Inventory updated", 200)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/inventory/<int:item_id>", methods=["DELETE"])
@require_warehouse_auth
def warehouse_delete_inventory(item_id):
    """Remove a SKU from warehouse inventory."""
    wh_id = request.warehouse_payload["warehouse_id"]
    conn = get_db()
    try:
        cursor = conn.execute(
            "DELETE FROM warehouse_inventory WHERE id = ? AND warehouse_id = ?",
            (item_id, wh_id),
        )
        if cursor.rowcount == 0:
            return error_response("Inventory item not found", 404)
        conn.commit()
        return success_response(None, "SKU removed from inventory", 200)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/inventory/<int:item_id>/adjust", methods=["POST"])
@require_warehouse_auth
def warehouse_adjust_stock(item_id):
    """Adjust stock IN or OUT with reason and remark. Logs to stock_movements."""
    wh_id = request.warehouse_payload["warehouse_id"]
    data = request.get_json(silent=True) or {}

    movement_type = (data.get("movement_type") or "").upper()
    quantity = int(data.get("quantity") or 0)
    reason = (data.get("reason") or "").strip()
    remark = (data.get("remark") or "").strip()
    performed_by = (data.get("performed_by") or "Warehouse Staff").strip()

    if movement_type not in ("IN", "OUT"):
        return error_response("movement_type must be 'IN' or 'OUT'", 400)
    if quantity <= 0:
        return error_response("Quantity must be greater than 0", 400)
    if not reason:
        return error_response("Reason is required", 400)

    conn = get_db()
    try:
        item = conn.execute(
            "SELECT * FROM warehouse_inventory WHERE id = ? AND warehouse_id = ?",
            (item_id, wh_id)
        ).fetchone()

        if not item:
            return error_response("Inventory item not found", 404)

        stock_before = item["stock_quantity"]
        if movement_type == "IN":
            stock_after = stock_before + quantity
        else:
            if quantity > stock_before:
                return error_response(f"Insufficient stock. Available: {stock_before}", 400)
            stock_after = max(0, stock_before - quantity)

        new_available = max(0, stock_after - (item["reserved_stock"] or 0))

        # Update warehouse_inventory
        conn.execute(
            """UPDATE warehouse_inventory 
               SET stock_quantity = ?, available_stock = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (stock_after, new_available, item_id)
        )

        # Sync global products.stock
        if item["product_id"]:
            conn.execute(
                """UPDATE products SET stock = (
                    SELECT COALESCE(SUM(MAX(0, stock_quantity - reserved_stock)), 0)
                    FROM warehouse_inventory WHERE product_id = ?
                ) WHERE id = ?""",
                (item["product_id"], item["product_id"])
            )
            
            # Trigger low-stock notifications if applicable
            cursor = conn.execute("SELECT name, stock FROM products WHERE id = ?", (item["product_id"],))
            prod_data = cursor.fetchone()
            if prod_data and 0 < prod_data['stock'] <= (item['low_stock_threshold'] or 5):
                trigger_low_stock_notifications(
                    item["product_id"], 
                    prod_data['stock'], 
                    prod_data['name'],
                    get_db,
                    notification_service.notify_user_internal
                )
            # --- Restock Notification Trigger ---
            if stock_before == 0 and stock_after > 0:
                # Find all pending notifications for this product
                subs = conn.execute(
                    "SELECT id, email, user_id FROM product_notifications WHERE product_id = ? AND status = 'pending'",
                    (item["product_id"],)
                ).fetchall()
                
                for sub in subs:
                    # Send Email
                    send_product_restock_alert(sub['email'], prod_data['name'])
                    
                    # Send In-App Notification
                    if sub['user_id']:
                        notification_service.notify_user_internal(
                            sub['user_id'],
                            "Back In Stock! 📦",
                            f"The product {prod_data['name']} is now available in our warehouse. Order now!",
                            "system"
                        )
                    
                    # Update status
                    conn.execute(
                        "UPDATE product_notifications SET status = 'notified' WHERE id = ?",
                        (sub['id'],)
                    )

        # Log to stock_movements
        conn.execute(
            """INSERT INTO stock_movements 
               (warehouse_id, product_id, inventory_item_id, product_name, movement_type,
                quantity, reason, remark, stock_before, stock_after, performed_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (wh_id, item["product_id"], item_id, item["product_name"],
             movement_type, quantity, reason, remark or None,
             stock_before, stock_after, performed_by)
        )

        conn.commit()
        return success_response({
            "stock_before": stock_before,
            "stock_after": stock_after,
            "movement_type": movement_type,
            "quantity": quantity,
            "reason": reason
        }, f"Stock {movement_type} recorded successfully")
    except Exception as e:
        conn.rollback()
        return error_response(str(e), 500)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/inventory/<int:item_id>/movements", methods=["GET"])
@require_warehouse_auth
def warehouse_stock_movements(item_id):
    """Fetch movement history for an inventory item."""
    wh_id = request.warehouse_payload["warehouse_id"]
    limit = request.args.get("limit", 20, type=int)
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT * FROM stock_movements 
               WHERE inventory_item_id = ? AND warehouse_id = ?
               ORDER BY created_at DESC LIMIT ?""",
            (item_id, wh_id, limit)
        ).fetchall()
        return success_response([dict(r) for r in rows], "Movements fetched")
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/orders/<int:assignment_id>/status", methods=["PATCH"])
@require_warehouse_auth
def warehouse_update_order_status(assignment_id):
    """Update a warehouse assignment status from the warehouse dashboard."""
    wh_id = request.warehouse_payload["warehouse_id"]
    data = request.get_json(silent=True) or {}
    new_status = (data.get("status") or "").strip().lower()

    allowed_transitions = {
        "assigned": {"accepted", "rejected"},
        "accepted": {"packing", "rejected"},
        "packing": {"packed", "rejected"},
        "packed": {"dispatched"},
        "dispatched": set(),
        "rejected": set(),
    }
    order_status_map = {
        "accepted": "PACKING",
        "packing": "PACKING",
        "packed": "PACKING",
        "dispatched": "OUT_FOR_DELIVERY",
    }

    if new_status not in allowed_transitions:
        return error_response("Invalid warehouse status", 400)

    conn = get_db()
    try:
        assignment = conn.execute(
            """SELECT id, order_id, assignment_status
               FROM warehouse_order_assignments
               WHERE id = ? AND warehouse_id = ?""",
            (assignment_id, wh_id),
        ).fetchone()
        
        if not assignment:
            return error_response("Warehouse order not found", 404)

        current_status = assignment["assignment_status"]
        if new_status == current_status:
            return success_response({"assignment_status": current_status}, "Warehouse order already updated")

        if new_status not in allowed_transitions.get(current_status, set()):
            return error_response(f"Cannot move warehouse order from {current_status} to {new_status}", 400)

        conn.execute(
            """UPDATE warehouse_order_assignments
               SET assignment_status = ?
               WHERE id = ? AND warehouse_id = ?""",
            (new_status, assignment_id, wh_id),
        )

        mapped_order_status = order_status_map.get(new_status)
        if mapped_order_status == "PACKING":
            conn.execute(
                """UPDATE orders
                   SET order_status = ?, confirmed_at = COALESCE(confirmed_at, CURRENT_TIMESTAMP)
                   WHERE id = ?""",

                (mapped_order_status, assignment["order_id"]),
            )
        elif new_status == "packed":
            conn.execute(
                """UPDATE orders
                   SET order_status = ?, packed_at = COALESCE(packed_at, CURRENT_TIMESTAMP)
                   WHERE id = ?""",
                (mapped_order_status, assignment["order_id"]),
            )
        elif mapped_order_status == "OUT_FOR_DELIVERY":
            conn.execute(
                """UPDATE orders
                   SET order_status = ?, out_for_delivery_at = COALESCE(out_for_delivery_at, CURRENT_TIMESTAMP)
                   WHERE id = ?""",

                (mapped_order_status, assignment["order_id"]),
            )

        conn.commit()
        return jsonify({
            "message": "Warehouse order updated successfully",
            "assignment_id": assignment_id,
            "assignment_status": new_status,
            "order_status": mapped_order_status,
        }), 200
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/settings", methods=["PATCH"])
@require_warehouse_auth
def warehouse_settings():
    """Update warehouse availability settings."""
    wh_id = request.warehouse_payload.get("warehouse_id")
    data = request.get_json(silent=True) or {}
    print(f"[DEBUG] warehouse_settings: wh_id={wh_id}, data={data}")

    allowed = {"operations_status", "weather_status", "service_radius_km", "quick_mode_enabled"}
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        print(f"[DEBUG] warehouse_settings: No valid fields to update in {data}")
        return error_response("No valid fields to update", 400)

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [wh_id]

    conn = get_db()
    try:
        print(f"[DEBUG] warehouse_settings: Executing UPDATE warehouses SET {set_clause} WHERE id = ? with values {values}")
        cursor = conn.execute(
            f"UPDATE warehouses SET {set_clause} WHERE id = ?", values
        )

        # Sync with dark_stores and warehouse_partners if operations_status or quick_mode_enabled was changed
        if "operations_status" in updates or "quick_mode_enabled" in updates:
            # Find dark_store and warehouse_partner by name (as per current mapping)
            wh_info = conn.execute("SELECT warehouse_name, operations_status, quick_mode_enabled FROM warehouses WHERE id = ?", (wh_id,)).fetchone()
            if wh_info:
                new_op_status = wh_info["operations_status"]
                is_active = 1 if new_op_status == "open" else 0
                is_quick_enabled = wh_info["quick_mode_enabled"]
                
                # Sync with dark_stores (used for Admin/Orders)
                conn.execute(
                    "UPDATE dark_stores SET active = ?, quick_mode_enabled = ? WHERE name = ?",
                    (is_active, is_quick_enabled, wh_info["warehouse_name"])
                )
                # Sync with warehouse_partners (used for Storefront Availability)
                conn.execute(
                    "UPDATE warehouse_partners SET operations_status = ?, quick_mode_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE warehouse_name = ?",
                    (new_op_status, is_quick_enabled, wh_info["warehouse_name"])
                )

        conn.commit()
        print(f"[DEBUG] warehouse_settings: Update successful, rows affected: {cursor.rowcount}")

        wh = conn.execute("SELECT * FROM warehouses WHERE id = ?", (wh_id,)).fetchone()
        if not wh:
            print(f"[DEBUG] warehouse_settings: Warehouse not found after update for wh_id={wh_id}")
            return error_response("Warehouse not found", 404)

        wh_dict = dict(wh)
        print(f"[DEBUG] warehouse_settings: Returning updated warehouse: {wh_dict['warehouse_name']}")

        return jsonify({
            "message": "Settings updated",
            "warehouse": wh_dict,
        }), 200
    except Exception as e:
        print(f"[DEBUG] warehouse_settings: Error during update: {str(e)}")
        traceback.print_exc()
        return error_response(f"Internal database error: {str(e)}", 500)
    finally:
        conn.close()



# ── Admin Warehouse Management ───────────────────────────────────────────────

def _require_admin_token():
    """Raise 401 if request has no valid admin JWT."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        abort(401)
        
    token = auth.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, _get_jwt_secret(), algorithms=["HS256"])
        role = payload.get("role", "")
        if role not in ("admin", "super_admin"):
            abort(403)
    except jwt.InvalidTokenError:
        abort(401)


@warehouse_bp.route("/api/admin/warehouse/applications")
def admin_list_warehouse_applications():
    """Admin: list all warehouse applications."""
    _require_admin_token()
    status_filter = request.args.get("status")
    conn = get_db()
    try:
        if status_filter:
            rows = conn.execute(
                """SELECT wa.*, ds.store_code, w.operations_status 
                   FROM warehouse_applications wa 
                   LEFT JOIN dark_stores ds ON wa.warehouse_name = ds.name 
                   LEFT JOIN warehouses w ON wa.id = w.application_id
                   WHERE wa.verification_status = ? 
                   ORDER BY wa.created_at DESC""",
                (status_filter,),
            ).fetchall()

        else:
            rows = conn.execute(
                """SELECT wa.*, ds.store_code, w.operations_status 
                   FROM warehouse_applications wa 
                   LEFT JOIN dark_stores ds ON wa.warehouse_name = ds.name 
                   LEFT JOIN warehouses w ON wa.id = w.application_id
                   ORDER BY wa.created_at DESC"""
            ).fetchall()

        return jsonify({"applications": [dict(r) for r in rows]}), 200
    finally:
        conn.close()


@warehouse_bp.route("/api/admin/warehouse/applications/<int:app_id>", methods=["PATCH"])
def admin_update_warehouse_application(app_id):
    """Admin: approve or reject a warehouse application."""
    _require_admin_token()
    data = request.get_json(silent=True) or {}
    
    # Support both old frontend payload and new modular frontend payload
    action = (data.get("action") or "").strip().lower()
    if action == "approve":
        new_status = "approved"
    elif action == "reject":
        new_status = "rejected"
    else:
        new_status = data.get("verification_status")

    allowed_statuses = ("approved", "rejected", "pending", "suspended", "banned")
    allowed_actions = ("suspend", "ban", "unban", "remove")
    
    if new_status not in allowed_statuses and action not in allowed_actions:
        return error_response("Invalid action or verification_status.", 400)

    conn = get_db()
    try:
        app_row = conn.execute(
            "SELECT * FROM warehouse_applications WHERE id = ?", (app_id,)
        ).fetchone()
        
        if not app_row:
            return error_response("Application not found", 404)

        admin_notes = data.get("notes", data.get("admin_notes", app_row["admin_notes"]))

        # Record admin details
        admin_id = request.headers.get("X-Admin-Id")
        admin_name = request.headers.get("X-Admin-Name")
        
        # Best effort to get admin info from token if not in headers
        if not admin_id:
            try:
                auth_token = request.headers.get("Authorization", "").split(" ")[1]
                decoded = jwt.decode(auth_token, _get_jwt_secret(), algorithms=["HS256"])
                admin_id = decoded.get("user_id")
            except:
                pass

        # Update status and timestamps
        if action == "approve" or new_status == "approved":
            new_status = "approved"
            conn.execute(
                """UPDATE warehouse_applications
                   SET verification_status = ?, admin_notes = ?,
                       approved_by_id = ?, approved_by_name = ?,
                       approved_at = CURRENT_TIMESTAMP,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (new_status, admin_notes, admin_id, admin_name, app_id),
            )
        elif action == "reject" or new_status == "rejected":
            new_status = "rejected"
            conn.execute(
                """UPDATE warehouse_applications
                   SET verification_status = ?, admin_notes = ?,
                       approved_by_id = ?, approved_by_name = ?,
                       rejected_at = CURRENT_TIMESTAMP,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (new_status, admin_notes, admin_id, admin_name, app_id),
            )
        elif action == "suspend":
            new_status = "suspended"
            conn.execute(
                "UPDATE warehouse_applications SET verification_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (new_status, app_id)
            )
        elif action == "ban":
            new_status = "banned"
            conn.execute(
                "UPDATE warehouse_applications SET verification_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (new_status, app_id)
            )
        elif action == "unban":
            new_status = "approved"
            conn.execute(
                "UPDATE warehouse_applications SET verification_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (new_status, app_id)
            )
        elif action == "remove":
            conn.execute("DELETE FROM warehouses WHERE application_id = ?", (app_id,))
            conn.execute(
                """UPDATE warehouse_applications 
                   SET verification_status = 'rejected', admin_notes = 'Removed by admin', 
                       updated_at = CURRENT_TIMESTAMP 
                   WHERE id = ?""",
                (app_id,)
            )
            conn.commit()
            return success_response(None, "Warehouse removed successfully", 200)
        else:
            conn.execute(
                """UPDATE warehouse_applications
                   SET verification_status = ?, admin_notes = ?,
                       approved_by_id = ?, approved_by_name = ?,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (new_status, admin_notes, admin_id, admin_name, app_id),
            )
        conn.commit()

        # If approved: create/update a warehouses record and sync with dark_stores
        if new_status == "approved":
            existing_wh = conn.execute(
                "SELECT id FROM warehouses WHERE email = ?", (app_row["email"],)
            ).fetchone()
            
            existing_ds = conn.execute(
                "SELECT id FROM dark_stores WHERE name = ?", (app_row["warehouse_name"],)
            ).fetchone()

            if not existing_wh:
                conn.execute(
                    """INSERT INTO warehouses
                       (application_id, partner_id, warehouse_name, owner_name, email, phone,
                        address, pincode, warehouse_capacity, warehouse_type)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        app_id,
                        app_row["partner_id"] or generate_unique_partner_id(conn),
                        app_row["warehouse_name"],
                        app_row["owner_name"],
                        app_row["email"],
                        app_row["phone"],
                        app_row["address"],
                        app_row["pincode"],
                        app_row["warehouse_capacity"],
                        app_row["warehouse_type"],
                    ),
                )
            
            # Sync with dark_stores
            if not existing_ds:
                new_store_code = generate_unique_store_code(conn)
                conn.execute(
                    """INSERT INTO dark_stores 
                       (name, latitude, longitude, address, manager_name, phone, store_code) 
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (
                        app_row["warehouse_name"], 0.0, 0.0, 
                        app_row["address"], app_row["owner_name"], app_row["phone"],
                        new_store_code
                    )
                )
        elif new_status in ("suspended", "banned"):
            # Update active warehouse record if it exists
            conn.execute(
                "UPDATE warehouses SET account_status = ? WHERE email = ?",
                (new_status, app_row["email"])
            )
            # Sync with dark_stores
            conn.execute(
                "UPDATE dark_stores SET active = 0 WHERE name = ?",
                (app_row["warehouse_name"],)
            )
        elif action == "unban":
            conn.execute(
                "UPDATE warehouses SET account_status = 'active' WHERE email = ?",
                (app_row["email"],)
            )
            conn.execute(
                "UPDATE dark_stores SET active = 1 WHERE name = ?",
                (app_row["warehouse_name"],)
            )
        conn.commit()

        # Send email notification asynchronously
        if new_status in ("approved", "rejected", "suspended", "banned"):
            status_to_send = action if action in ("suspend", "ban", "unban") else new_status
            
            if action in ("suspend", "ban", "unban"):
                target_fn = send_warehouse_action_email
                target_args = (app_row["email"], app_row["owner_name"], app_row["warehouse_name"], status_to_send, admin_notes)
            else:
                target_fn = send_warehouse_application_email
                target_args = (app_row["email"], new_status, app_row["owner_name"], admin_notes)
                
            Thread(target=target_fn, args=target_args, daemon=True).start()

        return success_response(None, f"Application {new_status}", 200)
    finally:
        conn.close()


@warehouse_bp.route("/api/admin/warehouses")
def admin_list_warehouses():
    """Admin: list all approved warehouses with optional search."""
    _require_admin_token()
    search_query = request.args.get("q", "").strip()
    conn = get_db()
    try:
        if search_query:
            # Search by partner_id (exact), or partial name/email/owner
            sql = """
                SELECT * FROM warehouses 
                WHERE partner_id = ? 
                OR warehouse_name LIKE ? 
                OR owner_name LIKE ? 
                OR email LIKE ? 
                ORDER BY created_at DESC
            """
            like_query = f"%{search_query}%"
            rows = conn.execute(sql, (search_query, like_query, like_query, like_query)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM warehouses ORDER BY created_at DESC").fetchall()
        return jsonify({"warehouses": [dict(r) for r in rows]}), 200
    finally:
        conn.close()


@warehouse_bp.route("/api/admin/warehouse/applications/<int:app_id>/send-email", methods=["POST"])
def admin_send_warehouse_application_manual_email(app_id):
    """Admin: send a manual email to an applicant."""
    _require_admin_token()
    data = request.get_json(silent=True) or {}
    subject = data.get("subject")
    message = data.get("message")

    if not subject or not message:
        return error_response("Subject and message are required", 400)

    conn = get_db()
    try:
        app_row = conn.execute(
            "SELECT * FROM warehouse_applications WHERE id = ?", (app_id,)
        ).fetchone()
        
        if not app_row:
            return error_response("Application not found", 404)

        # Send email
        success = send_individual_email(
            app_row["email"], 
            app_row["owner_name"], 
            subject, 
            message
        )

        if not success:
            return error_response("Failed to send email via SMTP service", 500)

        # Log in mail history
        admin_id = None
        try:
            auth_token = request.headers.get("Authorization", "").split(" ")[1]
            decoded = jwt.decode(auth_token, _get_jwt_secret(), algorithms=["HS256"])
            admin_id = decoded.get("user_id")
        except Exception:
            pass

        if admin_id:
            conn.execute(
                """INSERT INTO mail_history (admin_id, recipient_type, recipient_email, subject, message)
                   VALUES (?, 'individual', ?, ?, ?)""",
                (admin_id, app_row["email"], subject, message),
            )
            conn.commit()

        return success_response(None, "Email sent successfully", 200)
    finally:
        conn.close()


@warehouse_bp.route("/api/admin/warehouse/applications/<int:app_id>/stats")
def admin_get_warehouse_stats(app_id):
    """Admin: get real-time stats for a warehouse application/partner."""
    _require_admin_token()
    conn = get_db()
    try:
        # First check if there's an approved warehouse for this application
        wh = conn.execute(
            "SELECT id FROM warehouses WHERE application_id = ?", (app_id,)
        ).fetchone()
        
        if not wh:
            # If not approved yet, return zeros or N/A
            return jsonify({
                "daily_sales": 0,
                "total_delivered": 0,
                "total_cancelled": 0,
                "active_orders": 0,
                "assigned_riders": 0
            }), 200

        wh_id = wh["id"]
        
        # 1. Daily Sales (Today's revenue)
        daily_sales_row = conn.execute("""
            SELECT SUM(o.total_amount) as sales
            FROM orders o
            JOIN warehouse_order_assignments woa ON o.id = woa.order_id
            WHERE woa.warehouse_id = ? 
            AND DATE(o.created_at) = DATE('now')
            AND o.order_status NOT IN ('CANCELLED', 'REFUNDED')
        """, (wh_id,)).fetchone()
        daily_sales = daily_sales_row["sales"] if daily_sales_row and daily_sales_row["sales"] else 0

        # 2. Total Delivered
        total_delivered = conn.execute("""
            SELECT COUNT(*) as cnt
            FROM orders o
            JOIN warehouse_order_assignments woa ON o.id = woa.order_id
            WHERE woa.warehouse_id = ? 
            AND o.order_status = 'DELIVERED'
        """, (wh_id,)).fetchone()["cnt"]

        # 3. Total Cancelled
        total_cancelled = conn.execute("""
            SELECT COUNT(*) as cnt
            FROM orders o
            JOIN warehouse_order_assignments woa ON o.id = woa.order_id
            WHERE woa.warehouse_id = ? 
            AND (o.order_status = 'CANCELLED' OR woa.assignment_status = 'rejected')
        """, (wh_id,)).fetchone()["cnt"]

        # 4. Active Orders
        active_orders = conn.execute("""
            SELECT COUNT(*) as cnt
            FROM warehouse_order_assignments
            WHERE warehouse_id = ? 
            AND assignment_status IN ('assigned', 'accepted', 'packing', 'packed')
        """, (wh_id,)).fetchone()["cnt"]

        # 5. Assigned Riders
        assigned_riders = conn.execute("""
            SELECT COUNT(DISTINCT o.delivery_partner_id) as cnt
            FROM orders o
            JOIN warehouse_order_assignments woa ON o.id = woa.order_id
            WHERE woa.warehouse_id = ? 
            AND o.order_status IN ('PLACED', 'PACKING', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP')
            AND o.delivery_partner_id IS NOT NULL
        """, (wh_id,)).fetchone()["cnt"]

        data = {
            "daily_sales": round(daily_sales, 2),
            "total_delivered": total_delivered,
            "total_cancelled": total_cancelled,
            "active_orders": active_orders,
            "assigned_riders": assigned_riders
        }
        return success_response(data, "Warehouse analytics retrieved")
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()


@warehouse_bp.route("/api/admin/warehouse-performance/<int:app_id>", methods=["GET"])
def admin_get_warehouse_performance(app_id):
    """Admin: get historical performance metrics for a warehouse."""
    _require_admin_token()
    conn = get_db()
    try:
        wh = conn.execute(
            "SELECT id, warehouse_name FROM warehouses WHERE application_id = ?", (app_id,)
        ).fetchone()
        
        if not wh:
            return error_response("Warehouse not found", 404)
            
        wh_id = wh["id"]
        
        # Fetch last 30 days of data
        cursor = conn.execute("""
            SELECT 
                DATE(o.created_at) as date,
                SUM(o.total_amount) as daily_revenue,
                COUNT(o.id) as daily_orders
            FROM orders o
            JOIN warehouse_order_assignments woa ON o.id = woa.order_id
            WHERE woa.warehouse_id = ? 
            AND o.created_at >= DATE('now', '-30 days')
            AND o.order_status NOT IN ('CANCELLED', 'REFUNDED')
            GROUP BY DATE(o.created_at)
            ORDER BY date ASC
        """, (wh_id,))
        
        db_rows = [dict(row) for row in cursor.fetchall()]
        
        # Fallback for demo data if needed
        is_demo = len(db_rows) < 2
        if is_demo:
            today = datetime.datetime.now()
            rows = []
            for i in range(14):
                d = (today - datetime.timedelta(days=14-i)).strftime('%Y-%m-%d')
                rows.append({
                    "date": d,
                    "daily_revenue": random.randint(5000, 15000),
                    "daily_orders": random.randint(10, 40)
                })
        else:
            rows = db_rows

        # Calculate AVG, MAX, MIN
        revenues = [r["daily_revenue"] for r in rows]
        orders_counts = [r["daily_orders"] for r in rows]
        
        performance = {
            "history": rows,
            "is_demo": is_demo,
            "stats": {
                "sales": {
                    "avg": round(sum(revenues) / len(revenues) if revenues else 0, 2),
                    "max": max(revenues) if revenues else 0,
                    "min": min(revenues) if revenues else 0
                },
                "orders": {
                    "avg": round(sum(orders_counts) / len(orders_counts) if orders_counts else 0, 1),
                    "max": max(orders_counts) if orders_counts else 0,
                    "min": min(orders_counts) if orders_counts else 0
                }
            }
        }

        return jsonify(performance), 200
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()
