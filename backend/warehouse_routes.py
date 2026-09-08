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
import time
import datetime
import logging
import sqlite3
import subprocess
import traceback
import hashlib
import secrets
from jwt_config import get_jwt_secret
from auth.role_guard import ADMIN_ROLES, normalize_role
from functools import wraps
from threading import Thread
from urllib.parse import quote

# Third-party imports
import jwt
import pdfplumber
from flask import Blueprint, jsonify, request, redirect, session, url_for, current_app, abort
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

# Local imports
from database import get_db as _db_get_db
from utils.response_utils import success_response, error_response, safe_float
from utils.product_url_utils import generate_share_token, generate_product_description
from notifier import (
    send_warehouse_application_email, 
    send_warehouse_registration_confirmation_email,
    send_individual_email,
    send_warehouse_action_email,
    send_warehouse_kyc_pending_email,
    send_product_restock_alert,
    send_staff_billing_setup_email
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
WAREHOUSE_REQUEST_UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads", "warehouse_requests")
PRODUCT_IMAGES_UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads", "product_images")
ALLOWED_UPLOAD_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}

warehouse_bp = Blueprint("warehouse", __name__)


def get_wh_cookie_settings():
    """Return cookie settings based on environment (secure only in production HTTPS)."""
    # Check FORCE_HTTPS env var and debug mode (similar to app.py)
    force_https = os.environ.get("FORCE_HTTPS", "").strip().lower() not in {"0", "false", "no", "off"}
    # In debug mode (local dev), don't force secure cookies
    if os.environ.get("FLASK_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}:
        force_https = False
    return {
        'httponly': True,
        'secure': force_https,
        'samesite': 'Lax'
    }


def _hash_warehouse_otp(otp, salt):
    """Hash a warehouse Google-linking OTP.

    Must stay identical to app._hash_admin_otp so google_link_verify can
    compare the stored hash.
    """
    return hashlib.sha256(f"{salt}:{otp}".encode()).hexdigest()





# ── DB helper ────────────────────────────────────────────────────────────────

def get_db():
    """Returns a database connection (Turso in production, local sqlite3 in dev)."""
    return _db_get_db()


def _normalize_offline_price(value):
    """Normalizes an offline (POS) sale price input.

    Empty/zero/negative/non-numeric values become None so the POS falls back
    to the regular online price.
    """
    if value in (None, ''):
        return None
    try:
        val = float(value)
    except (TypeError, ValueError):
        return None
    return val if val > 0 else None


def _get_current_warehouse_id():
    """Resolves the warehouse id for the current token.

    Warehouse owner tokens carry ``warehouse_id``; staff/billing-agent tokens
    carry ``vendor_id``. Both mean "the warehouse this user belongs to", so
    normalize to a single value so session / notification / dashboard reads
    work for staff sessions too.
    """
    payload = request.warehouse_payload
    if payload.get("type") == "warehouse_staff":
        return payload.get("vendor_id")
    return payload.get("warehouse_id")


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
    # Performance: resize + re-encode images before saving (PDFs pass through
    # untouched). Same URL, smaller file — optimize_and_save is internally
    # failsafe and saves the original bytes on any processing failure.
    from utils.image_optimizer import optimize_and_save
    optimize_and_save(file_storage, target_path)
    
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


# =============================================================================
# Variant Helper Functions
# =============================================================================

def _generate_variant_sku(product_sku, options):
    """
    Generate human-readable SKU from option values.
    Format: {product_sku}-{OPTION1_VALUE}-{OPTION2_VALUE}...
    Options are sorted by name for consistency.
    """
    if not options:
        return None
    
    sorted_options = sorted(options.items())
    option_parts = []
    for key, value in sorted_options:
        clean_value = str(value).replace(' ', '').replace('/', '').upper()[:10]
        if clean_value:
            option_parts.append(clean_value)
    
    if not option_parts:
        return None
    
    option_suffix = '-'.join(option_parts)
    base_sku = product_sku or 'PRD'
    return f"{base_sku}-{option_suffix}"


def _validate_variant_options(cursor, product_id, variant_options, option_groups, exclude_variant_id=None):
    """
    Validate variant options against defined option groups.
    Returns list of error messages (empty if valid).
    """
    errors = []
    
    if not option_groups:
        return errors
    
    # Build map of valid option values per group
    valid_values = {}
    for group in option_groups:
        group_name = group['option_name']
        group_values = set(str(v).strip() for v in group.get('option_values', []))
        valid_values[group_name] = group_values
    
    # Check each option group has a value in variant_options
    for group_name, allowed_values in valid_values.items():
        if group_name not in variant_options:
            errors.append(f"Missing required option: {group_name}")
        else:
            value = str(variant_options[group_name]).strip()
            if value not in allowed_values:
                errors.append(f"Invalid value for {group_name}: '{value}'. Allowed: {', '.join(sorted(allowed_values))}")
    
    # Check for extra options not in any group
    for opt_name in variant_options:
        if opt_name not in valid_values:
            errors.append(f"Unknown option group: {opt_name}")
    
    return errors


def _check_duplicate_variant_combination(cursor, product_id, variant_options, exclude_variant_id=None):
    """
    Check if a variant with the same option combination already exists.
    Returns the conflicting variant ID if found, None otherwise.
    """
    if not variant_options:
        return None
    
    options_json = json.dumps(variant_options, sort_keys=True)
    
    if exclude_variant_id:
        row = cursor.execute(
            "SELECT id FROM product_variants WHERE product_id = ? AND options = ? AND id != ?",
            (product_id, options_json, exclude_variant_id)
        ).fetchone()
    else:
        row = cursor.execute(
            "SELECT id FROM product_variants WHERE product_id = ? AND options = ?",
            (product_id, options_json)
        ).fetchone()
    
    return row['id'] if row else None


def _get_product_option_groups(cursor, product_id):
    """Fetch option groups for a product, returning list of dicts with option_name and option_values."""
    cursor.execute(
        "SELECT option_name, option_values FROM product_variant_options WHERE product_id = ? ORDER BY sort_order, id",
        (product_id,)
    )
    groups = []
    for row in cursor.fetchall():
        try:
            values = json.loads(row['option_values'] or '[]')
        except:
            values = []
        groups.append({
            'option_name': row['option_name'],
            'option_values': [str(v).strip() for v in values if str(v).strip()]
        })
    return groups


def _normalize_variant_options(raw_options):
    """Normalize variant options from various input formats to a dict."""
    if not raw_options:
        return {}
    if isinstance(raw_options, str):
        try:
            raw_options = json.loads(raw_options)
        except:
            return {}
    if isinstance(raw_options, dict):
        return {str(k).strip(): str(v).strip() for k, v in raw_options.items() if str(v).strip()}
    return {}


def _get_product_sku_base(cursor, product_id):
    """Get the base SKU for a product (global_sku_code or generated)."""
    row = cursor.execute("SELECT global_sku_code, name FROM products WHERE id = ?", (product_id,)).fetchone()
    if row:
        return row['global_sku_code'] or f"PRD{product_id}"
    return f"PRD{product_id}"


# ── JWT helpers ──────────────────────────────────────────────────────────────

def _get_jwt_secret():
    """Returns the JWT secret from the central fail-closed loader."""
    return get_jwt_secret()


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

        # 1. Try uploading to persistent cloud storage first (ImgBB -> Catbox ->
        #    Telegra.ph). Render's filesystem is ephemeral — local-only uploads
        #    are wiped on every redeploy and the stored /static/uploads/... URL
        #    then 404s for every visitor, which is why product images showed only
        #    the text fallback on the storefront. Cloud URLs survive restarts.
        try:
            from services.cloud_image_service import upload_file_object_to_cloud
            cloud_url = upload_file_object_to_cloud(file, filename)
            if cloud_url:
                current_app.logger.info(f"Warehouse product image uploaded to cloud: {cloud_url}")
                return success_response({"url": cloud_url}, "Image uploaded successfully", 201)
        except Exception as cloud_error:
            current_app.logger.warning(f"Cloud upload failed for product image, falling back to local: {cloud_error}")

        # 2. Fallback: save locally (dev / offline environments). The file stream
        #    is re-readable here because upload_file_object_to_cloud seeks back;
        #    reset explicitly so the fallback never writes from a bad offset.
        file.seek(0)
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
    """
    Decorator requiring a valid warehouse OWNER (partner) JWT token.
    Staff / billing-agent tokens are rejected here so they can never reach
    the partner data endpoints (dashboard, orders, inventory, analytics...).
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return error_response("Missing warehouse token", 401)
        
        token = auth.split(" ", 1)[1]
        try:
            payload = decode_warehouse_token(token)
            if payload.get("type") != "warehouse":
                return error_response("Staff accounts cannot access partner endpoints", 403)
        except jwt.ExpiredSignatureError:
            return error_response("Warehouse session expired", 401)
        except jwt.InvalidTokenError:
            return error_response("Invalid warehouse token", 401)
        except Exception:
            return error_response("Authentication failed", 401)
            
        request.warehouse_payload = payload
        return f(*args, **kwargs)
    return decorated


def require_warehouse_session_auth(f):
    """
    Decorator for endpoints a staff session legitimately needs (session sync),
    accepting both owner and staff tokens. Everything else stays owner-only.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return error_response("Missing warehouse token", 401)
        
        token = auth.split(" ", 1)[1]
        try:
            payload = decode_warehouse_token(token)
            if payload.get("type") not in ("warehouse", "warehouse_staff"):
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


def issue_staff_token(staff_id, vendor_id, email, name, role_name, permissions):
    """Generates a JWT token for a warehouse staff member."""
    payload = {
        "staff_id": staff_id,
        "vendor_id": vendor_id,
        "email": email,
        "name": name,
        "role_name": role_name,
        "permissions": permissions,
        "type": "warehouse_staff",
        "exp": datetime.datetime.utcnow() + datetime.timedelta(days=7),
    }
    return jwt.encode(payload, _get_jwt_secret(), algorithm="HS256")


def require_warehouse_staff_permission(permission):
    """Decorator to authorize warehouse staff or warehouse owner based on permission."""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            auth = request.headers.get("Authorization", "")
            if not auth.startswith("Bearer "):
                return error_response("Missing authorization token", 401)
            
            token = auth.split(" ", 1)[1]
            try:
                payload = decode_warehouse_token(token)
            except jwt.ExpiredSignatureError:
                return error_response("Session expired", 401)
            except Exception:
                return error_response("Invalid authentication token", 401)
                
            token_type = payload.get("type")
            
            # Warehouse Owner token (has full permissions)
            if token_type == "warehouse":
                request.vendor_id = payload.get("warehouse_id")
                request.staff_id = None
                request.warehouse_payload = payload
                return f(*args, **kwargs)
                
            # Warehouse Staff token
            elif token_type == "warehouse_staff":
                vendor_id = payload.get("vendor_id")
                staff_id = payload.get("staff_id")
                
                conn = get_db()
                try:
                    staff_row = conn.execute(
                        """
                        SELECT ws.staff_id, ws.vendor_id, ws.status, r.permissions
                        FROM warehouse_staff ws
                        JOIN roles r ON r.role_id = ws.role_id AND r.vendor_id = ws.vendor_id
                        WHERE ws.staff_id = ? AND ws.vendor_id = ?
                        """,
                        (staff_id, vendor_id)
                    ).fetchone()
                    
                    if not staff_row or staff_row["status"] != "active":
                        return error_response("Staff account is inactive or revoked", 403)
                        
                    perms_data = staff_row["permissions"] or "[]"
                    if isinstance(perms_data, str):
                        try:
                            perms = json.loads(perms_data)
                        except Exception:
                            perms = []
                    else:
                        perms = list(perms_data)
                        
                    if permission and permission not in perms:
                        return error_response("Access Denied: Missing required permission", 403)
                        
                    request.vendor_id = vendor_id
                    request.staff_id = staff_id
                    request.staff_permissions = perms
                    request.warehouse_payload = payload
                finally:
                    conn.close()
                    
                return f(*args, **kwargs)
            else:
                return error_response("Unauthorized token type", 403)
                
        return decorated
    return decorator


def require_warehouse_owner(f):
    """
    Restricts an endpoint to warehouse owner (partner) tokens only.
    Staff / billing-agent tokens are never allowed to manage roles, agents
    or other administrative resources — they only get their `billing` scope.
    """
    @wraps(f)
    @require_warehouse_auth
    def decorated(*args, **kwargs):
        if request.warehouse_payload.get("type") != "warehouse":
            return error_response(
                "Only warehouse owners can manage billing agents", 403
            )
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
        resp = jsonify({
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
                "profile_kyc_status": wh["profile_kyc_status"],
            },
        })
        cookie_settings = get_wh_cookie_settings()
        resp.set_cookie('token', jwt_token, **cookie_settings)
        return resp, 200
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
        "473832938691-oa46nvu19l6clb7fucu2u562clitbuah.apps.googleusercontent.com",
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
    oauth = current_app.config.get("PARTNER_OAUTH_CLIENT") or current_app.config["OAUTH_CLIENT"]

    # Keep the requested business flow in the Flask session and let Authlib
    # manage its own CSRF state token for the OAuth round-trip.
    session["partner_oauth_flow"] = flow
    print(f"DEBUG: Initiating partner OAuth with session flow: {flow}")
    return oauth.google_partner.authorize_redirect(redirect_uri)


@warehouse_bp.route("/partner/auth/google/callback")
def partner_auth_google_callback():
    """Handle server-side Google callback for partners."""
    oauth = current_app.config.get("PARTNER_OAUTH_CLIENT") or current_app.config["OAUTH_CLIENT"]
    
    # Redirection Origins
    admin_frontend = os.environ.get("ADMIN_FRONTEND_URL", "http://localhost:5174").rstrip("/")
    warehouse_frontend = os.environ.get("WAREHOUSE_FRONTEND_URL", "http://localhost:5175").rstrip("/")
    
    try:
        # Use Authlib for robust token exchange
        token_data = oauth.google_partner.authorize_access_token()
        user_info = token_data.get("userinfo") or oauth.google_partner.userinfo()
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
            role = normalize_role(role)
            
            # Accept any admin role (admin, super_admin + sub-roles) — consistent
            # with auth.role_guard.ADMIN_ROLES and the main admin login flow.
            if role not in ADMIN_ROLES:
                return redirect(f"{admin_frontend}/admin/login?error=not_authorized")
            
            # Disabled admins cannot log in via this flow either (same as main flow).
            if user:
                try:
                    st_row = conn.execute(
                        "SELECT status FROM admins WHERE user_id = ?", (user['id'],)
                    ).fetchone()
                    if st_row and str(st_row['status']).strip().lower() == 'disabled':
                        return redirect(f"{admin_frontend}/admin/login?error=account_disabled")
                except Exception:
                    pass  # never break login on status read failure
            
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
            cookie_settings = get_wh_cookie_settings()
            resp = redirect(f"{admin_frontend}/admin/dashboard")
            resp.set_cookie('token', jwt_token, **cookie_settings)
            return resp
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

            # Check if warehouse has google_id linked
            wh_google_id = wh['google_id'] if 'google_id' in wh.keys() else None
            google_id_val = user_info.get("sub") or user_info.get("id") or f"google_{wh['id']}"

            # Auto-link the verified Google account to the warehouse record if not set yet,
            # since Google OAuth has already verified ownership of this email address.
            if not wh_google_id or str(wh_google_id).startswith('warehouse_'):
                try:
                    cursor = conn.cursor()
                    cursor.execute("UPDATE warehouses SET google_id = ? WHERE id = ?", (google_id_val, wh['id']))
                    conn.commit()
                    # Re-fetch updated row
                    wh = conn.execute(
                        """SELECT w.*, ds.id AS store_id, ds.store_code
                           FROM warehouses w
                           LEFT JOIN dark_stores ds ON w.warehouse_name = ds.name
                           WHERE w.id = ?""", (wh['id'],)
                    ).fetchone()
                except Exception as update_err:
                    current_app.logger.warning(f"Failed to auto-link warehouse google_id: {update_err}")

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
                "profile_kyc_status": wh["profile_kyc_status"],
            }
            encoded_user = quote(json.dumps(user_obj))
            cookie_settings = get_wh_cookie_settings()
            # Redirect to the login page with the session in query params — the
            # warehouse frontend restores it from there (legacy oauth_token/
            # oauth_user handling in WarehouseLogin), since the partner panel is
            # Bearer-header based and can't read the HttpOnly cookie.
            resp = redirect(f"{warehouse_frontend}/warehouse/login?oauth_token={quote(jwt_token)}&oauth_user={encoded_user}")
            resp.set_cookie('token', jwt_token, **cookie_settings)
            return resp
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
        cookie_settings = get_wh_cookie_settings()
        resp = redirect(f"{warehouse_frontend}/warehouse/request")
        resp.set_cookie('token', request_token, **cookie_settings)
        return resp

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
            SELECT w.operations_status, w.weather_status, w.service_radius_km,
                   ds.active AS store_active, ds.pincode
            FROM warehouses w
            LEFT JOIN dark_stores ds ON w.warehouse_name = ds.name
            WHERE w.account_status = 'active'
            ORDER BY w.id ASC
            LIMIT 1
            """
        ).fetchone()

        # Query system settings
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM system_settings")
        all_settings = cursor.fetchall()
        settings = {row['key']: row['value'] for row in all_settings}

        if not wh:
            return jsonify({
                "ordering_enabled": False,
                "can_order": False,
                "message": "No active store found in your area.",
                "weather_status": "clear",
                "free_delivery_threshold": safe_float(settings.get('free_delivery_threshold'), 499),
                "free_delivery_enabled": settings.get('free_delivery_enabled', 'true').lower() == 'true',
                "platform_fee": safe_float(settings.get('platform_fee'), 7),
                "prepaid_delivery_charge": safe_float(settings.get('prepaid_delivery_charge'), 49),
                "cod_delivery_charge": safe_float(settings.get('cod_delivery_charge'), 99),
                "cod_advance_amount": max(0, safe_float(settings.get('cod_advance_amount'), 49)),
                "min_order_cod": safe_float(settings.get('min_order_cod'), 0),
                "cod_enabled": settings.get('cod_enabled', 'true').lower() == 'true',
                "cod_enabled_shiprocket": settings.get('cod_enabled_shiprocket', 'false').lower() == 'true',
                "prepaid_recommendation_enabled": settings.get('prepaid_recommendation_enabled', 'true').lower() == 'true',
                "priority_dispatch_enabled": settings.get('priority_dispatch_enabled', 'true').lower() == 'true',
                "cod_alert_text": settings.get('cod_alert_text', "Standard COD charges apply."),
            }), 200

        ops_status = (wh["operations_status"] or "closed").lower().strip()
        is_open = ops_status == "open"
        weather = (wh["weather_status"] or "clear").lower().strip()
        radius = wh["service_radius_km"] or 4.0

        # Build human-readable message
        if not is_open:
            msg = "Store is currently closed. Please check back later."
        elif weather == "bad_weather":
            msg = "Deliveries may be delayed due to bad weather."
        else:
            msg = "Standard delivery is available"

        # Count active products (global for now, or per-warehouse if needed)
        product_count = conn.execute("SELECT COUNT(*) FROM products WHERE stock > 0").fetchone()[0]

        data = {
            "ordering_enabled": is_open,
            "can_order": is_open,
            "operations_status": ops_status,
            "weather_status": weather,
            "service_radius_km": radius,
            "active_products": product_count,
            "message": msg,
            "success": True,
            "free_delivery_threshold": safe_float(settings.get('free_delivery_threshold'), 499),
            "free_delivery_enabled": settings.get('free_delivery_enabled', 'true').lower() == 'true',
            "platform_fee": safe_float(settings.get('platform_fee'), 7),
            "prepaid_delivery_charge": safe_float(settings.get('prepaid_delivery_charge'), 49),
            "cod_delivery_charge": safe_float(settings.get('cod_delivery_charge'), 99),
            "cod_advance_amount": max(0, safe_float(settings.get('cod_advance_amount'), 49)),
            "min_order_cod": safe_float(settings.get('min_order_cod'), 0),
            "cod_enabled": settings.get('cod_enabled', 'true').lower() == 'true',
            "cod_enabled_shiprocket": settings.get('cod_enabled_shiprocket', 'false').lower() == 'true',
            "prepaid_recommendation_enabled": settings.get('prepaid_recommendation_enabled', 'true').lower() == 'true',
            "priority_dispatch_enabled": settings.get('priority_dispatch_enabled', 'true').lower() == 'true',
            "cod_alert_text": settings.get('cod_alert_text', "Standard COD charges apply."),
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
@require_warehouse_session_auth
def warehouse_session():
    """Return current warehouse user/profile from DB.

    Warehouse owner tokens return the partner profile; staff / billing-agent
    tokens return the staff member's own profile (role_name + permissions) so
    the frontend never mistakes an agent for an owner.
    """
    payload = request.warehouse_payload
    wh_id = _get_current_warehouse_id()
    conn = get_db()
    try:
        # Staff / billing-agent session -> return their own profile
        if payload.get("type") == "warehouse_staff":
            staff = conn.execute(
                """
                SELECT ws.staff_id, ws.vendor_id, ws.name, ws.login_email, ws.status,
                       r.role_name, r.permissions
                FROM warehouse_staff ws
                LEFT JOIN roles r ON r.role_id = ws.role_id
                WHERE ws.staff_id = ? AND ws.vendor_id = ?
                """,
                (payload.get("staff_id"), wh_id)
            ).fetchone()
            if not staff or staff["status"] != "active":
                return error_response("Staff account is inactive or revoked", 403)
            perms_str = staff["permissions"] or "[]"
            try:
                perms = json.loads(perms_str) if isinstance(perms_str, str) else list(perms_str)
            except Exception:
                perms = []
            user_data = {
                "staff_id": staff["staff_id"],
                "vendor_id": staff["vendor_id"],
                "id": staff["staff_id"],
                "name": staff["name"],
                "email": staff["login_email"],
                "role_name": staff["role_name"] or "Billing Agent",
                "role": staff["role_name"] or "Billing Agent",
                "permissions": perms,
            }
            return jsonify({"user": user_data, "warehouse": user_data}), 200

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
    wh_id = _get_current_warehouse_id()
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
    wh_id = _get_current_warehouse_id()
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
    wh_id = _get_current_warehouse_id()
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
    wh_id = _get_current_warehouse_id()
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
               AND stock_quantity <= low_stock_threshold""",
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
                      o.order_status, o.cancellation_reason,
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
            "SELECT operations_status, weather_status FROM warehouses WHERE id = ?", 
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
                    "order_status": r["order_status"],
                    "cancellation_reason": r["cancellation_reason"],
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


@warehouse_bp.route("/api/warehouse/analytics", methods=["GET"])
@require_warehouse_auth
def warehouse_analytics():
    """Warehouse analytics for the partner dashboard charts."""
    wh_id = _get_current_warehouse_id()
    conn = get_db()
    try:
        status_rows = conn.execute(
            """
            SELECT assignment_status, COUNT(*) AS count
            FROM warehouse_order_assignments
            WHERE warehouse_id = ?
            GROUP BY assignment_status
            """,
            (wh_id,),
        ).fetchall()

        low_stock = conn.execute(
            """
            SELECT COUNT(*) AS n
            FROM warehouse_inventory
            WHERE warehouse_id = ?
              AND stock_quantity <= low_stock_threshold
            """,
            (wh_id,),
        ).fetchone()["n"]

        return jsonify({
            "status_breakdown": {
                row["assignment_status"]: row["count"]
                for row in status_rows
            },
            "low_stock_skus": low_stock,
        }), 200
    except Exception as e:
        current_app.logger.error(f"ERROR in warehouse_analytics: {str(e)}", exc_info=True)
        return error_response(str(e), 500)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/restock", methods=["GET"])
@require_warehouse_auth
def get_warehouse_restock_requests():
    """List all restock requests for this warehouse/store."""
    wh_id = _get_current_warehouse_id()
    
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
    wh_id = _get_current_warehouse_id()
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
    wh_id = _get_current_warehouse_id()
    conn = get_db()
    try:
        wh = conn.execute("SELECT warehouse_name FROM warehouses WHERE id = ?", (wh_id,)).fetchone()
        if not wh:
            return error_response("Warehouse not found", 404)
        ds = conn.execute("SELECT id, name FROM dark_stores WHERE name = ?", (wh["warehouse_name"],)).fetchone()
        if not ds:
            return error_response("No matching dark store found for this warehouse", 404)
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
    wh_id = _get_current_warehouse_id()
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
        if not wh:
            return error_response("Warehouse not found", 404)
        ds = conn.execute("SELECT id FROM dark_stores WHERE name = ?", (wh["warehouse_name"],)).fetchone()
        if not ds:
            return error_response("No matching dark store found for this warehouse", 404)
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
                "SELECT stock_quantity FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?", 
                (store_id, item['product_id'])
            ).fetchone()
            
            if inv:
                cursor.execute(
                    "UPDATE warehouse_inventory SET stock_quantity = stock_quantity + ? WHERE warehouse_id = ? AND product_id = ?",
                    (item['quantity'], store_id, item['product_id'])
                )
            else:
                cursor.execute(
                    "INSERT INTO warehouse_inventory (warehouse_id, product_id, stock_quantity) VALUES (?, ?, ?)",
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
    wh_id = _get_current_warehouse_id()
    status = request.args.get("status")
    limit = request.args.get("limit", 50, type=int)
    
    conn = get_db()
    try:
        query = """
            SELECT woa.id, woa.order_id, o.order_number, woa.assignment_status, woa.created_at,
                   o.total_amount, o.delivery_address, o.customer_phone as phone, o.delivery_type,
                   o.order_status, o.cancellation_reason,
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
    """List all inventory items for current warehouse.
    
    Now includes variant products (linked via variant_group_id) as separate items.
    """
    wh_id = request.warehouse_payload.get("warehouse_id")
    current_app.logger.info(f"Fetching inventory for warehouse_id: {wh_id}")
    
    if not wh_id:
        return error_response("Warehouse ID missing from token", 400)

    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT wi.id, COALESCE(p.name, wi.product_name) as product_name, 
                      COALESCE(wi.sku, CAST(p.id AS TEXT)) as sku, wi.stock_quantity, 
                      (COALESCE(wi.reserved_stock, 0) + COALESCE((SELECT SUM(quantity) FROM cart WHERE product_id = p.id), 0)) as reserved_stock,
                      COALESCE((SELECT SUM(quantity) FROM cart WHERE product_id = p.id AND user_id IS NOT NULL), 0) as user_reserved,
                      COALESCE((SELECT SUM(quantity) FROM cart WHERE product_id = p.id AND session_id IS NOT NULL AND user_id IS NULL), 0) as guest_reserved,
                      wi.low_stock_threshold, wi.bin_location,
                      wi.brand as local_brand, p.brand as global_brand,
                      wi.unit, wi.cost_price, 
                      COALESCE(NULLIF(wi.selling_price, 0), p.price, 0) as selling_price,
                      wi.mrp, wi.discount_pct, wi.discount_amt, wi.gst_pct,
                      p.price as global_price,
                      p.offline_price as offline_price,
                      wi.status,
                      wi.variant_id,
                      pv.name as variant_name, pv.options as variant_options, pv.price as variant_price,
                      p.has_variants,
                      p.variant_group_id, p.variant_name as product_variant_name, p.is_parent,
                      p.id as product_id, c.name as category, p.category_id, p.sub_category, p.images,
                      p.description, p.delivery_time, p.units_per_pack, p.material_type,
                      p.weight, p.dimensions, p.is_fragile, p.is_temp_sensitive,
                      p.is_perishable, p.expiry_date, p.is_featured,
                      p.return_policy,
                      p.recommendation_priority, p.recommendation_weight,
                      p.lifecycle_state,
                      c.return_policy as category_return_policy,
                      ROUND(COALESCE((SELECT AVG(rating) FROM product_reviews WHERE product_id = p.id), 0), 1) as average_rating
               FROM warehouse_inventory wi
               LEFT JOIN products p ON p.id = wi.product_id
               LEFT JOIN product_variants pv ON pv.id = wi.variant_id
               LEFT JOIN categories c ON p.category_id = c.id
               WHERE wi.warehouse_id = ?
               ORDER BY wi.id DESC""",
            (wh_id,),
        ).fetchall()
        # Parse variant option JSON for the UI (mirrors the storefront cart parsing).
        result = []
        for r in rows:
            r_dict = dict(r)
            if r_dict.get('variant_options'):
                try:
                    r_dict['variant_options'] = json.loads(r_dict['variant_options'])
                except Exception:
                    r_dict['variant_options'] = {}
            else:
                r_dict['variant_options'] = {}
            result.append(r_dict)
        current_app.logger.info(f"Inventory found: {len(result)} items for warehouse {wh_id}")
        return jsonify(result), 200
    except Exception as e:
        current_app.logger.error(f"Inventory fetch error: {str(e)}")
        return error_response(f"Failed to fetch inventory: {str(e)}", 500)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/inventory", methods=["POST"])
@require_warehouse_auth
def warehouse_add_inventory():
    """Add a product to warehouse inventory."""
    wh_id = _get_current_warehouse_id()
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
                SELECT COALESCE(SUM(stock_quantity), 0)
                FROM warehouse_inventory WHERE product_id = ?
            ) WHERE id = ?""",
            (product_id, product_id)
        )

        # Persist offline (POS) sale price when registering an existing
        # catalog product to this warehouse (mirrors the PATCH meta path).
        off_val = _normalize_offline_price(data.get('offline_price'))
        if off_val is not None or data.get('offline_price') not in (None, ''):
            conn.execute("UPDATE products SET offline_price = ? WHERE id = ?", (off_val, product_id))

        conn.commit()
        return success_response(None, "SKU added to inventory and synced with catalog", 201)
    finally:
        conn.close()




@warehouse_bp.route("/api/warehouse/products", methods=["POST"])
@require_warehouse_auth
def warehouse_create_product():
    """Create a new global product and automatically add it to this warehouse inventory.
    
    Supports variant linking: when has_variants is true and variants_data is provided,
    each variant becomes a separate product linked via variant_group_id.
    Parent product gets variant_group_id = its own id, variants get variant_group_id = parent_id.
    """
    data = request.json
    wh_id = _get_current_warehouse_id()
    
    name = data.get('name')
    price = data.get('price')
    # Optional separate price used by counter/offline (POS) billing.
    # When empty/None the POS falls back to the regular online price.
    offline_price = _normalize_offline_price(data.get('offline_price'))
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
    has_variants = data.get('has_variants', False)
    variants_data = data.get('variants', [])
    
    # Extract additional fields for description generation
    material_type = data.get('material_type')
    color = data.get('color')
    brand = data.get('brand')
    units_per_pack = data.get('units_per_pack')
    weight = data.get('weight')
    dimensions = data.get('dimensions')
    is_fragile = data.get('is_fragile', 0)
    is_temp_sensitive = data.get('is_temp_sensitive', 0)
    is_perishable = data.get('is_perishable', 0)
    is_featured = data.get('is_featured', 0)
    prepaid_only = data.get('prepaid_only', 0)
    return_policy = data.get('return_policy')
    usage_instructions = data.get('usage_instructions')
    expiry_date = data.get('expiry_date')
    sub_category = data.get('sub_category')
    
    # Generate professional description
    product_data_for_desc = {
        'description': description,
        'material_type': material_type,
        'color': color,
        'brand': brand,
        'units_per_pack': units_per_pack,
        'weight': weight,
        'dimensions': dimensions,
        'is_fragile': is_fragile,
        'is_temp_sensitive': is_temp_sensitive,
        'is_perishable': is_perishable,
        'is_featured': is_featured,
        'prepaid_only': prepaid_only,
        'return_policy': return_policy,
        'usage_instructions': usage_instructions,
        'name': name,
        'category': category,
    }
    generated_description = generate_product_description(product_data_for_desc)
    
    # Recommendation Controls
    rec_priority = data.get('recommendation_priority', 0)
    rec_weight = data.get('recommendation_weight', 1.0)
    recommendations = data.get('recommendations', {}) # { 'related': [id1, id2], ... }

    # Lifecycle State
    lifecycle_state = data.get('lifecycle_state', 'live')

    if not name or (price is None and not has_variants):
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

        # 1. Insert parent product with generated description
        share_token = generate_share_token()
        cursor.execute(
            """
            INSERT INTO products (
                name, description, sub_category, price, offline_price, category, category_id, images, 
                delivery_time, barcode, global_sku_code, brand, units_per_pack, material_type,
                color, weight, dimensions, is_fragile, is_temp_sensitive, is_perishable, expiry_date, 
                is_featured, has_variants, is_parent, variant_group_id, variant_name,
                recommendation_priority, recommendation_weight,
                lifecycle_state, share_token
            ) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name, generated_description, sub_category, price or 0, offline_price, category, category_id, images, 
                delivery_time, barcode, global_sku_code, brand, units_per_pack, material_type,
                color, weight, dimensions, is_fragile, is_temp_sensitive, is_perishable, expiry_date,
                is_featured, 1 if has_variants else 0, 1 if has_variants else 0,
                None, None,
                rec_priority, rec_weight, lifecycle_state, share_token
            )
        )
        product_id = cursor.lastrowid
        
        # Set variant_group_id to its own id for parent
        cursor.execute("UPDATE products SET variant_group_id = ? WHERE id = ?", (product_id, product_id))

        # Save Recommendations
        for rec_type, prod_ids in recommendations.items():
            if not isinstance(prod_ids, list): continue
            for r_id in prod_ids:
                cursor.execute(
                    "INSERT OR IGNORE INTO product_recommendations (product_id, recommended_product_id, recommendation_type) VALUES (?, ?, ?)",
                    (product_id, r_id, rec_type)
                )

        # Save Product Content
        content = data.get('content', {})
        if content:
            cursor.execute(
                """INSERT INTO product_content (
                    product_id, overview, highlights, specifications, compatibility,
                    box_contents, warranty_info, usage_instructions
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    product_id, 
                    content.get('overview'),
                    json.dumps(content.get('highlights', [])),
                    json.dumps(content.get('specifications', {})),
                    content.get('compatibility'),
                    content.get('box_contents'),
                    content.get('warranty_info'),
                    content.get('usage_instructions')
                )
            )

        # Save Badges
        badges = data.get('badges', [])
        if badges:
            for b in badges:
                cursor.execute(
                    """INSERT INTO product_badges (product_id, badge_type, priority, is_active)
                       VALUES (?, ?, ?, ?)""",
                    (product_id, b.get('type'), b.get('priority', 0), 1 if b.get('is_active', True) else 0)
                )

        # Save Fulfillment
        ful = data.get('fulfillment', {})
        if ful:
            cursor.execute(
                """INSERT INTO product_fulfillment (
                    product_id, package_weight, length, width, height, 
                    shipping_tier, dispatch_sla, is_cod_eligible, is_fragile, 
                    is_express_eligible, return_window
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    product_id, 
                    ful.get('package_weight', 0),
                    ful.get('length', 0),
                    ful.get('width', 0),
                    ful.get('height', 0),
                    ful.get('shipping_tier', 'standard'),
                    ful.get('dispatch_sla', 24),
                    1 if ful.get('is_cod_eligible', True) else 0,
                    1 if ful.get('is_fragile', False) else 0,
                    1 if ful.get('is_express_eligible', True) else 0,
                    ful.get('return_window', 7)
                )
            )

        # Save Discovery
        disco = data.get('discovery', {})
        if disco:
            cursor.execute(
                """INSERT INTO product_discovery (
                    product_id, meta_title, meta_description, 
                    search_keywords, product_tags, search_synonyms
                ) VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    product_id, 
                    disco.get('meta_title'),
                    disco.get('meta_description'),
                    json.dumps(disco.get('search_keywords', [])),
                    json.dumps(disco.get('product_tags', [])),
                    json.dumps(disco.get('search_synonyms', []))
                )
            )
        
        created_variants = []
        if has_variants and variants_data:
            # Persist option groups (e.g. Size -> [S, M, L]) so the storefront
            # can render a proper variant picker for this product.
            variant_options_data = data.get('variant_options') or []
            option_groups = []
            for idx, opt in enumerate(variant_options_data):
                opt_name = (opt.get('option_name') or '').strip()
                if not opt_name:
                    continue
                opt_values = opt.get('option_values') or []
                if isinstance(opt_values, str):
                    try:
                        opt_values = json.loads(opt_values)
                    except Exception:
                        opt_values = [opt_values]
                clean_values = [str(x).strip() for x in opt_values if str(x).strip()]
                cursor.execute(
                    "INSERT INTO product_variant_options (product_id, option_name, option_values, sort_order) VALUES (?, ?, ?, ?)",
                    (product_id, opt_name, json.dumps(clean_values), idx)
                )
                option_groups.append({'option_name': opt_name, 'option_values': clean_values})

            # Validate option groups for duplicate names
            seen_opt_names = set()
            for g in option_groups:
                if g['option_name'] in seen_opt_names:
                    return error_response(f"Duplicate option group name: {g['option_name']}", 400)
                seen_opt_names.add(g['option_name'])

            for v in variants_data:
                v_name = (v.get('name') or '').strip() or f"{name} - Variant"
                v_barcode = v.get('barcode', '').strip() or None
                v_price = v.get('price', price)
                v_mrp = v.get('mrp')
                v_stock = v.get('stock_quantity', 0)
                v_images = v.get('images', images)
                if isinstance(v_images, list):
                    v_images = json.dumps(v_images)
                v_offline_price = _normalize_offline_price(v.get('offline_price'))
                
                # Normalize and validate variant options
                v_options = _normalize_variant_options(v.get('options'))
                
                # Validate against option groups
                validation_errors = _validate_variant_options(cursor, product_id, v_options, option_groups)
                if validation_errors:
                    return error_response(f"Variant validation failed: {'; '.join(validation_errors)}", 400)
                
                # Check for duplicate variant combination (by options JSON)
                existing_vid = _check_duplicate_variant_combination(cursor, product_id, v_options)
                if existing_vid:
                    return error_response(f"Variant with this option combination already exists (variant_id: {existing_vid})", 409)
                
                # Generate SKU from options if not provided
                v_sku = v.get('sku')
                product_sku_base = _get_product_sku_base(cursor, product_id)
                if not v_sku:
                    v_sku = _generate_variant_sku(product_sku_base, v_options)
                if not v_sku:
                    v_sku = f"{product_sku_base}-{random.randint(10000, 99999)}"
                
                # Ensure SKU uniqueness
                while cursor.execute("SELECT id FROM products WHERE global_sku_code = ?", (v_sku,)).fetchone():
                    v_sku = f"{v_sku}-{random.randint(10, 99)}"

                # Generate unique share_token and seo_slug for variant
                v_share_token = generate_share_token()
                v_seo_slug = generate_seo_slug(f"{name}-{v_name}")
                
                # Insert variant as separate product linked via variant_group_id
                cursor.execute(
                    """INSERT INTO products 
                       (name, description, sub_category, price, offline_price, category, category_id, images, 
                        delivery_time, barcode, global_sku_code, brand, units_per_pack, material_type,
                        color, weight, dimensions, is_fragile, is_temp_sensitive, is_perishable, expiry_date, 
                        is_featured, has_variants, is_parent, variant_group_id, variant_name,
                        recommendation_priority, recommendation_weight,
                        lifecycle_state, share_token)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)""",
                    (
                        f"{name} - {v_name}", generated_description, sub_category, v_price, v_offline_price, 
                        category, category_id, v_images,
                        delivery_time, v_barcode, v_sku, brand, units_per_pack, material_type,
                        color, weight, dimensions, is_fragile, is_temp_sensitive, is_perishable, expiry_date,
                        is_featured, product_id, v_name,
                        rec_priority, rec_weight, lifecycle_state, v_share_token
                    )
                )
                variant_product_id = cursor.lastrowid
                
                # Add variant to warehouse_inventory (as separate product, no variant_id)
                cursor.execute(
                    """INSERT INTO warehouse_inventory 
                       (warehouse_id, product_id, product_name, sku, stock_quantity, available_stock,
                        low_stock_threshold, cost_price, selling_price, mrp, 
                        discount_pct, discount_amt, gst_pct, brand, unit)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        wh_id, variant_product_id, f"{name} - {v_name}", v_sku, v_stock, v_stock, 2, 
                        v.get('cost_price', 0), v_price,
                        v.get('mrp', 0.0), v.get('discount_pct', 0.0),
                        v.get('discount_amt', 0.0),
                        v.get('gst_pct'), data.get('brand'), data.get('unit', 'pcs')
                    )
                )
                
                created_variants.append({
                    "product_id": variant_product_id, 
                    "sku": v_sku, 
                    "options": v_options,
                    "name": v_name,
                    "price": v_price,
                    "stock": v_stock
                })

            # Sync parent stock (sum of all variant stocks in this warehouse)
            conn.execute(
                """UPDATE products SET stock = (
                    SELECT COALESCE(SUM(stock_quantity), 0)
                    FROM warehouse_inventory WHERE product_id IN (
                        SELECT id FROM products WHERE variant_group_id = ?
                    ) AND warehouse_id = ?
                ) WHERE id = ?""",
                (product_id, wh_id, product_id)
            )
            
            conn.commit()
            return success_response({"product_id": product_id, "variants": created_variants}, "Product and variants created", 201)
        
        else:
            # Original Single Product Logic
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
                    SELECT COALESCE(SUM(stock_quantity), 0)
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
    wh_id = _get_current_warehouse_id()
    data = request.get_json(silent=True) or {}
    
    allowed = {
        "stock_quantity", "low_stock_threshold", "bin_location", "sku", 
        "brand", "unit", "cost_price", "selling_price", "status",
        "mrp", "discount_pct", "discount_amt", "gst_pct", "is_featured"
    }
    updates = {k: v for k, v in data.items() if k in allowed}
    
    if not updates and "images" not in data and "description" not in data and "offline_price" not in data:
        return error_response("No valid fields to update", 400)

    conn = get_db()
    cursor = conn.cursor()
    try:
        inv = conn.execute("SELECT product_id, sku FROM warehouse_inventory WHERE id = ? AND warehouse_id = ?", (item_id, wh_id)).fetchone()
        if not inv:
            return error_response("Inventory item not found", 404)

        # SKU LOCK: Once an SKU has been assigned and saved, it cannot be changed
        # via the edit form. This prevents barcode/label mismatches and fraud.
        if 'sku' in updates and inv.get('sku') and updates['sku'] != inv['sku']:
            return error_response("SKU code is locked after creation and cannot be changed. Contact admin to modify.", 403)
            
        # Update product metadata (images, description, brand, etc) if provided
        product_meta_fields = [
            "name", "images", "description", "brand", "units_per_pack", "material_type", 
            "color", "category_id", "sub_category", "weight", "dimensions", "is_fragile", 
            "is_temp_sensitive", "is_perishable", "expiry_date", "is_featured",
            "recommendation_priority", "recommendation_weight", "lifecycle_state",
            "offline_price", "usage_instructions"
        ]
        meta_updates = []
        meta_values = []
        for field in product_meta_fields:
            if field in data:
                val = data[field]
                if field == "images" and isinstance(val, list):
                    val = json.dumps(val)
                if field == "offline_price":
                    val = _normalize_offline_price(val)
                meta_updates.append(f"{field} = ?")
                meta_values.append(val)
        
        if meta_updates:
            meta_values.append(inv["product_id"])
            conn.execute(f"UPDATE products SET {', '.join(meta_updates)} WHERE id = ?", meta_values)

        # Handle Recommendations if provided
        if "recommendations" in data:
            product_id = inv["product_id"]
            recommendations = data["recommendations"] # { 'related': [id1, id2], ... }
            
            # Simple approach: clear all and re-insert for provided types
            for rec_type, prod_ids in recommendations.items():
                if not isinstance(prod_ids, list): continue
                conn.execute("DELETE FROM product_recommendations WHERE product_id = ? AND recommendation_type = ?", (product_id, rec_type))
                for r_id in prod_ids:
                    conn.execute(
                        "INSERT OR IGNORE INTO product_recommendations (product_id, recommended_product_id, recommendation_type) VALUES (?, ?, ?)",
                        (product_id, r_id, rec_type)
                    )

        # Handle Product Content if provided
        if "content" in data:
            product_id = inv["product_id"]
            content = data["content"]
            
            # Upsert logic for SQLite
            conn.execute("DELETE FROM product_content WHERE product_id = ?", (product_id,))
            conn.execute(
                """INSERT INTO product_content (
                    product_id, overview, highlights, specifications, compatibility,
                    box_contents, warranty_info, usage_instructions
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    product_id, 
                    content.get('overview'),
                    json.dumps(content.get('highlights', [])),
                    json.dumps(content.get('specifications', {})),
                    content.get('compatibility'),
                    content.get('box_contents'),
                    content.get('warranty_info'),
                    content.get('usage_instructions')
                )
            )

        # Handle Badges if provided
        if "badges" in data:
            product_id = inv["product_id"]
            badges = data["badges"]
            conn.execute("DELETE FROM product_badges WHERE product_id = ?", (product_id,))
            for b in badges:
                conn.execute(
                    """INSERT INTO product_badges (product_id, badge_type, priority, is_active)
                       VALUES (?, ?, ?, ?)""",
                    (product_id, b.get('type'), b.get('priority', 0), 1 if b.get('is_active', True) else 0)
                )

        # Handle Fulfillment if provided
        if "fulfillment" in data:
            product_id = inv["product_id"]
            ful = data["fulfillment"]
            conn.execute("DELETE FROM product_fulfillment WHERE product_id = ?", (product_id,))
            conn.execute(
                """INSERT INTO product_fulfillment (
                    product_id, package_weight, length, width, height, 
                    shipping_tier, dispatch_sla, is_cod_eligible, is_fragile, 
                    is_express_eligible, return_window
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    product_id, 
                    ful.get('package_weight', 0),
                    ful.get('length', 0),
                    ful.get('width', 0),
                    ful.get('height', 0),
                    ful.get('shipping_tier', 'standard'),
                    ful.get('dispatch_sla', 24),
                    1 if ful.get('is_cod_eligible', True) else 0,
                    1 if ful.get('is_fragile', False) else 0,
                    1 if ful.get('is_express_eligible', True) else 0,
                    ful.get('return_window', 7)
                )
            )

        # Handle Discovery if provided
        if "discovery" in data:
            product_id = inv["product_id"]
            disco = data["discovery"]
            conn.execute("DELETE FROM product_discovery WHERE product_id = ?", (product_id,))
            conn.execute(
                """INSERT INTO product_discovery (
                    product_id, meta_title, meta_description, 
                    search_keywords, product_tags, search_synonyms
                ) VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    product_id, 
                    disco.get('meta_title'),
                    disco.get('meta_description'),
                    json.dumps(disco.get('search_keywords', [])),
                    json.dumps(disco.get('product_tags', [])),
                    json.dumps(disco.get('search_synonyms', []))
                )
            )

        # Handle Variants & Option Groups if provided (warehouse product editor).
        # Full-replace semantics matching the admin panel: existing variants keep
        # their id, removed rows are deleted, new rows are inserted. This only
        # runs when the client sends a full editor payload ("variants" key), so
        # minimal forms that merely toggle has_variants can never wipe data.
        if "variants" in data or "variant_options" in data:
            product_id = inv["product_id"]
            product_name_row = conn.execute("SELECT name FROM products WHERE id = ?", (product_id,)).fetchone()
            product_name = product_name_row["name"] if product_name_row else "Product"
            has_variants = bool(data.get("has_variants", True))
            if not has_variants:
                conn.execute("DELETE FROM product_variants WHERE product_id = ?", (product_id,))
                conn.execute("DELETE FROM product_variant_options WHERE product_id = ?", (product_id,))
                conn.execute("UPDATE products SET has_variants = 0, is_parent = 0 WHERE id = ?", (product_id,))
            else:
                # Sync option groups: delete + re-insert (ids not referenced elsewhere).
                conn.execute("DELETE FROM product_variant_options WHERE product_id = ?", (product_id,))
                variant_options_data = data.get("variant_options") or []
                option_groups = []
                for idx, opt in enumerate(variant_options_data):
                    opt_name = (opt.get("option_name") or "").strip()
                    if not opt_name:
                        continue
                    opt_values = opt.get("option_values") or []
                    if isinstance(opt_values, str):
                        try:
                            opt_values = json.loads(opt_values)
                        except Exception:
                            opt_values = [opt_values]
                    clean_values = [str(x).strip() for x in opt_values if str(x).strip()]
                    conn.execute(
                        "INSERT INTO product_variant_options (product_id, option_name, option_values, sort_order) VALUES (?, ?, ?, ?)",
                        (product_id, opt_name, json.dumps(clean_values), idx)
                    )
                    option_groups.append({'option_name': opt_name, 'option_values': clean_values})

                # Validate option groups for duplicate names
                seen_opt_names = set()
                for g in option_groups:
                    if g['option_name'] in seen_opt_names:
                        return error_response(f"Duplicate option group name: {g['option_name']}", 400)
                    seen_opt_names.add(g['option_name'])

                product_sku_base = _get_product_sku_base(cursor, product_id)

                if "variants" in data:
                    variants_data = data.get("variants") or []
                    existing_ids = set()
                    for v in variants_data:
                        v_id = v.get("id")
                        v_name = (v.get("name") or "").strip() or f"{product_name} - Variant"
                        v_sku = (v.get("sku") or "").strip() or None
                        v_barcode = (v.get("barcode") or "").strip() or None
                        v_price = v.get("price")
                        v_mrp = v.get("mrp")
                        v_stock = int(v.get("stock_quantity") if v.get("stock_quantity") is not None else v.get("stock") or 0)
                        v_images = v.get("images")
                        if isinstance(v_images, list):
                            v_images = json.dumps(v_images)
                        v_options = _normalize_variant_options(v.get("options"))

                        # Validate against option groups
                        validation_errors = _validate_variant_options(cursor, product_id, v_options, option_groups, exclude_variant_id=v_id if v_id and str(v_id).isdigit() else None)
                        if validation_errors:
                            return error_response(f"Variant validation failed: {'; '.join(validation_errors)}", 400)

                        # Check for duplicate variant combination (excluding self)
                        exclude_vid = int(v_id) if v_id and str(v_id).isdigit() else None
                        existing_vid = _check_duplicate_variant_combination(cursor, product_id, v_options, exclude_variant_id=exclude_vid)
                        if existing_vid:
                            return error_response(f"Variant with this option combination already exists (variant_id: {existing_vid})", 409)

                        if v_id and str(v_id).isdigit():
                            existing_ids.add(int(v_id))
                            set_parts = ["name = ?", "sku = ?", "price = ?", "barcode = ?", "options = ?", "mrp = ?"]
                            set_params = [v_name, v_sku, v_price, v_barcode, json.dumps(v_options), v_mrp]
                            if v_images:
                                set_parts.append("images = ?")
                                set_params.append(v_images)
                            set_params.extend([int(v_id), product_id])
                            conn.execute(
                                f"UPDATE product_variants SET {', '.join(set_parts)} WHERE id = ? AND product_id = ?",
                                set_params
                            )
                            # Keep THIS warehouse's inventory line (price/mrp/stock) in sync
                            # with the edited variant so the storefront sees the change.
                            line = conn.execute(
                                "SELECT id, reserved_stock FROM warehouse_inventory WHERE variant_id = ? AND warehouse_id = ?",
                                (int(v_id), wh_id)
                            ).fetchone()
                            if line:
                                new_avail = max(0, v_stock - (line["reserved_stock"] or 0))
                                conn.execute(
                                    "UPDATE warehouse_inventory SET selling_price = ?, mrp = ?, stock_quantity = ?, available_stock = ? WHERE id = ?",
                                    (v_price or 0, v_mrp or 0, v_stock, new_avail, line["id"])
                                )
                        else:
                            # Generate SKU from options if not provided
                            if not v_sku:
                                v_sku = _generate_variant_sku(product_sku_base, v_options)
                            if not v_sku:
                                v_sku = f"{product_sku_base}-{random.randint(10000, 99999)}"
                            
                            # Ensure SKU uniqueness
                            while cursor.execute("SELECT id FROM product_variants WHERE sku = ?", (v_sku,)).fetchone():
                                v_sku = f"{v_sku}-{random.randint(10, 99)}"

                            cur = conn.execute(
                                """INSERT INTO product_variants
                                   (product_id, name, sku, price, stock, barcode, images, options, mrp)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                                (product_id, v_name, v_sku, v_price, v_stock, v_barcode, v_images, json.dumps(v_options), v_mrp)
                            )
                            new_vid = cur.lastrowid
                            conn.execute(
                                """INSERT INTO warehouse_inventory
                                   (warehouse_id, warehouse_partner_id, product_id, variant_id, product_name, sku, stock_quantity, available_stock,
                                    low_stock_threshold, selling_price, mrp, status)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')""",
                                (wh_id, wh_id, product_id, new_vid, v_name, v_sku, v_stock, v_stock, 2, v_price or 0, v_mrp or 0)
                            )
                            conn.execute("UPDATE product_variants SET stock = ? WHERE id = ?", (v_stock, new_vid))

                    # Delete variants the client no longer sent (and this warehouse's lines).
                    for row in conn.execute("SELECT id FROM product_variants WHERE product_id = ?", (product_id,)).fetchall():
                        if row["id"] not in existing_ids:
                            conn.execute("DELETE FROM warehouse_inventory WHERE variant_id = ? AND warehouse_id = ?", (row["id"], wh_id))
                            conn.execute("DELETE FROM product_variants WHERE id = ?", (row["id"],))

                conn.execute("UPDATE products SET has_variants = 1, is_parent = 1 WHERE id = ?", (product_id,))
        elif "has_variants" in data:
            # Flag-only update from a minimal form — never touches variant rows.
            product_id = inv["product_id"]
            flag = 1 if data.get("has_variants") else 0
            conn.execute("UPDATE products SET has_variants = ?, is_parent = ? WHERE id = ?", (flag, flag, product_id))

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
                        SELECT COALESCE(SUM(stock_quantity), 0)
                        FROM warehouse_inventory WHERE product_id = ?
                    ) WHERE id = ?""",
                    (inv["product_id"], inv["product_id"])
                )

                # Sync variant stock if applicable
                inv_variant = conn.execute(
                    "SELECT variant_id FROM warehouse_inventory WHERE id = ?",
                    (item_id,)
                ).fetchone()
                if inv_variant and inv_variant["variant_id"]:
                    conn.execute(
                        """UPDATE product_variants SET stock = (
                            SELECT COALESCE(SUM(stock_quantity), 0)
                            FROM warehouse_inventory WHERE variant_id = ?
                        ) WHERE id = ?""",
                        (inv_variant["variant_id"], inv_variant["variant_id"])
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
    wh_id = _get_current_warehouse_id()
    conn = get_db()
    try:
        item = conn.execute(
            "SELECT product_id FROM warehouse_inventory WHERE id = ? AND warehouse_id = ?",
            (item_id, wh_id),
        ).fetchone()
        cursor = conn.execute(
            "DELETE FROM warehouse_inventory WHERE id = ? AND warehouse_id = ?",
            (item_id, wh_id),
        )
        if cursor.rowcount == 0:
            return error_response("Inventory item not found", 404)
        if item and item["product_id"]:
            conn.execute(
                """UPDATE products SET stock = (
                    SELECT COALESCE(SUM(stock_quantity), 0)
                    FROM warehouse_inventory WHERE product_id = ?
                ) WHERE id = ?""",
                (item["product_id"], item["product_id"])
            )
        conn.commit()
        return success_response(None, "SKU removed from inventory", 200)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/inventory/<int:item_id>/adjust", methods=["POST"])
@require_warehouse_auth
def warehouse_adjust_stock(item_id):
    """Adjust stock IN or OUT with reason and remark. Logs to stock_movements."""
    wh_id = _get_current_warehouse_id()
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
                    SELECT COALESCE(SUM(stock_quantity), 0)
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
    wh_id = _get_current_warehouse_id()
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
    wh_id = _get_current_warehouse_id()
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
        "accepted": "CONFIRMED",
        "packing": "PACKING",
        "packed": "PACKED",
        "dispatched": "SHIPPED",
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

        if new_status == "rejected":
            # Requirement 2: Release hard reservation if warehouse rejects the assignment
            conn.execute(
                """UPDATE warehouse_inventory 
                   SET reserved_stock = MAX(0, reserved_stock - (
                       SELECT quantity FROM order_items 
                       WHERE order_id = ? AND product_id = warehouse_inventory.product_id
                   )),
                       updated_at = CURRENT_TIMESTAMP
                   WHERE warehouse_id = ? AND product_id IN (
                       SELECT product_id FROM order_items WHERE order_id = ?
                   )""",
                (assignment["order_id"], wh_id, assignment["order_id"]),
            )

        mapped_order_status = order_status_map.get(new_status)
        if mapped_order_status == "CONFIRMED":
            conn.execute(
                """UPDATE orders
                   SET order_status = ?, confirmed_at = COALESCE(confirmed_at, CURRENT_TIMESTAMP)
                   WHERE id = ?""",
                (mapped_order_status, assignment["order_id"]),
            )
        elif mapped_order_status == "PACKED":
            conn.execute(
                """UPDATE orders
                   SET order_status = ?, packed_at = COALESCE(packed_at, CURRENT_TIMESTAMP)
                   WHERE id = ?""",
                (mapped_order_status, assignment["order_id"]),
            )
        elif mapped_order_status == "SHIPPED":
            conn.execute(
                """UPDATE orders
                   SET order_status = ?, shipped_at = COALESCE(shipped_at, CURRENT_TIMESTAMP)
                   WHERE id = ?""",
                (mapped_order_status, assignment["order_id"]),
            )
        elif mapped_order_status:
             conn.execute(
                """UPDATE orders
                   SET order_status = ?
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

    allowed = {"operations_status", "weather_status", "service_radius_km"}
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

        # Sync with dark_stores and warehouse_partners if operations_status was changed
        if "operations_status" in updates:
            # Find dark_store and warehouse_partner by name (as per current mapping)
            wh_info = conn.execute("SELECT warehouse_name, operations_status FROM warehouses WHERE id = ?", (wh_id,)).fetchone()
            if wh_info:
                new_op_status = wh_info["operations_status"]
                is_active = 1 if new_op_status == "open" else 0

                # Sync with dark_stores (used for Admin/Orders)
                conn.execute(
                    "UPDATE dark_stores SET active = ? WHERE name = ?",
                    (is_active, wh_info["warehouse_name"])
                )
                # Sync with warehouse_partners (used for Storefront Availability)
                conn.execute(
                    "UPDATE warehouse_partners SET operations_status = ?, updated_at = CURRENT_TIMESTAMP WHERE warehouse_name = ?",
                    (new_op_status, wh_info["warehouse_name"])
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
    """Raise 401/403 if request has no valid admin JWT.

    Delegates to auth.role_guard._current_user_claims so the enforcement stays
    identical to the rest of the admin panel: any admin role
    (super_admin/admin/manager/inventory_admin/delivery_admin/support_admin) is
    accepted, and disabled admin accounts are rejected even with a live JWT.
    """
    from auth.role_guard import _current_user_claims
    claims, error = _current_user_claims()
    if error:
        message, code = error
        abort(code)
    if claims.get("role") not in ADMIN_ROLES:
        abort(403)


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
        return jsonify(data), 200
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


# ── Staff Roles & Permissions API ──────────────────────────────────────────────

@warehouse_bp.route("/api/warehouse/roles", methods=["GET"])
@require_warehouse_owner
def get_warehouse_roles():
    """Returns roles defined for the authenticated warehouse vendor."""
    vendor_id = request.warehouse_payload.get("warehouse_id")
    conn = get_db()
    try:
        rows = conn.execute(
            """
            SELECT role_id, vendor_id, role_name, permissions, created_at
            FROM roles
            WHERE vendor_id = ?
            ORDER BY role_name ASC
            """,
            (vendor_id,)
        ).fetchall()
        
        result = []
        for r in rows:
            perms_str = r["permissions"] or "[]"
            try:
                perms = json.loads(perms_str) if isinstance(perms_str, str) else list(perms_str)
            except Exception:
                perms = []
            result.append({
                "role_id": r["role_id"],
                "vendor_id": r["vendor_id"],
                "role_name": r["role_name"],
                "permissions": perms,
                "created_at": r["created_at"]
            })
        return jsonify(result), 200
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/roles", methods=["POST"])
@require_warehouse_owner
def create_warehouse_role():
    """Creates or updates a staff role with permissions for a vendor."""
    data = request.get_json(silent=True) or {}
    role_name = data.get("role_name", "").strip()
    permissions = data.get("permissions", [])
    
    if not role_name:
        return error_response("Role name is required", 400)
        
    vendor_id = request.warehouse_payload.get("warehouse_id")
    perms_json = json.dumps(permissions if isinstance(permissions, list) else [])
    
    conn = get_db()
    try:
        cur = conn.cursor()
        existing = cur.execute(
            "SELECT role_id FROM roles WHERE vendor_id = ? AND LOWER(role_name) = LOWER(?)",
            (vendor_id, role_name)
        ).fetchone()
        
        if existing:
            cur.execute(
                "UPDATE roles SET permissions = ?, updated_at = CURRENT_TIMESTAMP WHERE role_id = ?",
                (perms_json, existing["role_id"])
            )
            role_id = existing["role_id"]
        else:
            cur.execute(
                "INSERT INTO roles (vendor_id, role_name, permissions) VALUES (?, ?, ?)",
                (vendor_id, role_name, perms_json)
            )
            role_id = cur.lastrowid
            
        conn.commit()
        return jsonify({
            "message": "Role saved successfully",
            "role_id": role_id,
            "role_name": role_name,
            "permissions": permissions
        }), 201
    finally:
        conn.close()


# ── Warehouse Staff / Agent Management ───────────────────────────────────────

@warehouse_bp.route("/api/warehouse/staff", methods=["GET"])
@require_warehouse_owner
def get_warehouse_staff():
    """Returns staff members created under the authenticated vendor."""
    vendor_id = request.warehouse_payload.get("warehouse_id")
    conn = get_db()
    try:
        rows = conn.execute(
            """
            SELECT ws.staff_id, ws.vendor_id, ws.role_id, ws.name, ws.login_email, ws.username, 
                   ws.status, ws.created_at, r.role_name, r.permissions,
                   (ws.setup_token IS NOT NULL AND ws.password_hash IS NULL) AS setup_pending
            FROM warehouse_staff ws
            LEFT JOIN roles r ON r.role_id = ws.role_id
            WHERE ws.vendor_id = ?
            ORDER BY ws.staff_id DESC
            """,
            (vendor_id,)
        ).fetchall()
        
        result = []
        for r in rows:
            perms_str = r["permissions"] or "[]"
            try:
                perms = json.loads(perms_str) if isinstance(perms_str, str) else list(perms_str)
            except Exception:
                perms = []
            result.append({
                "staff_id": r["staff_id"],
                "vendor_id": r["vendor_id"],
                "role_id": r["role_id"],
                "name": r["name"],
                "login_email": r["login_email"],
                "username": r["username"],
                "status": r["status"],
                "created_at": r["created_at"],
                "role_name": r["role_name"] or "Staff",
                "permissions": perms,
                "setup_pending": bool(r["setup_pending"])
            })
        return jsonify(result), 200
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/staff", methods=["POST"])
@require_warehouse_owner
def create_warehouse_staff():
    """
    Creates a staff member / agent for a warehouse.
    Sends an invitation email automatically with a setup link so the user can
    generate their password for the first time and log in to the billing app.
    """
    data = request.get_json(silent=True) or {}
    name = data.get("name", "").strip()
    login_email = data.get("login_email", "").strip().lower()
    role_id = data.get("role_id")
    
    if not name or not login_email or not role_id:
        return error_response("Name, login email, and role_id are required", 400)
        
    vendor_id = request.warehouse_payload.get("warehouse_id")
    
    conn = get_db()
    try:
        cur = conn.cursor()
        
        # Verify role belongs to this vendor
        role_row = cur.execute(
            "SELECT role_id, role_name, permissions FROM roles WHERE role_id = ? AND vendor_id = ?",
            (role_id, vendor_id)
        ).fetchone()
        if not role_row:
            return error_response("Invalid role for this warehouse", 400)
            
        # Verify email uniqueness for staff
        existing = cur.execute(
            "SELECT staff_id FROM warehouse_staff WHERE vendor_id = ? AND login_email = ?",
            (vendor_id, login_email)
        ).fetchone()
        if existing:
            return error_response("Staff member with this email already exists", 400)
            
        # Fetch warehouse details for email
        wh = cur.execute("SELECT warehouse_name FROM warehouses WHERE id = ?", (vendor_id,)).fetchone()
        warehouse_name = wh["warehouse_name"] if wh else "JDLX Warehouse"
        
        # Generate single-use setup token for password generation
        setup_token = uuid.uuid4().hex
        expires_at = (datetime.datetime.utcnow() + datetime.timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
        
        cur.execute(
            """
            INSERT INTO warehouse_staff (vendor_id, role_id, name, login_email, setup_token, setup_token_expires, status)
            VALUES (?, ?, ?, ?, ?, ?, 'active')
            """,
            (vendor_id, role_id, name, login_email, setup_token, expires_at)
        )
        staff_id = cur.lastrowid
        conn.commit()
        
        # Build front-end setup link
        frontend_url = os.environ.get("WAREHOUSE_FRONTEND_URL", "http://localhost:5175").rstrip("/")
        setup_link = f"{frontend_url}/warehouse/staff/setup?token={setup_token}"
        
        perms_str = role_row["permissions"] or "[]"
        try:
            perms = json.loads(perms_str) if isinstance(perms_str, str) else list(perms_str)
        except Exception:
            perms = []
            
        role_name = role_row["role_name"] or "Billing Agent"
        
        # Trigger email notification automatically in background thread
        Thread(
            target=send_staff_billing_setup_email,
            args=(login_email, name, warehouse_name, setup_link, role_name),
            daemon=True
        ).start()
        
        return jsonify({
            "message": f"Staff member '{name}' created successfully. Setup link sent to {login_email}.",
            "staff_id": staff_id,
            "login_email": login_email,
            "setup_link": setup_link
        }), 201
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/staff/setup-password", methods=["POST"])
def setup_staff_password():
    """
    First-time password generation for a staff member using their email setup token.
    """
    data = request.get_json(silent=True) or {}
    token = data.get("token", "").strip()
    password = data.get("password", "").strip()
    
    if not token or not password:
        return error_response("Token and password are required", 400)
        
    if len(password) < 6:
        return error_response("Password must be at least 6 characters long", 400)
        
    conn = get_db()
    try:
        cur = conn.cursor()
        staff = cur.execute(
            """
            SELECT ws.staff_id, ws.name, ws.login_email, ws.vendor_id, ws.setup_token_expires,
                   r.role_name, r.permissions
            FROM warehouse_staff ws
            LEFT JOIN roles r ON r.role_id = ws.role_id
            WHERE ws.setup_token = ?
            """,
            (token,)
        ).fetchone()
        
        if not staff:
            return error_response(
                "This setup link is no longer valid. Please use the most recent invite email "
                "from your Warehouse Manager, or ask them to resend the invite.",
                400,
            )

        # Enforce the 7-day setup link expiry
        expires_raw = staff["setup_token_expires"]
        if expires_raw:
            try:
                expires_dt = datetime.datetime.strptime(str(expires_raw), "%Y-%m-%d %H:%M:%S")
                if datetime.datetime.utcnow() > expires_dt:
                    return error_response("This setup link has expired. Ask your manager to resend the invite.", 400)
            except ValueError:
                pass

        password_hash = generate_password_hash(password)
        cur.execute(
            """
            UPDATE warehouse_staff
            SET password_hash = ?, setup_token = NULL, setup_token_expires = NULL, status = 'active', updated_at = CURRENT_TIMESTAMP
            WHERE staff_id = ?
            """,
            (password_hash, staff["staff_id"])
        )
        conn.commit()
        
        perms_str = staff["permissions"] or "[]"
        try:
            perms = json.loads(perms_str) if isinstance(perms_str, str) else list(perms_str)
        except Exception:
            perms = []
            
        jwt_token = issue_staff_token(
            staff_id=staff["staff_id"],
            vendor_id=staff["vendor_id"],
            email=staff["login_email"],
            name=staff["name"],
            role_name=staff["role_name"] or "Billing Agent",
            permissions=perms
        )
        
        return jsonify({
            "message": "Password generated successfully! Logging you in...",
            "token": jwt_token,
            "user": {
                "staff_id": staff["staff_id"],
                "vendor_id": staff["vendor_id"],
                "name": staff["name"],
                "email": staff["login_email"],
                "role_name": staff["role_name"] or "Billing Agent",
                "permissions": perms
            }
        }), 200
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/staff/login", methods=["POST"])
def staff_login():
    """
    Staff / Agent login endpoint using login_email & password.
    """
    data = request.get_json(silent=True) or {}
    email = data.get("email", "").strip().lower()
    password = data.get("password", "").strip()
    
    if not email or not password:
        return error_response("Email and password are required", 400)
        
    conn = get_db()
    try:
        cur = conn.cursor()
        staff = cur.execute(
            """
            SELECT ws.staff_id, ws.vendor_id, ws.name, ws.login_email, ws.password_hash, ws.status,
                   r.role_name, r.permissions
            FROM warehouse_staff ws
            JOIN roles r ON r.role_id = ws.role_id AND r.vendor_id = ws.vendor_id
            WHERE LOWER(ws.login_email) = ?
            """,
            (email,)
        ).fetchone()
        
        if not staff:
            return error_response("Invalid email or password", 401)
            
        if staff["status"] != "active":
            return error_response("Account is inactive or suspended", 403)
            
        if not staff["password_hash"] or not check_password_hash(staff["password_hash"], password):
            return error_response("Invalid email or password", 401)
            
        perms_str = staff["permissions"] or "[]"
        try:
            perms = json.loads(perms_str) if isinstance(perms_str, str) else list(perms_str)
        except Exception:
            perms = []
            
        jwt_token = issue_staff_token(
            staff_id=staff["staff_id"],
            vendor_id=staff["vendor_id"],
            email=staff["login_email"],
            name=staff["name"],
            role_name=staff["role_name"],
            permissions=perms
        )
        
        resp = jsonify({
            "user": {
                "staff_id": staff["staff_id"],
                "vendor_id": staff["vendor_id"],
                "name": staff["name"],
                "email": staff["login_email"],
                "role_name": staff["role_name"],
                "permissions": perms
            }
        })
        cookie_settings = get_wh_cookie_settings()
        resp.set_cookie('token', jwt_token, **cookie_settings)
        return resp, 200
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/auth/logout", methods=["POST"])
def warehouse_auth_logout():
    """Clears the HttpOnly auth cookie for warehouse sessions."""
    resp = jsonify({"success": True, "message": "Logged out successfully"})
    cookie_settings = get_wh_cookie_settings()
    resp.set_cookie('token', '', **cookie_settings, expires=0)
    return resp


@warehouse_bp.route("/api/warehouse/staff/<int:staff_id>", methods=["PATCH"])
@require_warehouse_owner
def update_warehouse_staff(staff_id):
    """
    Toggle a billing agent's status (active / inactive) for the current vendor.
    Deactivating immediately revokes their POS access (the permission guard
    re-checks status on every request).
    """
    data = request.get_json(silent=True) or {}
    status = (data.get("status") or "").strip().lower()
    if status not in ("active", "inactive"):
        return error_response("status must be 'active' or 'inactive'", 400)

    vendor_id = request.warehouse_payload.get("warehouse_id")
    conn = get_db()
    try:
        cur = conn.cursor()
        existing = cur.execute(
            "SELECT staff_id FROM warehouse_staff WHERE staff_id = ? AND vendor_id = ?",
            (staff_id, vendor_id)
        ).fetchone()
        if not existing:
            return error_response("Agent not found for this warehouse", 404)

        cur.execute(
            "UPDATE warehouse_staff SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE staff_id = ?",
            (status, staff_id)
        )
        conn.commit()
        return jsonify({
            "message": f"Agent {'reactivated' if status == 'active' else 'deactivated'} successfully",
            "staff_id": staff_id,
            "status": status
        }), 200
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/staff/<int:staff_id>", methods=["DELETE"])
@require_warehouse_owner
def delete_warehouse_staff(staff_id):
    """Delete a billing agent for the current vendor (permanent)."""
    vendor_id = request.warehouse_payload.get("warehouse_id")
    conn = get_db()
    try:
        cur = conn.cursor()
        existing = cur.execute(
            "SELECT staff_id FROM warehouse_staff WHERE staff_id = ? AND vendor_id = ?",
            (staff_id, vendor_id)
        ).fetchone()
        if not existing:
            return error_response("Agent not found for this warehouse", 404)

        cur.execute("DELETE FROM warehouse_staff WHERE staff_id = ?", (staff_id,))
        conn.commit()
        return jsonify({"message": "Agent deleted successfully", "staff_id": staff_id}), 200
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/staff/<int:staff_id>/resend-invite", methods=["POST"])
@require_warehouse_owner
def resend_staff_invite(staff_id):
    """
    Regenerates a fresh setup token for a billing agent and emails a new
    invite link (e.g. when the previous link expired or was lost).
    """
    vendor_id = request.warehouse_payload.get("warehouse_id")
    conn = get_db()
    try:
        cur = conn.cursor()
        staff = cur.execute(
            """
            SELECT ws.staff_id, ws.vendor_id, ws.name, ws.login_email, ws.status,
                   r.role_name
            FROM warehouse_staff ws
            LEFT JOIN roles r ON r.role_id = ws.role_id
            WHERE ws.staff_id = ? AND ws.vendor_id = ?
            """,
            (staff_id, vendor_id)
        ).fetchone()
        if not staff:
            return error_response("Agent not found for this warehouse", 404)

        setup_token = uuid.uuid4().hex
        expires_at = (datetime.datetime.utcnow() + datetime.timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
        cur.execute(
            "UPDATE warehouse_staff SET setup_token = ?, setup_token_expires = ?, updated_at = CURRENT_TIMESTAMP WHERE staff_id = ?",
            (setup_token, expires_at, staff_id)
        )
        conn.commit()

        wh = conn.execute("SELECT warehouse_name FROM warehouses WHERE id = ?", (vendor_id,)).fetchone()
        warehouse_name = wh["warehouse_name"] if wh else "JDLX Warehouse"

        frontend_url = os.environ.get("WAREHOUSE_FRONTEND_URL", "http://localhost:5175").rstrip("/")
        setup_link = f"{frontend_url}/warehouse/staff/setup?token={setup_token}"

        Thread(
            target=send_staff_billing_setup_email,
            args=(staff["login_email"], staff["name"], warehouse_name, setup_link, staff["role_name"] or "Billing Agent"),
            daemon=True
        ).start()

        return jsonify({
            "message": f"Fresh invite sent to {staff['login_email']}",
            "staff_id": staff_id,
            "setup_link": setup_link
        }), 200
    finally:
        conn.close()


def _first_product_image(images):
    """Returns the first image URL from a product's images JSON array string."""
    if not images:
        return None
    try:
        parsed = json.loads(images) if isinstance(images, str) else images
        if isinstance(parsed, list) and parsed:
            return str(parsed[0])
        if isinstance(parsed, str) and parsed.strip():
            return parsed.strip()
        return None
    except Exception:
        text = str(images).strip()
        if not text:
            return None
        return text.split(",")[0].strip()


# ── POS Billing API Endpoints ──────────────────────────────────────────────────


def _ensure_billing_schema(conn):
    """Ensures the extra columns used by the POS billing flows (returns,
    exchanges, cancellations, and stored invoice amounts) exist.

    Safe to call on every billing request — existing tables get the new
    columns, fresh ones already have them via init_db.
    """
    cur = conn.cursor()
    try:
        item_cols = [r[1] for r in cur.execute("PRAGMA table_info(order_items)").fetchall()]
        if "returned_qty" not in item_cols:
            cur.execute("ALTER TABLE order_items ADD COLUMN returned_qty INTEGER DEFAULT 0")
        for col, ddl in (
            ("damage_qty", "INTEGER DEFAULT 0"),
            ("damage_comment", "TEXT DEFAULT ''"),
            ("damage_image_url", "TEXT DEFAULT ''"),
        ):
            if col not in item_cols:
                cur.execute(f"ALTER TABLE order_items ADD COLUMN {col} {ddl}")
        order_cols = [r[1] for r in cur.execute("PRAGMA table_info(orders)").fetchall()]
        for col, ddl in (
            ("billing_status", "TEXT DEFAULT 'active'"),
            ("subtotal_amount", "REAL DEFAULT 0"),
            ("tax_amount", "REAL DEFAULT 0"),
            ("gst_rate", "REAL DEFAULT 0"),
            ("discount_amount", "REAL DEFAULT 0"),
        ):
            if col not in order_cols:
                cur.execute(f"ALTER TABLE orders ADD COLUMN {col} {ddl}")
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass


def _get_counter_user_id(cur):
    """Returns (creating if needed) the dedicated counter-sales system user."""
    counter_user = cur.execute(
        "SELECT id FROM users WHERE email = ?",
        ("counter@jdlx.internal",),
    ).fetchone()
    if counter_user:
        return counter_user["id"]
    cur.execute(
        "INSERT INTO users (google_id, name, email, role) VALUES (?, ?, ?, ?)",
        ("counter-sales", "Counter Sales", "counter@jdlx.internal", "user"),
    )
    return cur.lastrowid


def _validate_billing_items(cur, vendor_id, items):
    """Validates billing cart items against stock and DB prices.

    Returns (subtotal, validated_items). Raises ValueError on any problem.
    Counter/offline sales use the dedicated offline price when set, otherwise
    fall back to the regular online price.

    Items may carry an optional damage_qty (0..qty) plus optional
    damage_comment / damage_image_url. Damaged units are physically removed
    from stock (they still count against available stock) but are NEVER
    charged — the bill subtotal only covers (qty - damage_qty) units.
    """
    subtotal = 0.0
    validated = []
    for item in items:
        product_id = item.get("product_id") or item.get("id")
        variant_id = item.get("variant_id")
        try:
            qty = int(item.get("quantity") or item.get("qty") or 1)
        except (TypeError, ValueError):
            raise ValueError("Invalid quantity for product")
        if not product_id or qty <= 0:
            raise ValueError("Invalid product or quantity")

        try:
            damage_qty = int(item.get("damage_qty") or 0)
        except (TypeError, ValueError):
            damage_qty = 0
        if damage_qty < 0 or damage_qty > qty:
            raise ValueError("Damage quantity must be between 0 and item quantity")
        billed_qty = qty - damage_qty

        p_row = cur.execute(
            "SELECT id, name, price, offline_price, stock FROM products WHERE id = ?",
            (product_id,),
        ).fetchone()
        if not p_row:
            raise ValueError(f"Product #{product_id} not found")

        # Variant-aware: if a variant_id is provided, check variant stock/price.
        v_row = None
        if variant_id:
            v_row = cur.execute(
                "SELECT id, name, price, stock FROM product_variants WHERE id = ? AND product_id = ?",
                (variant_id, product_id),
            ).fetchone()
            if not v_row:
                raise ValueError(f"Variant #{variant_id} not found for product #{product_id}")

        # Check warehouse inventory (variant-aware if variant_id present).
        if variant_id:
            wi_row = cur.execute(
                "SELECT stock_quantity, available_stock FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ? AND variant_id = ?",
                (vendor_id, product_id, variant_id),
            ).fetchone()
        else:
            wi_row = cur.execute(
                "SELECT stock_quantity, available_stock FROM warehouse_inventory WHERE warehouse_id = ? AND product_id = ?",
                (vendor_id, product_id),
            ).fetchone()

        # available_stock may be NULL for some warehouses (the products
        # listing mirrors this with COALESCE) — never compare None < qty.
        if wi_row:
            avail_stock = wi_row["available_stock"]
            if avail_stock is None:
                avail_stock = wi_row["stock_quantity"]
            if avail_stock is None:
                avail_stock = (v_row["stock"] if v_row else p_row["stock"])
        else:
            avail_stock = (v_row["stock"] if v_row else p_row["stock"])
        if avail_stock < qty:
            display_name = (v_row["name"] if v_row else p_row["name"])
            raise ValueError(
                f"Insufficient stock for '{display_name}'. Available: {avail_stock}, Requested: {qty}"
            )

        # Price: variant price > offline price > base price
        if v_row and v_row["price"] is not None:
            item_price = float(v_row["price"])
        elif p_row["offline_price"]:
            item_price = float(p_row["offline_price"])
        else:
            item_price = float(p_row["price"])
        # Only the non-damaged units are charged. Damaged units still leave
        # stock (they're unusable) but contribute ₹0 to the bill.
        item_total = item_price * billed_qty
        subtotal += item_total
        validated.append({
            "product_id": product_id,
            "variant_id": variant_id,
            "name": (v_row["name"] if v_row else p_row["name"]),
            "qty": qty,          # total units taken from stock
            "billed_qty": billed_qty,
            "damage_qty": damage_qty,
            "damage_comment": (item.get("damage_comment") or "").strip(),
            "damage_image_url": (item.get("damage_image_url") or "").strip(),
            "price": item_price,
            "subtotal": item_total,
        })
    return subtotal, validated


def _insert_offline_order(cur, *, order_number, user_id, vendor_id, agent_id,
                          customer_name, customer_phone, payment_mode,
                          subtotal, tax_amount, gst_rate, discount_amount, total_amount):
    """Inserts an OFFLINE counter-sale order and returns its id."""
    cur.execute(
        """
        INSERT INTO orders (
            order_number, user_id, vendor_id, source, agent_id, customer_name, customer_phone,
            delivery_address, total_amount, subtotal_amount, tax_amount, gst_rate, discount_amount,
            order_status, payment_status, payment_type
        )
        VALUES (?, ?, ?, 'OFFLINE', ?, ?, ?, 'Store Counter Sale', ?, ?, ?, ?, ?, 'CONFIRMED', 'completed', ?)
        """,
        (order_number, user_id, vendor_id, agent_id, customer_name, customer_phone,
         total_amount, subtotal, tax_amount, gst_rate, discount_amount, payment_mode),
    )
    return cur.lastrowid


def _decrement_billing_stock(cur, vendor_id, product_id, qty, variant_id=None):
    """Atomically decrements global + warehouse inventory stock.

    When *variant_id* is provided, also decrements the variant row in
    product_variants and scopes the warehouse_inventory decrement to that
    specific variant.
    """
    if variant_id:
        cur.execute(
            "UPDATE product_variants SET stock = stock - ? WHERE id = ? AND product_id = ? AND stock >= ?",
            (qty, variant_id, product_id, qty),
        )
        # Always keep products.stock in sync (sum-of-variants source of truth).
        cur.execute(
            "UPDATE products SET stock = CASE WHEN stock >= ? THEN stock - ? ELSE 0 END WHERE id = ?",
            (qty, qty, product_id),
        )
        cur.execute(
            """
            UPDATE warehouse_inventory
            SET stock_quantity = CASE WHEN stock_quantity >= ? THEN stock_quantity - ? ELSE 0 END,
                available_stock = CASE WHEN COALESCE(available_stock, 0) >= ? THEN available_stock - ? ELSE 0 END
            WHERE warehouse_id = ? AND product_id = ? AND variant_id = ?
            """,
            (qty, qty, qty, qty, vendor_id, product_id, variant_id),
        )
    else:
        cur.execute(
            "UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?",
            (qty, product_id, qty),
        )
        cur.execute(
            """
            UPDATE warehouse_inventory
            SET stock_quantity = CASE WHEN stock_quantity >= ? THEN stock_quantity - ? ELSE 0 END,
                available_stock = CASE WHEN COALESCE(available_stock, 0) >= ? THEN available_stock - ? ELSE 0 END
            WHERE warehouse_id = ? AND product_id = ?
            """,
            (qty, qty, qty, qty, vendor_id, product_id),
        )


def _restock_billing_item(cur, vendor_id, product_id, qty, variant_id=None):
    """Restocks global + warehouse inventory after a return/cancel/exchange.

    When *variant_id* is provided, also restores the variant row in
    product_variants and scopes the warehouse_inventory restore to that
    specific variant.
    """
    if variant_id:
        cur.execute(
            "UPDATE product_variants SET stock = stock + ? WHERE id = ? AND product_id = ?",
            (qty, variant_id, product_id),
        )
    # Always restore products.stock too.
    cur.execute("UPDATE products SET stock = stock + ? WHERE id = ?", (qty, product_id))
    if variant_id:
        cur.execute(
            """
            UPDATE warehouse_inventory
            SET stock_quantity = COALESCE(stock_quantity, 0) + ?,
                available_stock = COALESCE(available_stock, 0) + ?
            WHERE warehouse_id = ? AND product_id = ? AND variant_id = ?
            """,
            (qty, qty, vendor_id, product_id, variant_id),
        )
    else:
        cur.execute(
            """
            UPDATE warehouse_inventory
            SET stock_quantity = COALESCE(stock_quantity, 0) + ?,
                available_stock = COALESCE(available_stock, 0) + ?
            WHERE warehouse_id = ? AND product_id = ?
            """,
            (qty, qty, vendor_id, product_id),
        )


# Counter-sale (offline POS) bills can only be returned / exchanged / cancelled
# within 24 hours of the sale. This is a POS-counter policy only — the online
# store's return policy is untouched.
BILLING_RETURN_WINDOW_HOURS = 24


def _billing_window_expired(order):
    """True if a counter-sale bill falls outside the 24h return window.

    ``created_at`` is stored in UTC ("YYYY-MM-DD HH:MM:SS"). If the timestamp
    can't be parsed (legacy/malformed) the check is skipped so bad data can
    never permanently lock a bill.
    """
    created = order["created_at"]
    if isinstance(created, str):
        try:
            created_dt = datetime.datetime.strptime(created, "%Y-%m-%d %H:%M:%S")
        except (TypeError, ValueError):
            return False
    elif isinstance(created, datetime.datetime):
        created_dt = created.replace(tzinfo=None)
    else:
        return False
    return datetime.datetime.utcnow() > created_dt + datetime.timedelta(hours=BILLING_RETURN_WINDOW_HOURS)


def _serialize_billing_product(r):
    """Serializes one billing-product row into the POS frontend shape.

    Counter/offline sales use the dedicated offline price when set; otherwise
    they fall back to the regular online price.
    """
    regular_price = float(r["price"] or 0)
    offline_price = r["offline_price"]
    try:
        effective_price = float(offline_price) if offline_price else regular_price
    except (TypeError, ValueError):
        effective_price = regular_price
    return {
        "id": r["id"],
        "name": r["name"],
        "price": effective_price,
        "offline_price": offline_price,
        "regular_price": regular_price,
        "image_url": _first_product_image(r["images"]),
        "category": r["category"] if "category" in r.keys() else "General",
        "stock": r["stock"]
    }


@warehouse_bp.route("/api/warehouse/billing/products", methods=["GET"])
@require_warehouse_staff_permission("billing")
def get_billing_products():
    """
    Returns inventory items available for billing for the authenticated vendor only.
    Guarded by billing permission.
    """
    vendor_id = request.vendor_id
    conn = get_db()
    try:
        # NOTE: the products table stores images as a JSON array string in
        # `images` (there is no `image_url` column), so pull the first image.
        rows = conn.execute(
            """
            SELECT p.id, p.name, p.price, p.offline_price, p.images, p.category, 
                   COALESCE(wi.available_stock, wi.stock_quantity, p.stock) AS stock
            FROM products p
            JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = ?
            WHERE COALESCE(wi.stock_quantity, 0) > 0 OR COALESCE(wi.available_stock, 0) > 0
            ORDER BY p.name ASC
            """,
            (vendor_id,)
        ).fetchall()

        result = [_serialize_billing_product(r) for r in rows]
        return jsonify(result), 200
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/billing/recent-products", methods=["GET"])
@require_warehouse_staff_permission("billing")
def get_billing_recent_products():
    """Returns products most recently sold at this counter (OFFLINE bills).

    Ordered most-recently-sold first so billing agents can instantly re-add
    the items their counter sells often. Only in-stock products appear, and
    cancelled bills are excluded. Limited to the last 20 distinct products so
    the payload stays tiny.
    """
    vendor_id = request.vendor_id
    conn = get_db()
    try:
        rows = conn.execute(
            """
            SELECT p.id, p.name, p.price, p.offline_price, p.images, p.category,
                   COALESCE(wi.available_stock, wi.stock_quantity, p.stock) AS stock,
                   MAX(o.created_at) AS last_sold_at
            FROM products p
            JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = ?
            JOIN orders o ON o.vendor_id = ? AND o.source = 'OFFLINE'
                AND COALESCE(o.order_status, '') != 'CANCELLED'
            JOIN order_items oi ON oi.order_id = o.id AND oi.product_id = p.id
            WHERE COALESCE(wi.stock_quantity, 0) > 0 OR COALESCE(wi.available_stock, 0) > 0
            GROUP BY p.id
            ORDER BY last_sold_at DESC
            LIMIT 20
            """,
            (vendor_id, vendor_id),
        ).fetchall()
        return jsonify([_serialize_billing_product(r) for r in rows]), 200
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/billing/generate", methods=["POST"])
@require_warehouse_staff_permission("billing")
def generate_billing_order():
    """
    Generates an offline billing receipt/order for counter sales.
    Guarded by billing permission.
    Atomically updates stock to prevent overselling.
    """
    data = request.get_json(silent=True) or {}
    items = data.get("items", [])
    customer_name = data.get("customer_name", "Counter Customer").strip()
    customer_phone = data.get("customer_phone", "").strip()
    payment_mode = data.get("payment_mode", "CASH").upper()
    discount_amount = max(0.0, float(data.get("discount_amount", 0)))
    # GST is opt-in per bill: default 0% (no GST). The POS frontend sends the
    # rate selected from its dropdown; clamp to a sane 0-100 range.
    try:
        gst_rate = max(0.0, min(100.0, float(data.get("gst_rate", 0) or 0)))
    except (TypeError, ValueError):
        gst_rate = 0.0
    
    if not items or not isinstance(items, list):
        return error_response("Items list is required for billing", 400)
        
    vendor_id = request.vendor_id
    agent_id = request.staff_id
    
    conn = get_db()
    try:
        _ensure_billing_schema(conn)
        cur = conn.cursor()
        cur.execute("BEGIN IMMEDIATE")

        # 1. Validate stock & calculate subtotal (shared with the exchange flow)
        try:
            subtotal, validated_items = _validate_billing_items(cur, vendor_id, items)
        except ValueError as e:
            conn.rollback()
            return error_response(str(e), 400)

        tax_amount = round(subtotal * gst_rate / 100, 2)
        total_amount = max(0.0, round(subtotal + tax_amount - discount_amount, 2))
        order_number = f"BILL-{int(time.time())}-{random.randint(1000, 9999)}"

        # 2. Insert offline order (counter sales are completed at the store, so
        #    delivery_address uses a placeholder counter address).
        user_id = _get_counter_user_id(cur)
        order_id = _insert_offline_order(
            cur,
            order_number=order_number,
            user_id=user_id,
            vendor_id=vendor_id,
            agent_id=agent_id,
            customer_name=customer_name,
            customer_phone=customer_phone,
            payment_mode=payment_mode,
            subtotal=round(subtotal, 2),
            tax_amount=tax_amount,
            gst_rate=gst_rate,
            discount_amount=discount_amount,
            total_amount=total_amount,
        )

        # 3. Insert order items & decrement inventory stock atomically.
        #    quantity stores the BILLED qty (damaged units are never charged);
        #    damage_qty/comment/image are kept alongside for records. Stock is
        #    decremented by the FULL qty — damaged units also leave inventory.
        for item in validated_items:
            cur.execute(
                """
                INSERT INTO order_items (order_id, product_id, product_name, variant_id, quantity, price, subtotal,
                                         damage_qty, damage_comment, damage_image_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (order_id, item["product_id"], item["name"], item.get("variant_id"), item["billed_qty"], item["price"], item["subtotal"],
                 item["damage_qty"], item["damage_comment"], item["damage_image_url"])
            )
            _decrement_billing_stock(cur, vendor_id, item["product_id"], item["qty"], item.get("variant_id"))

        conn.commit()

        # created_at is the DB's UTC timestamp (CURRENT_TIMESTAMP) — return that
        # so the invoice time matches what history shows (both parsed as UTC).
        created_at_row = cur.execute(
            "SELECT created_at FROM orders WHERE id = ?", (order_id,)
        ).fetchone()
        created_at = (
            created_at_row["created_at"]
            if created_at_row and created_at_row["created_at"]
            else datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        )

        return jsonify({
            "message": "Bill generated successfully!",
            "order_id": order_id,
            "order_number": order_number,
            "customer_name": customer_name,
            "customer_phone": customer_phone,
            "payment_mode": payment_mode,
            "subtotal": round(subtotal, 2),
            "tax_amount": tax_amount,
            "gst_rate": gst_rate,
            "discount_amount": discount_amount,
            "total_amount": total_amount,
            "items": validated_items,
            "created_at": created_at
        }), 201
    except Exception as exc:
        conn.rollback()
        return error_response(f"Failed to generate bill: {str(exc)}", 500)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/billing/damage-upload", methods=["POST"])
@require_warehouse_staff_permission("billing")
def upload_billing_damage_image():
    """Uploads an optional damage-proof image for a POS billing line item.

    Reuses the existing warehouse asset-save helper; returns the relative URL
    that gets stored on the order_item (damage_image_url) for the records.
    """
    if "file" not in request.files:
        return error_response("No file part", 400)
    file = request.files["file"]
    if file.filename == "":
        return error_response("No selected file", 400)
    try:
        url = _save_uploaded_asset(file, "damage")
        if not url:
            return error_response("File upload failed", 400)
        return success_response({"url": url}, "Damage image uploaded successfully", 201)
    except ValueError as e:
        return error_response(str(e), 400)
    except Exception as e:
        current_app.logger.error(f"Damage image upload failed: {str(e)}")
        return error_response(str(e), 500)


@warehouse_bp.route("/api/warehouse/billing/history", methods=["GET"])
@require_warehouse_staff_permission("billing")
def get_billing_history():
    """Lists this vendor's OFFLINE counter-sale bills with their items.

    Supports ?q= search (order number / customer) and ?limit= pagination.
    """
    vendor_id = request.vendor_id
    limit_raw = request.args.get("limit", "50")
    try:
        limit = max(1, min(int(limit_raw), 200))
    except (TypeError, ValueError):
        limit = 50
    search = (request.args.get("q") or "").strip()
    # Date range (UTC datetimes, e.g. "2026-08-09 00:00:00"; bare dates like
    # "2026-08-09" are also accepted and expanded to the full day) and an
    # optional payment-mode filter.
    date_from = (request.args.get("from") or "").strip()
    date_to = (request.args.get("to") or "").strip()
    payment = (request.args.get("payment") or "").strip().upper()

    conn = get_db()
    try:
        _ensure_billing_schema(conn)
        query = """
            SELECT id, order_number, customer_name, customer_phone, total_amount,
                   payment_type AS payment_mode, created_at, order_status, payment_status,
                   COALESCE(billing_status, 'active') AS billing_status,
                   COALESCE(gst_rate, 0) AS gst_rate,
                   COALESCE(discount_amount, 0) AS discount_amount,
                   COALESCE(subtotal_amount, 0) AS subtotal_amount,
                   COALESCE(tax_amount, 0) AS tax_amount
            FROM orders
            WHERE vendor_id = ? AND source = 'OFFLINE'
        """
        params = [vendor_id]
        if search:
            query += " AND (order_number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)"
            like = f"%{search}%"
            params += [like, like, like]
        if date_from:
            query += " AND created_at >= ?"
            params.append(date_from if len(date_from) > 10 else date_from + " 00:00:00")
        if date_to:
            query += " AND created_at <= ?"
            params.append(date_to if len(date_to) > 10 else date_to + " 23:59:59")
        if payment:
            query += " AND UPPER(payment_type) = ?"
            params.append(payment)
        query += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(query, params).fetchall()

        result = []
        for r in rows:
            items = conn.execute(
                """
                SELECT id, product_id, product_name, quantity, price, subtotal,
                       COALESCE(returned_qty, 0) AS returned_qty,
                       COALESCE(damage_qty, 0) AS damage_qty,
                       COALESCE(damage_comment, '') AS damage_comment,
                       COALESCE(damage_image_url, '') AS damage_image_url
                FROM order_items WHERE order_id = ?
                """,
                (r["id"],),
            ).fetchall()
            item_list = [dict(i) for i in items]
            # Legacy bills (created before stored amounts) fall back to the
            # sum of their line items.
            stored_subtotal = float(r["subtotal_amount"] or 0)
            subtotal = stored_subtotal if stored_subtotal > 0 else round(sum(float(i["subtotal"] or 0) for i in item_list), 2)
            stored_tax = float(r["tax_amount"] or 0)
            tax = stored_tax if stored_tax > 0 else round(max(0.0, float(r["total_amount"] or 0) - subtotal - float(r["discount_amount"] or 0)), 2)
            result.append({
                "id": r["id"],
                "order_number": r["order_number"],
                "customer_name": r["customer_name"] or "Counter Customer",
                "customer_phone": r["customer_phone"] or "",
                "total_amount": float(r["total_amount"] or 0),
                "payment_mode": r["payment_mode"] or "CASH",
                "created_at": r["created_at"],
                "order_status": r["order_status"],
                "payment_status": r["payment_status"],
                "billing_status": r["billing_status"] or "active",
                "gst_rate": float(r["gst_rate"] or 0),
                "discount_amount": float(r["discount_amount"] or 0),
                "subtotal": subtotal,
                "tax_amount": tax,
                "items": item_list,
            })
        return jsonify(result), 200
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/billing/return", methods=["POST"])
@require_warehouse_staff_permission("billing")
def return_billing_order():
    """Processes a return on a counter-sale bill: restocks returned quantities
    and updates the bill status (fully/partially returned)."""
    data = request.get_json(silent=True) or {}
    order_id = data.get("order_id")
    return_items = data.get("items", []) or []
    if not order_id or not isinstance(return_items, list) or not return_items:
        return error_response("order_id and items are required", 400)

    vendor_id = request.vendor_id
    conn = get_db()
    try:
        _ensure_billing_schema(conn)
        cur = conn.cursor()
        cur.execute("BEGIN IMMEDIATE")

        order = cur.execute(
            "SELECT * FROM orders WHERE id = ? AND vendor_id = ? AND source = 'OFFLINE'",
            (order_id, vendor_id),
        ).fetchone()
        if not order:
            conn.rollback()
            return error_response("Bill not found", 404)
        if order["order_status"] in ("CANCELLED", "EXCHANGED"):
            conn.rollback()
            return error_response("Cancelled or exchanged bills cannot be returned", 400)
        if _billing_window_expired(order):
            conn.rollback()
            return error_response(
                "Return window expired — counter-sale bills can only be returned within 24 hours of purchase", 400
            )

        refund_amount = 0.0
        for ri in return_items:
            item_id = ri.get("item_id") or ri.get("id")
            try:
                qty = int(ri.get("qty") or 0)
            except (TypeError, ValueError):
                qty = 0
            if qty <= 0:
                continue
            oi = cur.execute(
                "SELECT * FROM order_items WHERE id = ? AND order_id = ?",
                (item_id, order_id),
            ).fetchone()
            if not oi:
                conn.rollback()
                return error_response(f"Order item {item_id} not found", 404)
            already = int(oi["returned_qty"] or 0)
            if qty > (int(oi["quantity"]) - already):
                conn.rollback()
                return error_response(
                    f"Return qty exceeds purchased qty for '{oi['product_name']}'", 400
                )
            _restock_billing_item(cur, vendor_id, oi["product_id"], qty, oi["variant_id"])
            cur.execute(
                "UPDATE order_items SET returned_qty = COALESCE(returned_qty, 0) + ? WHERE id = ?",
                (qty, item_id),
            )
            refund_amount += float(oi["price"] or 0) * qty

        all_returned = all(
            int(r["rq"]) >= int(r["quantity"])
            for r in cur.execute(
                "SELECT quantity, COALESCE(returned_qty, 0) AS rq FROM order_items WHERE order_id = ?",
                (order_id,),
            ).fetchall()
        )
        if all_returned:
            cur.execute(
                "UPDATE orders SET order_status = 'RETURNED', payment_status = 'refunded', billing_status = 'returned' WHERE id = ?",
                (order_id,),
            )
        else:
            cur.execute(
                "UPDATE orders SET billing_status = 'partially_returned' WHERE id = ?",
                (order_id,),
            )
        conn.commit()
        return jsonify({
            "message": "Return processed",
            "refund_amount": round(refund_amount, 2),
            "billing_status": "returned" if all_returned else "partially_returned",
        }), 200
    except Exception as exc:
        conn.rollback()
        return error_response(f"Failed to process return: {str(exc)}", 500)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/billing/cancel", methods=["POST"])
@require_warehouse_staff_permission("billing")
def cancel_billing_order():
    """Cancels a counter-sale bill: restocks all remaining quantities and marks
    the bill cancelled/refunded."""
    data = request.get_json(silent=True) or {}
    order_id = data.get("order_id")
    if not order_id:
        return error_response("order_id is required", 400)

    vendor_id = request.vendor_id
    conn = get_db()
    try:
        _ensure_billing_schema(conn)
        cur = conn.cursor()
        cur.execute("BEGIN IMMEDIATE")

        order = cur.execute(
            "SELECT * FROM orders WHERE id = ? AND vendor_id = ? AND source = 'OFFLINE'",
            (order_id, vendor_id),
        ).fetchone()
        if not order:
            conn.rollback()
            return error_response("Bill not found", 404)
        if order["order_status"] in ("CANCELLED", "RETURNED", "EXCHANGED"):
            conn.rollback()
            return error_response(f"Bill is already {order['order_status'].lower()}", 400)
        if _billing_window_expired(order):
            conn.rollback()
            return error_response(
                "Cancellation window expired — counter-sale bills can only be cancelled within 24 hours of purchase", 400
            )

        items = cur.execute(
            "SELECT id, product_id, variant_id, quantity, price, COALESCE(returned_qty, 0) AS returned_qty FROM order_items WHERE order_id = ?",
            (order_id,),
        ).fetchall()
        refund_amount = 0.0
        for oi in items:
            remaining = int(oi["quantity"]) - int(oi["returned_qty"] or 0)
            if remaining <= 0:
                continue
            _restock_billing_item(cur, vendor_id, oi["product_id"], remaining, oi["variant_id"])
            cur.execute(
                "UPDATE order_items SET returned_qty = quantity WHERE id = ?",
                (oi["id"],),
            )
            refund_amount += float(oi["price"] or 0) * remaining

        cur.execute(
            "UPDATE orders SET order_status = 'CANCELLED', payment_status = 'refunded', billing_status = 'cancelled' WHERE id = ?",
            (order_id,),
        )
        conn.commit()
        return jsonify({
            "message": "Bill cancelled",
            "refund_amount": round(refund_amount, 2),
            "billing_status": "cancelled",
        }), 200
    except Exception as exc:
        conn.rollback()
        return error_response(f"Failed to cancel bill: {str(exc)}", 500)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/billing/exchange", methods=["POST"])
@require_warehouse_staff_permission("billing")
def exchange_billing_order():
    """Processes an exchange on a counter-sale bill: restocks the returned
    quantities and immediately creates a new replacement bill for the chosen
    items. Returns the price difference (positive = customer pays extra,
    negative = refund due)."""
    data = request.get_json(silent=True) or {}
    order_id = data.get("order_id")
    return_items = data.get("return_items", []) or []
    new_items = data.get("new_items", []) or []
    if not order_id or not isinstance(return_items, list) or not isinstance(new_items, list) or not return_items or not new_items:
        return error_response("order_id, return_items and new_items are required", 400)

    vendor_id = request.vendor_id
    agent_id = request.staff_id
    customer_name = (data.get("customer_name") or "Counter Customer").strip()
    customer_phone = (data.get("customer_phone") or "").strip()
    payment_mode = (data.get("payment_mode") or "CASH").upper()
    try:
        gst_rate = max(0.0, min(100.0, float(data.get("gst_rate", 0) or 0)))
    except (TypeError, ValueError):
        gst_rate = 0.0

    conn = get_db()
    try:
        _ensure_billing_schema(conn)
        cur = conn.cursor()
        cur.execute("BEGIN IMMEDIATE")

        order = cur.execute(
            "SELECT * FROM orders WHERE id = ? AND vendor_id = ? AND source = 'OFFLINE'",
            (order_id, vendor_id),
        ).fetchone()
        if not order:
            conn.rollback()
            return error_response("Bill not found", 404)
        if order["order_status"] in ("CANCELLED",):
            conn.rollback()
            return error_response("Cancelled bills cannot be exchanged", 400)
        if _billing_window_expired(order):
            conn.rollback()
            return error_response(
                "Exchange window expired — counter-sale bills can only be exchanged within 24 hours of purchase", 400
            )

        # 1. Process the returned quantities (restock)
        refund_value = 0.0
        for ri in return_items:
            item_id = ri.get("item_id") or ri.get("id")
            try:
                qty = int(ri.get("qty") or 0)
            except (TypeError, ValueError):
                qty = 0
            if qty <= 0:
                continue
            oi = cur.execute(
                "SELECT * FROM order_items WHERE id = ? AND order_id = ?",
                (item_id, order_id),
            ).fetchone()
            if not oi:
                conn.rollback()
                return error_response(f"Order item {item_id} not found", 404)
            already = int(oi["returned_qty"] or 0)
            if qty > (int(oi["quantity"]) - already):
                conn.rollback()
                return error_response(
                    f"Return qty exceeds purchased qty for '{oi['product_name']}'", 400
                )
            _restock_billing_item(cur, vendor_id, oi["product_id"], qty, oi["variant_id"])
            cur.execute(
                "UPDATE order_items SET returned_qty = COALESCE(returned_qty, 0) + ? WHERE id = ?",
                (qty, item_id),
            )
            refund_value += float(oi["price"] or 0) * qty

        # 2. Validate the replacement items (stock + prices)
        try:
            new_subtotal, new_validated = _validate_billing_items(cur, vendor_id, new_items)
        except ValueError as e:
            conn.rollback()
            return error_response(str(e), 400)
        new_tax = round(new_subtotal * gst_rate / 100, 2)
        new_total = max(0.0, round(new_subtotal + new_tax, 2))

        # 3. Create the replacement order
        order_number = f"BILL-{int(time.time())}-{random.randint(1000, 9999)}"
        user_id = _get_counter_user_id(cur)
        new_order_id = _insert_offline_order(
            cur,
            order_number=order_number,
            user_id=user_id,
            vendor_id=vendor_id,
            agent_id=agent_id,
            customer_name=customer_name,
            customer_phone=customer_phone,
            payment_mode=payment_mode,
            subtotal=round(new_subtotal, 2),
            tax_amount=new_tax,
            gst_rate=gst_rate,
            discount_amount=0.0,
            total_amount=new_total,
        )
        for item in new_validated:
            cur.execute(
                """
                INSERT INTO order_items (order_id, product_id, product_name, quantity, price, subtotal)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (new_order_id, item["product_id"], item["name"], item["qty"], item["price"], item["subtotal"]),
            )
            _decrement_billing_stock(cur, vendor_id, item["product_id"], item["qty"], item.get("variant_id"))

        # 4. Update original bill status
        all_returned = all(
            int(r["rq"]) >= int(r["quantity"])
            for r in cur.execute(
                "SELECT quantity, COALESCE(returned_qty, 0) AS rq FROM order_items WHERE order_id = ?",
                (order_id,),
            ).fetchall()
        )
        if all_returned:
            cur.execute(
                "UPDATE orders SET order_status = 'EXCHANGED', payment_status = 'refunded', billing_status = 'exchanged' WHERE id = ?",
                (order_id,),
            )
        else:
            cur.execute(
                "UPDATE orders SET billing_status = 'partially_exchanged' WHERE id = ?",
                (order_id,),
            )
        conn.commit()

        return jsonify({
            "message": "Exchange completed",
            "order_id": new_order_id,
            "order_number": order_number,
            "exchange_difference": round(new_total - refund_value, 2),
            "refund_value": round(refund_value, 2),
            "new_total": new_total,
        }), 200
    except Exception as exc:
        conn.rollback()
        return error_response(f"Failed to process exchange: {str(exc)}", 500)
    finally:
        conn.close()



# ==============================================================================
# OFFERS & PROMOTIONS (multi-vendor, warehouse-scoped)
# ==============================================================================
# Warehouse partners manage promotions for THEIR OWN products only. Every offer
# created here is stamped with the partner's warehouse_id; platform-wide offers
# (warehouse_id NULL) stay owned by the admin panel. Discount evaluation in
# offer_routes.calculate_discount only applies warehouse offers to carts that
# actually contain products stocked by that warehouse.

def _validate_warehouse_offer_targets(wh_id, applicable_on, applicable_ids):
    """Validates and cleans target ids for a warehouse offer.

    Partners may only attach their OWN inventory products (multi-vendor
    isolation); category targets must exist. Returns (cleaned_ids, error).
    """
    applicable_ids = [str(x) for x in (applicable_ids or [])]
    if applicable_on == 'product' and not applicable_ids:
        return [], "Select at least one product from your inventory"
    if applicable_on == 'category' and not applicable_ids:
        return [], "Select at least one category"
    if applicable_on not in ('product', 'category'):
        return [], None

    conn = get_db()
    try:
        placeholders = ','.join('?' * len(applicable_ids))
        if applicable_on == 'product':
            rows = conn.execute(
                f"SELECT product_id FROM warehouse_inventory "
                f"WHERE (warehouse_id = ? OR warehouse_partner_id = ?) "
                f"AND product_id IN ({placeholders})",
                [wh_id, wh_id] + applicable_ids
            ).fetchall()
            valid = {str(r['product_id']) for r in rows}
            cleaned = [x for x in applicable_ids if x in valid]
            if not cleaned:
                return [], "Select at least one product from your inventory"
            return cleaned, None
        rows = conn.execute(
            f"SELECT id FROM categories WHERE id IN ({placeholders})",
            applicable_ids
        ).fetchall()
        valid = {str(r['id']) for r in rows}
        cleaned = [x for x in applicable_ids if x in valid]
        if not cleaned:
            return [], "Select at least one valid category"
        return cleaned, None
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/offers", methods=["GET"])
@require_warehouse_auth
def warehouse_get_offers():
    """List all offers created by the current warehouse partner."""
    wh_id = request.warehouse_payload.get("warehouse_id")
    if not wh_id:
        return error_response("Warehouse ID missing from token", 400)
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM offers WHERE warehouse_id = ? ORDER BY created_at DESC",
            (wh_id,),
        ).fetchall()
        offers = [dict(r) for r in rows]
        for offer in offers:
            if offer.get('applicable_ids'):
                try:
                    offer['applicable_ids'] = json.loads(offer['applicable_ids'])
                except Exception:
                    offer['applicable_ids'] = []
        return success_response(offers, "Warehouse offers retrieved")
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/offers", methods=["POST"])
@require_warehouse_auth
def warehouse_create_offer():
    """Create an offer scoped to the current warehouse partner."""
    wh_id = request.warehouse_payload.get("warehouse_id")
    if not wh_id:
        return error_response("Warehouse ID missing from token", 400)
    data = request.get_json(silent=True) or {}

    title = (data.get("title") or "").strip()
    if not title:
        return error_response("Offer title is required", 400)
    offer_type = data.get("offer_type", "automatic")
    if offer_type not in ("coupon", "automatic", "seasonal", "daily"):
        offer_type = "automatic"
    discount_type = data.get("discount_type", "percentage")
    if discount_type not in ("percentage", "flat"):
        discount_type = "percentage"
    try:
        discount_value = float(data.get("discount_value", 0))
    except (TypeError, ValueError):
        discount_value = 0
    if discount_value <= 0:
        return error_response("Discount value must be greater than 0", 400)

    coupon_code = None
    if offer_type == "coupon":
        coupon_code = (data.get("coupon_code") or "").strip().upper()
        if not coupon_code:
            return error_response("coupon_code is required for coupon offers", 400)

    applicable_on = data.get("applicable_on", "all")
    if applicable_on not in ("all", "category", "product"):
        applicable_on = "all"
    # Category-wise offers stay admin-managed (multi-vendor: partners may only
    # target their own products or their whole store).
    if applicable_on == "category":
        return error_response("Category-wise offers are managed from the admin panel only", 400)
    applicable_ids, err = _validate_warehouse_offer_targets(wh_id, applicable_on, data.get("applicable_ids") or [])
    if err:
        return error_response(err, 400)
    applicable_ids_json = json.dumps([int(x) for x in applicable_ids]) if applicable_ids else None

    min_order = safe_float(data.get("min_order_amount"), 0)
    max_discount = safe_float(data.get("max_discount_amount"), 0) or None
    usage_limit = None
    try:
        if data.get("usage_limit") not in (None, ""):
            usage_limit = int(data.get("usage_limit"))
    except (TypeError, ValueError):
        usage_limit = None
    try:
        per_user_limit = int(data.get("per_user_limit") or 1)
    except (TypeError, ValueError):
        per_user_limit = 1

    conn = get_db()
    try:
        if coupon_code:
            existing = conn.execute("SELECT id FROM offers WHERE coupon_code = ?", (coupon_code,)).fetchone()
            if existing:
                return error_response("Coupon code already exists", 409)
        cursor = conn.execute(
            """INSERT INTO offers (
                title, description, offer_type, discount_type, discount_value,
                min_order_amount, max_discount_amount, target_type, applicable_on,
                applicable_ids, coupon_code, usage_limit, usage_count, per_user_limit,
                start_date, end_date, is_active, banner_image, warehouse_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'all', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)""",
            (
                title, data.get("description"), offer_type, discount_type, discount_value,
                min_order, max_discount, applicable_on,
                applicable_ids_json, coupon_code, usage_limit, per_user_limit,
                data.get("start_date"), data.get("end_date"),
                1 if data.get("is_active", True) else 0,
                data.get("banner_image"), wh_id,
            ),
        )
        conn.commit()
        return success_response({"id": cursor.lastrowid}, "Offer created successfully", 201)
    except Exception as e:
        conn.rollback()
        return error_response(str(e), 500)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/offers/<int:offer_id>", methods=["PUT"])
@require_warehouse_auth
def warehouse_update_offer(offer_id):
    """Update one of the current partner's own offers."""
    wh_id = request.warehouse_payload.get("warehouse_id")
    if not wh_id:
        return error_response("Warehouse ID missing from token", 400)
    data = request.get_json(silent=True) or {}

    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM offers WHERE id = ? AND warehouse_id = ?",
            (offer_id, wh_id),
        ).fetchone()
        if not row:
            return error_response("Offer not found", 404)
        existing = dict(row)

        # Category-wise offers are admin-managed. Existing category offers may
        # keep their scope (so status toggles/edits keep working), but partners
        # can never switch an offer to category scope.
        if data.get("applicable_on") == "category" and existing.get("applicable_on") != "category":
            return error_response("Category-wise offers are managed from the admin panel only", 400)

        title = (data.get("title") or "").strip() or existing["title"]
        offer_type = data.get("offer_type", existing["offer_type"])
        if offer_type not in ("coupon", "automatic", "seasonal", "daily"):
            offer_type = existing["offer_type"]
        discount_type = data.get("discount_type", existing["discount_type"])
        if discount_type not in ("percentage", "flat"):
            discount_type = existing["discount_type"]
        try:
            discount_value = float(data.get("discount_value", existing["discount_value"]))
        except (TypeError, ValueError):
            discount_value = existing["discount_value"]
        if discount_value <= 0:
            return error_response("Discount value must be greater than 0", 400)

        coupon_code = None
        if offer_type == "coupon":
            coupon_code = (data.get("coupon_code") or "").strip().upper() or (existing.get("coupon_code") or "").strip().upper()
            if not coupon_code:
                return error_response("coupon_code is required for coupon offers", 400)

        applicable_on = data.get("applicable_on", existing["applicable_on"]) or "all"
        if applicable_on not in ("all", "category", "product"):
            applicable_on = existing["applicable_on"]
        applicable_ids = data.get("applicable_ids")
        if applicable_ids is None:
            try:
                applicable_ids = json.loads(existing.get("applicable_ids") or "[]")
            except Exception:
                applicable_ids = []
        applicable_ids, err = _validate_warehouse_offer_targets(wh_id, applicable_on, applicable_ids)
        if err:
            return error_response(err, 400)
        applicable_ids_json = json.dumps([int(x) for x in applicable_ids]) if applicable_ids else None

        min_order = safe_float(data.get("min_order_amount"), existing["min_order_amount"] or 0)
        max_discount = safe_float(data.get("max_discount_amount"), existing.get("max_discount_amount") or 0) or None
        usage_limit = existing.get("usage_limit")
        try:
            if data.get("usage_limit") not in (None, ""):
                usage_limit = int(data.get("usage_limit"))
        except (TypeError, ValueError):
            usage_limit = existing.get("usage_limit")
        try:
            per_user_limit = int(data.get("per_user_limit") or existing.get("per_user_limit") or 1)
        except (TypeError, ValueError):
            per_user_limit = existing.get("per_user_limit") or 1

        if coupon_code and coupon_code != (existing.get("coupon_code") or "").strip().upper():
            dup = conn.execute("SELECT id FROM offers WHERE coupon_code = ? AND id != ?", (coupon_code, offer_id)).fetchone()
            if dup:
                return error_response("Coupon code already exists", 409)

        conn.execute(
            """UPDATE offers SET
                title = ?, description = ?, offer_type = ?, discount_type = ?, discount_value = ?,
                min_order_amount = ?, max_discount_amount = ?, applicable_on = ?,
                applicable_ids = ?, coupon_code = ?, usage_limit = ?, per_user_limit = ?,
                start_date = ?, end_date = ?, is_active = ?, banner_image = ?
            WHERE id = ? AND warehouse_id = ?""",
            (
                title, data.get("description"), offer_type, discount_type, discount_value,
                min_order, max_discount, applicable_on,
                applicable_ids_json, coupon_code, usage_limit, per_user_limit,
                data.get("start_date"), data.get("end_date"),
                1 if data.get("is_active", True) else 0,
                data.get("banner_image"), offer_id, wh_id,
            ),
        )
        conn.commit()
        return success_response(None, "Offer updated successfully")
    except Exception as e:
        conn.rollback()
        return error_response(str(e), 500)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/offers/<int:offer_id>", methods=["DELETE"])
@require_warehouse_auth
def warehouse_delete_offer(offer_id):
    """Delete one of the current partner's own offers."""
    wh_id = request.warehouse_payload.get("warehouse_id")
    if not wh_id:
        return error_response("Warehouse ID missing from token", 400)
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id FROM offers WHERE id = ? AND warehouse_id = ?",
            (offer_id, wh_id),
        ).fetchone()
        if not row:
            return error_response("Offer not found", 404)
        conn.execute("DELETE FROM offer_usage WHERE offer_id = ?", (offer_id,))
        conn.execute("DELETE FROM offers WHERE id = ?", (offer_id,))
        conn.commit()
        return success_response(None, "Offer deleted successfully")
    except Exception as e:
        conn.rollback()
        return error_response(str(e), 500)
    finally:
        conn.close()


@warehouse_bp.route("/api/warehouse/offers/products", methods=["GET"])
@require_warehouse_auth
def warehouse_offer_products():
    """List the current partner's inventory products for offer targeting."""
    wh_id = request.warehouse_payload.get("warehouse_id")
    if not wh_id:
        return error_response("Warehouse ID missing from token", 400)
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT p.id, p.name, p.price, p.category_id, COALESCE(c.name, p.category) as category, p.images
               FROM warehouse_inventory wi
               JOIN products p ON p.id = wi.product_id
               LEFT JOIN categories c ON p.category_id = c.id
               WHERE wi.warehouse_id = ?
                 AND p.status = 'available'
                 AND p.lifecycle_state IN ('live', 'coming_soon')
               GROUP BY p.id
               ORDER BY p.name ASC""",
            (wh_id,),
        ).fetchall()
        products = []
        for r in rows:
            item = dict(r)
            item["image"] = None
            if item.get("images"):
                try:
                    imgs = json.loads(item["images"])
                    if isinstance(imgs, list) and imgs:
                        item["image"] = imgs[0]
                except Exception:
                    item["image"] = None
            products.append(item)
        return success_response(products, "Warehouse products retrieved")
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()


# =============================================================================
# Vendor Earnings & Payouts (settlement engine — backend/settlement.py)
# Amazon-style model: customer pays the platform; after the return window the
# warehouse wallet is credited (product value - commission). Delivery fee and
# platform fees are platform revenue and never part of settlements.
# =============================================================================

@warehouse_bp.route("/api/warehouse/earnings", methods=["GET"])
@require_warehouse_session_auth
def warehouse_earnings():
    """Earnings dashboard for the current warehouse: wallet balance, lifetime
    earnings, pending settlements, payout history and recent settlements."""
    try:
        from settlement import get_commission_rate, get_settlement_window_days
        warehouse_id = _get_current_warehouse_id()
        if not warehouse_id:
            return error_response("Warehouse not identified", 401)
        conn = get_db()
        cursor = conn.cursor()
        commission_rate = get_commission_rate(conn=conn)
        window_days = get_settlement_window_days(conn=conn)
        cursor.execute(
            "INSERT OR IGNORE INTO vendor_wallets (warehouse_id, balance, lifetime_earnings) VALUES (?, 0, 0)",
            (warehouse_id,),
        )
        conn.commit()
        wallet = cursor.execute(
            "SELECT * FROM vendor_wallets WHERE warehouse_id = ?", (warehouse_id,)
        ).fetchone()
        pending = cursor.execute(
            "SELECT COALESCE(SUM(net_amount), 0) as amount, COUNT(*) as count "
            "FROM vendor_settlements WHERE warehouse_id = ? AND status = 'pending'",
            (warehouse_id,),
        ).fetchone()
        settled = cursor.execute(
            "SELECT COALESCE(SUM(net_amount), 0) as amount, COUNT(*) as count "
            "FROM vendor_settlements WHERE warehouse_id = ? AND status = 'settled'",
            (warehouse_id,),
        ).fetchone()
        payouts = cursor.execute(
            "SELECT * FROM vendor_payouts WHERE warehouse_id = ? ORDER BY created_at DESC LIMIT 10",
            (warehouse_id,),
        ).fetchall()
        recent = cursor.execute(
            """SELECT vs.*, o.order_number, o.order_status, o.created_at as order_created_at
               FROM vendor_settlements vs
               LEFT JOIN orders o ON o.id = vs.order_id
               WHERE vs.warehouse_id = ?
               ORDER BY vs.created_at DESC LIMIT 15""",
            (warehouse_id,),
        ).fetchall()
        conn.close()
        return success_response({
            "commission_rate": commission_rate,
            "settlement_window_days": window_days,
            "wallet": dict(wallet) if wallet else {"balance": 0, "lifetime_earnings": 0},
            "pending": {
                "amount": round(float(pending["amount"] or 0), 2),
                "count": int(pending["count"] or 0),
            },
            "settled": {
                "amount": round(float(settled["amount"] or 0), 2),
                "count": int(settled["count"] or 0),
            },
            "payouts": [dict(r) for r in payouts],
            "recent_settlements": [dict(r) for r in recent],
        }, "Earnings retrieved")
    except Exception as e:
        return error_response(str(e), 500)


@warehouse_bp.route("/api/warehouse/earnings/settlements", methods=["GET"])
@require_warehouse_session_auth
def warehouse_earnings_settlements():
    """Paginated settlement records for the current warehouse."""
    try:
        warehouse_id = _get_current_warehouse_id()
        if not warehouse_id:
            return error_response("Warehouse not identified", 401)
        status = request.args.get("status")
        page = max(request.args.get("page", type=int) or 1, 1)
        per_page = min(request.args.get("per_page", type=int) or 20, 100)
        offset = (page - 1) * per_page
        conn = get_db()
        cursor = conn.cursor()

        count_query = (
            "SELECT COUNT(*) as n FROM vendor_settlements vs WHERE vs.warehouse_id = ?"
        )
        params = [warehouse_id]
        if status:
            count_query += " AND vs.status = ?"
            params.append(status)
        total = cursor.execute(count_query, params).fetchone()["n"]

        query = (
            """SELECT vs.*, o.order_number, o.order_status, o.created_at as order_created_at
               FROM vendor_settlements vs
               LEFT JOIN orders o ON o.id = vs.order_id
               WHERE vs.warehouse_id = ?"""
        )
        query_params = [warehouse_id]
        if status:
            query += " AND vs.status = ?"
            query_params.append(status)
        query += " ORDER BY vs.created_at DESC LIMIT ? OFFSET ?"
        query_params += [per_page, offset]
        rows = cursor.execute(query, query_params).fetchall()
        conn.close()
        return success_response({
            "settlements": [dict(r) for r in rows],
            "total": int(total or 0),
            "page": page,
            "per_page": per_page,
        }, "Settlements retrieved")
    except Exception as e:
        return error_response(str(e), 500)


@warehouse_bp.route("/api/warehouse/earnings/payouts", methods=["GET"])
@require_warehouse_session_auth
def warehouse_earnings_payouts():
    """Payout (withdrawal) history for the current warehouse."""
    try:
        warehouse_id = _get_current_warehouse_id()
        if not warehouse_id:
            return error_response("Warehouse not identified", 401)
        conn = get_db()
        cursor = conn.cursor()
        rows = cursor.execute(
            "SELECT * FROM vendor_payouts WHERE warehouse_id = ? ORDER BY created_at DESC LIMIT 100",
            (warehouse_id,),
        ).fetchall()
        conn.close()
        return success_response([dict(r) for r in rows], "Payouts retrieved")
    except Exception as e:
        return error_response(str(e), 500)


@warehouse_bp.route("/api/warehouse/earnings/withdraw", methods=["POST"])
@require_warehouse_owner
def warehouse_earnings_withdraw():
    """Owner-only: requests a payout from the wallet balance (amount is held
    until the admin approves/rejects the request)."""
    try:
        from settlement import request_vendor_payout
        data = request.get_json(silent=True) or {}
        warehouse_id = _get_current_warehouse_id()
        if not warehouse_id:
            return error_response("Warehouse not identified", 401)
        try:
            amount = float(data.get("amount") or 0)
        except (TypeError, ValueError):
            return error_response("Invalid amount", 400)
        ok, message = request_vendor_payout(warehouse_id, amount)
        if not ok:
            return error_response(message, 400)
        return success_response(None, message)
    except Exception as e:
        return error_response(str(e), 500)
