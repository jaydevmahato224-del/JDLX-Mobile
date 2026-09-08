# ==============================================================================
# JDLX Mobile - Backend API
# ==============================================================================

# --- Standard Library Imports ---
import datetime
import gzip
import html
import hashlib
import hmac
import json
import math
import os
import secrets
import sqlite3
import time
import uuid
from functools import wraps
from urllib.parse import quote

# --- Environment Configuration ---
from dotenv import load_dotenv
from jwt_config import get_jwt_secret
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Load .env only in development; Render injects env vars directly in production.
if os.environ.get("RENDER") != "true":
    load_dotenv(os.path.join(BASE_DIR, ".env"))

# --- Third-Party Imports ---
import razorpay
import jwt
from flask import Flask, jsonify, request, send_file, redirect, session, url_for, send_from_directory
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_talisman import Talisman
from flask_caching import Cache
from authlib.integrations.flask_client import OAuth
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from werkzeug.utils import secure_filename
from apscheduler.schedulers.background import BackgroundScheduler
from PIL import Image

# --- Local Module Imports ---
from database import init_db, get_db as _database_get_db, USE_TURSO
from notifier import (
    send_order_email, 
    send_user_status_update_email, 
    send_individual_email, 
    send_bulk_notification_email,
    send_low_stock_catchy_email,
    send_review_thank_you_email,
    send_availability_subscription_confirmation,
    send_product_restock_alert,
    send_welcome_email
)
from services.inventory_service import trigger_low_stock_notifications as trigger_low_stock_notifications_svc
from auth.role_guard import normalize_role, require_admin, require_super_admin, ADMIN_ROLES
from auth.permission_guard import require_permission
from warehouse_routes import warehouse_bp, issue_warehouse_token, _normalize_offline_price
from delivery_routes import delivery_bp
from admin_db import admin_db_bp
from complaint_routes import complaint_bp
from support_routes import support_bp
from report_routes import report_bp
from refund_routes import refund_bp
from bug_routes import bug_bp
from issue_routes import issue_bp
from offer_routes import offer_bp, calculate_discount
from analytics_routes import analytics_bp
from app_review_routes import app_review_bp, check_and_trigger_review
from payment_routes import payment_bp
from shiprocket_routes import shiprocket_bp
from referral_wallet_routes import referral_wallet_bp
from services.system_monitor import get_system_stats
from delivery.warehouse_selector import select_best_warehouse
from delivery.location_service import update_rider_location, get_rider_location
from delivery.route_optimizer import calculate_shortest_route
from payments.payment_service import payment_service
from notifications.notification_service import notification_service
from utils.logger import logger
from utils.activity_logger import log_admin_action
from security.admin_audit_logger import log_admin_event
from services.shiprocket_service import ShiprocketService

from security.rate_limiter import check_and_record_request, get_blocked_ips
from security.login_guard import record_login_attempt, is_account_locked
from security.anomaly_detector import (
    create_security_alert,
    detect_failed_login_anomaly,
    detect_admin_activity_anomaly,
    get_security_overview,
)
from backup.backup_service import (
    create_full_backup,
    backup_database,
    list_backups,
)
from recovery.recovery_service import (
    restore_database,
    restore_files,
    verify_backup_integrity,
)
from utils.response_utils import success_response, error_response, safe_float
from utils.product_optimizer import optimizer
from utils.product_url_utils import (
    generate_share_token, 
    generate_seo_slug, 
    generate_product_url,
    repair_product_data,
    generate_product_description
)
from services.health_monitor import get_system_health_metrics
from services.auto_healer import trigger_system_scan

# ==============================================================================
# APP INITIALIZATION & CONFIGURATION
# ==============================================================================

from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

# --- Razorpay Configuration ---
razorpay_client = razorpay.Client(
    auth=(
        os.environ.get('RAZORPAY_KEY_ID'),
        os.environ.get('RAZORPAY_KEY_SECRET')
    )
)

# --- CORS Configuration ---
# Enable CORS for Store/Admin/Warehouse frontends.
# Notes:
# - Android emulator can't reach host via `localhost` (uses `10.0.2.2`).
# - Vite dev servers are often accessed via LAN IP (e.g. `192.168.x.x`).
cors_origins_env = os.environ.get("CORS_ORIGINS", "").strip()
cors_origins = [
    r"^http://localhost:517[3-5]$",
    r"^http://127\.0\.0\.1:517[3-5]$",
    r"^http://10\.0\.2\.2:517[3-5]$",
    r"^https?://(www\.)?jdlxmobile\.in$",
    r"^https?://.*\.jdlxmobile\.in$",
    r"^https?://.*\.vercel\.app$",
    r"^https?://.*\.onrender\.com$",
]
if cors_origins_env:
    extra_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
    cors_origins.extend(extra_origins)

CORS(
    app,
    resources={r"/api/.*": {
        "origins": cors_origins,
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        "allow_headers": ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"],
        "expose_headers": ["Content-Type", "Authorization"]
    }},
    supports_credentials=True,
)

# ==============================================================================
# HELPERS & UTILITIES
# ==============================================================================

def sync_to_shiprocket(order_data, cursor):
    """Syncs an order with Shiprocket if credentials are set."""
    cursor.execute("SELECT key, value FROM system_settings WHERE key LIKE 'shiprocket_%'")
    settings = {row['key']: row['value'] for row in cursor.fetchall()}
    
    if not settings.get('shiprocket_email') or not settings.get('shiprocket_password'):
        return None
        
    sr = ShiprocketService(
        settings['shiprocket_email'], 
        settings['shiprocket_password'],
        settings.get('shiprocket_pickup_location', 'Primary')
    )
    
    return sr.create_order(order_data)

# M1 fix: whitelist of valid Shiprocket-driven order status transitions.
SHIPROCKET_ALLOWED_TRANSITIONS = {
    'SHIPPED': {'PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED'},
    'DELIVERED': {'PLACED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY'},
}

@app.route('/api/webhook/shiprocket', methods=['POST'])
def shiprocket_webhook():
    """Handles status updates from Shiprocket."""
    # 1. Verify token (Authenticity Check) - M1 fix: token is MANDATORY and the
    #    endpoint fails closed when it is not configured.
    token = request.headers.get('x-api-key') or request.headers.get('X-Api-Key') or request.headers.get('Authorization')
    if token and token.startswith('Bearer '):
        token = token[7:]
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM system_settings WHERE key = 'shiprocket_token'")
    row = cursor.fetchone()
    expected_token = (row['value'] if row and row['value'] else None) or os.environ.get('SHIPROCKET_WEBHOOK_TOKEN')
    
    if not expected_token:
        logger.error("Shiprocket webhook token is not configured - rejecting webhook request")
        conn.close()
        return error_response("Webhook token not configured", 503)
    
    if not token or not hmac.compare_digest(token, expected_token):
        conn.close()
        return error_response("Unauthorized webhook request", 401)

    data = request.json
    if not data:
        conn.close()
        return error_response("Invalid payload", 400)

    # Log the incoming webhook for debugging
    logger.info(f"Shiprocket Webhook received: {json.dumps(data)}")

    event = data.get('current_status')
    awb_number = data.get('awb')
    sr_order_id = data.get('order_id')

    if not sr_order_id:
        return error_response("Missing Shiprocket Order ID", 400)

    # Map Shiprocket statuses to JDLX statuses
    # Shiprocket statuses: 'shipment_tracked', 'delivered', 'shipped', etc.
    new_jdlx_status = None
    timestamp_col = None

    if event in ['shipped', 'shipment_tracked']:
        new_jdlx_status = 'SHIPPED'
        timestamp_col = 'shipped_at'
    elif event == 'delivered':
        new_jdlx_status = 'DELIVERED'
        timestamp_col = 'delivered_at'

    if new_jdlx_status:
        try:
            # Update order based on shiprocket_order_id
            cursor.execute("SELECT id, user_id, total_amount, order_status FROM orders WHERE shiprocket_order_id = ?", (sr_order_id,))
            order = cursor.fetchone()
            
            if order:
                order_id = order['id']
                user_id = order['user_id']
                order_amount = order['total_amount']
                current_status = order['order_status'] or 'PLACED'
                
                # M1 fix: validate status transitions - no backwards jumps and no
                # updates to terminal (cancelled/refunded/delivered) orders.
                if current_status == new_jdlx_status:
                    conn.commit()
                    return success_response({"status": "already_up_to_date", "order_id": order_id})
                if current_status in ('CANCELLED', 'REFUNDED'):
                    logger.warning(f"Rejecting Shiprocket webhook for order #{order_id}: order is {current_status}, cannot move to {new_jdlx_status}")
                    conn.commit()
                    return success_response({"status": "ignored", "reason": f"order already {current_status}"})
                allowed_from = SHIPROCKET_ALLOWED_TRANSITIONS.get(new_jdlx_status, set())
                if current_status not in allowed_from:
                    logger.warning(f"Rejecting Shiprocket webhook for order #{order_id}: invalid transition {current_status} -> {new_jdlx_status}")
                    conn.commit()
                    return success_response({"status": "ignored", "reason": f"invalid transition {current_status} -> {new_jdlx_status}"})
                
                # Update status and timestamp
                cursor.execute(f"UPDATE orders SET order_status = ?, {timestamp_col} = CURRENT_TIMESTAMP WHERE id = ?", (new_jdlx_status, order_id))
                
                # Notify user
                notification_service.send_order_notification(user_id, order_id, new_jdlx_status)
                
                if new_jdlx_status == 'DELIVERED':
                    # Check if user should be prompted for review
                    check_and_trigger_review(cursor, user_id)
                    # Log activity
                    log_admin_action(0, "order_delivered_via_shiprocket", "order", order_id)

                    # Referral reward check (additive)
                    try:
                        from utils.referral import process_referral_reward
                        process_referral_reward(order_id, user_id, order_amount)
                    except Exception:
                        pass  # never break order flow

                conn.commit()
                return success_response({"status": "updated", "order_id": order_id})
            else:
                return error_response("Order not found in JDLX system", 404)
        except Exception as e:
            logger.error(f"Shiprocket Webhook processing error: {str(e)}")
            return error_response(str(e), 500)
    
    return success_response({"status": "ignored", "reason": f"Event {event} not handled"})

# --- Blueprint Registration ---
app.register_blueprint(warehouse_bp)
app.register_blueprint(delivery_bp)
app.register_blueprint(admin_db_bp)
app.register_blueprint(complaint_bp)
app.register_blueprint(support_bp)
app.register_blueprint(report_bp)
app.register_blueprint(refund_bp)
app.register_blueprint(bug_bp)
app.register_blueprint(issue_bp)
app.register_blueprint(offer_bp)
app.register_blueprint(analytics_bp)
app.register_blueprint(app_review_bp)
app.register_blueprint(payment_bp)
app.register_blueprint(shiprocket_bp)
app.register_blueprint(referral_wallet_bp)


# ==============================================================================
# HELPER FUNCTIONS
# ==============================================================================

def get_db():
    """Returns a connection to the database (Turso in production, local sqlite3 in dev)."""
    return _database_get_db()
def get_client_ip():
    """Extracts the client's IP address, accounting for proxy headers."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"


def normalize_product_row(row):
    """Standardizes product data structure and handles stock field naming variations."""
    product = dict(row)
    stock_val = product.get('stock')
    if stock_val is None and 'stock_quantity' in product:
        stock_val = product.get('stock_quantity', 0)
    try:
        product['stock'] = int(stock_val) if stock_val is not None else 0
    except (TypeError, ValueError):
        product['stock'] = 0
    if 'stock_quantity' in product:
        product.pop('stock_quantity')
    
    product['has_variants'] = bool(product.get('has_variants', 0))
    product['lifecycle_state'] = product.get('lifecycle_state', 'live')
    # Offline (POS counter-sale) pricing is warehouse-internal and must never
    # be exposed on the online store.
    product.pop('offline_price', None)
    return product


def is_sticker_category(product_row):
    category_name = (product_row.get('category_name') or product_row.get('category') or '').strip().lower()
    customization_enabled = int(product_row.get('device_customization_enabled') or 0) == 1
    return category_name == 'sticker' or customization_enabled


def allowed_file(filename):
    """Checks if a filename has an allowed extension."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def validate_image_file(file_storage):
    """
    Validates uploaded image file using Pillow.
    Returns (is_valid: bool, error_message: str | None).
    """
    try:
        file_storage.seek(0)
        img = Image.open(file_storage)
        img.verify()
        file_storage.seek(0)
        img = Image.open(file_storage)
        if img.format not in ('JPEG', 'PNG', 'GIF', 'WEBP'):
            return False, "Invalid image format"
        return True, None
    except Exception:
        return False, "Invalid image file"


# ==============================================================================
# PRODUCTION SECURITY & PERFORMANCE
# ==============================================================================

# 1. Secure Headers (XSS, CSP, etc.)
# Disable force_https for local development (breaks HTTP localhost), enable for production
force_https = os.environ.get("FORCE_HTTPS", "").strip().lower() not in {"0", "false", "no", "off"} and not app.debug

def get_cookie_settings():
    """Return cookie settings based on environment.

    Production (Render): the API lives on *.onrender.com while the storefront
    is served from jdlxmobile.in / *.vercel.app — a cross-site context. Browsers
    only attach cookies on cross-site requests when they are SameSite=None AND
    Secure, so the auth cookie must use both or every post-login API call (and
    the OAuth round-trip itself) loses the session and bounces back to /login.
    Localhost: frontend and backend are same-site (localhost:5173 -> :5000), so
    SameSite=Lax without Secure is correct and keeps cookies on plain HTTP.
    """
    if force_https:
        return {
            'httponly': True,
            'secure': True,
            'samesite': 'None'
        }
    return {
        'httponly': True,
        'secure': False,
        'samesite': 'Lax'
    }

Talisman(app,
    force_https=force_https,
    # CRITICAL: Talisman's default session_cookie_secure=True force-sets
    # SESSION_COOKIE_SECURE=True on EVERY request when debug is off, silently
    # overriding the app.config value above. On plain-HTTP localhost that makes
    # the Flask session cookie (which carries the OAuth CSRF nonce) Secure-only,
    # so the browser drops it and the Google login round-trip breaks. Tie it to
    # the same env-aware flag as the auth cookie so prod keeps Secure and
    # localhost works.
    session_cookie_secure=force_https,
    content_security_policy={
        'default-src': "'self'",
        'script-src': "'self' https://checkout.razorpay.com https://cdn.jsdelivr.net",
        'img-src': "'self' data: https:",
        'style-src': "'self' 'unsafe-inline'",
        'frame-src': "https://checkout.razorpay.com",
        'connect-src': "'self' https://api.razorpay.com",
    },
    force_https_permanent=force_https,
)

# 2. Rate Limiting
disable_rate_limit = os.environ.get("DISABLE_RATE_LIMIT", "").strip().lower() in {"1", "true", "yes", "on"}
rate_limit_defaults = [] if (disable_rate_limit or app.debug) else ["5000 per day", "1000 per hour"]

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=rate_limit_defaults,
    storage_uri="memory://",
)

# 3. Caching
cache = Cache(app, config={'CACHE_TYPE': 'simple'})

# 4. Scheduled Backups (daily database + weekly full backup)
scheduler = BackgroundScheduler(daemon=True)

# Only ONE process should run the scheduler. With multiple gunicorn workers (or
# docker replicas sharing the backend directory) an unlocked scheduler would run
# N copies of the daily/weekly backup jobs. An exclusive flock on a shared
# lockfile keeps it single-instance across workers AND containers.
_scheduler_lock_holder = None


def _try_acquire_scheduler_lock():
    global _scheduler_lock_holder
    try:
        import fcntl
    except ImportError:
        # Non-POSIX (e.g. Windows dev): flock is unavailable — keep the previous
        # single-process behavior and let the scheduler start.
        return True
    # Candidate lockfile dirs, best first:
    #  1. /app/backups — the docker-compose shared volume, so the lock also
    #     serializes the scheduler across the backend replicas (not just the
    #     gunicorn workers inside one container).
    #  2. BACKUP_DIR — the dir backup_service actually writes to.
    #  3. BASE_DIR — single-container fallback (Render multi-worker).
    candidates = [BASE_DIR]
    try:
        from backup.backup_service import BACKUP_DIR
        candidates.insert(0, str(BACKUP_DIR))
    except Exception:
        pass
    if os.path.isdir("/app/backups"):
        candidates.insert(0, "/app/backups")
    for directory in candidates:
        try:
            os.makedirs(directory, exist_ok=True)
            _scheduler_lock_holder = open(os.path.join(directory, ".scheduler.lock"), "a")
            fcntl.flock(_scheduler_lock_holder, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except Exception:
            continue
    _scheduler_lock_holder = None
    return False


def run_daily_database_backup():
    try:
        backup_database()
        logger.info("Daily database backup completed.")
    except Exception as e:
        logger.error(f"Daily database backup failed: {str(e)}")


def run_weekly_full_backup():
    try:
        create_full_backup()
        logger.info("Weekly full backup completed.")
    except Exception as e:
        logger.error(f"Weekly full backup failed: {str(e)}")


def run_due_referral_rewards():
    """Periodic sweep: pays referral rewards whose return/exchange/cancellation
    window has passed and whose qualifying order is still valid."""
    try:
        from utils.referral import process_due_referral_rewards
        paid = process_due_referral_rewards()
        if paid:
            logger.info(f"Referral reward sweep: paid {paid} reward(s).")
    except Exception as e:
        logger.error(f"Referral reward sweep failed: {str(e)}")


def run_vendor_settlement_sweep_job():
    """Periodic sweep: arms vendor settlements for DELIVERED orders and credits
    warehouse wallets once the return/exchange/cancellation window has passed
    and the order is still valid (no refund hold). See backend/settlement.py."""
    try:
        from settlement import run_vendor_settlement_sweep
        armed, settled, voided = run_vendor_settlement_sweep()
        if armed or settled or voided:
            logger.info(f"Vendor settlement sweep: armed={armed} settled={settled} voided={voided}")
    except Exception as e:
        logger.error(f"Vendor settlement sweep failed: {str(e)}")


should_start_scheduler = (
    (os.environ.get("WERKZEUG_RUN_MAIN") == "true" or not app.debug)
    and _try_acquire_scheduler_lock()
)
if should_start_scheduler and not scheduler.running:
    scheduler.add_job(run_daily_database_backup, 'cron', hour=2, minute=0, id='daily_db_backup', replace_existing=True)
    scheduler.add_job(run_weekly_full_backup, 'cron', day_of_week='sun', hour=3, minute=0, id='weekly_full_backup', replace_existing=True)
    scheduler.add_job(run_due_referral_rewards, 'interval', minutes=30, id='referral_reward_sweep', replace_existing=True)
    scheduler.add_job(run_vendor_settlement_sweep_job, 'interval', minutes=30, id='vendor_settlement_sweep', replace_existing=True)
    scheduler.start()


# ==============================================================================
# GLOBAL ERROR HANDLING
# ==============================================================================

@app.errorhandler(404)
def not_found(e):
    return error_response("Resource not found", 404)


@app.errorhandler(500)
def server_error(e):
    logger.error(f"Internal Server Error: {str(e)}", exc_info=True)
    return error_response("An internal server error occurred", 500)


@app.errorhandler(Exception)
def handle_exception(e):
    logger.error(f"Unhandled Exception: {str(e)}", exc_info=True)
    if hasattr(e, 'code'):
        return error_response(str(e), e.code)
    return error_response("Unexpected error", 500)


# ==============================================================================
# MIDDLEWARE & HOOKS
# ==============================================================================

@app.teardown_appcontext
def _close_request_db_connection(exception):
    """Releases the request-scoped DB connection when the app context ends.

    Pairs with database._RequestScopedConnection: get_db() within a request
    returns a shared connection whose close() is deferred, and this hook does
    the real close once the request (and its teardowns) complete.
    """
    try:
        from flask import g as _g
        conn = getattr(_g, "_jdlx_request_db", None)
        if conn is not None:
            conn._hard_close()
    except Exception:
        pass


@app.after_request
def _maybe_gzip_response(response):
    """Gzips text-like responses (JSON/HTML/JS/CSS/SVG) when the client accepts it.

    Pure transport optimization — body and header semantics are unchanged, and
    binary payloads (images, PDFs, downloads) are never touched. This matters
    because the Render deployment serves gunicorn directly with no nginx in
    front, so API responses were previously sent uncompressed.
    """
    if response.status_code < 200 or response.status_code >= 300:
        return response
    if response.headers.get("Content-Encoding"):
        return response
    accept_encoding = request.headers.get("Accept-Encoding", "")
    mimetype = (response.mimetype or "").lower()
    compressible = (
        mimetype.startswith("text/")
        or mimetype in (
            "application/json",
            "application/javascript",
            "application/xml",
            "image/svg+xml",
        )
    )
    if not compressible:
        return response
    # Always advertise the Accept-Encoding dependency for compressible types so
    # shared caches don't serve an uncompressed variant to gzip clients.
    vary = response.headers.get("Vary", "")
    if "Accept-Encoding" not in vary:
        response.headers["Vary"] = f"{vary}, Accept-Encoding" if vary else "Accept-Encoding"
    if "gzip" not in accept_encoding:
        return response
    if response.direct_passthrough:
        return response
    try:
        data = response.get_data()
    except Exception:
        return response
    if not data or len(data) < 500:
        return response
    compressed = gzip.compress(data, compresslevel=6)
    if len(compressed) >= len(data):
        return response
    response.set_data(compressed)
    response.headers["Content-Encoding"] = "gzip"
    response.headers["Content-Length"] = str(len(compressed))
    return response


@app.before_request
def log_request_info():
    logger.info(f"Request: {request.method} {request.path}")


@app.before_request
def security_shield_guard():
    if not request.path.startswith('/api/'):
        return None
    if request.path == '/api/health':
        return None

    ip_address = get_client_ip()

    allowed, retry_after = check_and_record_request(ip_address)
    if allowed:
        return None

    create_security_alert(
        "rapid_api_requests",
        f"IP {ip_address} exceeded rate limit and was temporarily blocked.",
        severity="high",
        ip_address=ip_address,
    )
    return jsonify({
        "error": "Rate limit exceeded. IP temporarily blocked.",
        "retry_after_seconds": retry_after,
    }), 429

# ==============================================================================
# BASE CONFIGURATION & PATHS
# ==============================================================================

UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# Centralized, restart-stable JWT secret. Uses JWT_SECRET env var when set;
# otherwise falls back to a persisted backend/.jwt_secret file (generated once
# and reused), so backend restarts/deploys NEVER rotate the secret and do not
# log every storefront user out of every device. See jwt_config.get_jwt_secret.
SECRET_KEY = get_jwt_secret()
app.secret_key = SECRET_KEY
# Keep the resolved secret in app config too, so auth/role_guard.py (which
# checks app.config first) verifies tokens with the exact same secret.
app.config["JWT_SECRET"] = SECRET_KEY
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "false").lower() == "true",
)
# Store / Default OAuth Credentials (Port 5173)
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", "http://localhost:5000/google/callback")

if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
    logger.error("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not set in the environment.")

FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173").rstrip("/")

# Admin Panel OAuth Credentials (Port 5174)
ADMIN_GOOGLE_CLIENT_ID = os.environ.get("ADMIN_GOOGLE_CLIENT_ID")
ADMIN_GOOGLE_CLIENT_SECRET = os.environ.get("ADMIN_GOOGLE_CLIENT_SECRET")
ADMIN_GOOGLE_REDIRECT_URI = os.environ.get("ADMIN_GOOGLE_REDIRECT_URI", "http://localhost:5000/admin/auth/google/callback")

if not ADMIN_GOOGLE_CLIENT_ID or not ADMIN_GOOGLE_CLIENT_SECRET:
    logger.error("ADMIN_GOOGLE_CLIENT_ID or ADMIN_GOOGLE_CLIENT_SECRET is not set in the environment.")

ADMIN_FRONTEND_URL = os.environ.get("ADMIN_FRONTEND_URL", "http://localhost:5174").rstrip("/")
WAREHOUSE_FRONTEND_URL = os.environ.get("WAREHOUSE_FRONTEND_URL", "http://localhost:5175").rstrip("/")

# Partner Portal OAuth Credentials (Warehouse / Delivery)
PARTNER_GOOGLE_CLIENT_ID = os.environ.get("PARTNER_GOOGLE_CLIENT_ID") or GOOGLE_CLIENT_ID
PARTNER_GOOGLE_CLIENT_SECRET = os.environ.get("PARTNER_GOOGLE_CLIENT_SECRET") or GOOGLE_CLIENT_SECRET
PARTNER_GOOGLE_REDIRECT_URI = os.environ.get("PARTNER_GOOGLE_REDIRECT_URI", "http://localhost:5000/partner/auth/google/callback")

DATABASE_PATH = os.environ.get("DATABASE_PATH") or os.path.join(BASE_DIR, "jdlx.db")
INITIAL_SUPER_ADMIN_EMAIL = os.environ.get("INITIAL_SUPER_ADMIN_EMAIL", "").strip().lower()
AVAILABLE_ADMIN_PERMISSIONS = [
    "manage_products",
    "manage_orders",
    "manage_inventory",
    "manage_delivery",
    "view_analytics",
    "manage_admins",
    "manage_users",
]

DEFAULT_ADMIN_PERMISSIONS = [
    "manage_products",
    "manage_orders",
    "manage_inventory",
    "manage_delivery",
    "manage_users",
]

# --- OAuth Clients ---

# 1. Store/Default OAuth client (used for customer login at port 5173)
# ==============================================================================
# OAUTH CONFIGURATION
# ==============================================================================

# 1. Store/Default OAuth client (used for customer login at port 5173)
oauth = OAuth(app)
oauth.register(
    name='google',
    client_id=GOOGLE_CLIENT_ID,
    client_secret=GOOGLE_CLIENT_SECRET,
    authorize_url='https://accounts.google.com/o/oauth2/auth',
    access_token_url='https://oauth2.googleapis.com/token',
    userinfo_endpoint='https://openidconnect.googleapis.com/v1/userinfo',
    jwks_uri='https://www.googleapis.com/oauth2/v3/certs',
    client_kwargs={'scope': 'openid email profile', 'leeway': 30},
)

# 2. Admin Panel OAuth client (dedicated credentials for admin login at port 5174)
oauth.register(
    name='google_admin',
    client_id=ADMIN_GOOGLE_CLIENT_ID,
    client_secret=ADMIN_GOOGLE_CLIENT_SECRET,
    authorize_url='https://accounts.google.com/o/oauth2/auth',
    access_token_url='https://oauth2.googleapis.com/token',
    userinfo_endpoint='https://openidconnect.googleapis.com/v1/userinfo',
    jwks_uri='https://www.googleapis.com/oauth2/v3/certs',
    client_kwargs={'scope': 'openid email profile', 'leeway': 30},
)

# 3. Partner Portal OAuth client (dedicated credentials for warehouse/delivery)
oauth.register(
    name='google_partner',
    client_id=PARTNER_GOOGLE_CLIENT_ID,
    client_secret=PARTNER_GOOGLE_CLIENT_SECRET,
    authorize_url='https://accounts.google.com/o/oauth2/auth',
    access_token_url='https://oauth2.googleapis.com/token',
    userinfo_endpoint='https://openidconnect.googleapis.com/v1/userinfo',
    jwks_uri='https://www.googleapis.com/oauth2/v3/certs',
    client_kwargs={'scope': 'openid email profile', 'leeway': 30},
)

# Make oauth accessible to blueprints (e.g., warehouse_routes)
app.config["OAUTH_CLIENT"] = oauth
app.config["PARTNER_OAUTH_CLIENT"] = oauth

# --- Helpers ---

# ==============================================================================
# AUTHENTICATION & AUTH HELPERS
# ==============================================================================

def token_required(f):
    """Decorator to protect routes with JWT authentication (cookie or header)."""
    @wraps(f)
    def decorated(*args, **kwargs):
        # Prefer HttpOnly cookie; fall back to Authorization header for backward compat
        token = request.cookies.get('token')
        if not token:
            auth_header = request.headers.get('Authorization')
            if auth_header and auth_header.startswith('Bearer '):
                token = auth_header.split(' ')[1]
        if not token:
            return error_response('Token is missing!', 401)
        try:
            data = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            
            # Global Logout Check: Verify if token was issued before min_token_iat
            user_id = data.get('user_id')
            iat = data.get('iat')
            if user_id and iat:
                conn = get_db()
                user_record = conn.execute("SELECT min_token_iat FROM users WHERE id = ?", (user_id,)).fetchone()
                conn.close()
                if user_record and user_record['min_token_iat'] and iat < user_record['min_token_iat']:
                    return error_response('Session invalidated. Please login again.', 401)

            data['role'] = normalize_role(data.get('role'))
            request.user = data
        except Exception as e:
            return error_response('Token is invalid!', 401)
        return f(*args, **kwargs)
    return decorated


# --- Admin OTP Re-authentication ---
# DB-backed (admin_otps table) so OTPs survive gunicorn worker restarts and are
# shared across workers. OTPs are stored hashed with a per-record salt, are
# one-time use, attempt-limited, rate-limited, and failures feed the existing
# login_guard lockout so brute-force is impossible.
OTP_MAX_ATTEMPTS = 5


def _hash_admin_otp(otp, salt):
    return hashlib.sha256(f"{salt}:{otp}".encode()).hexdigest()


@app.route('/api/auth/verify-token', methods=['GET'])
@token_required
def verify_token():
    """Verifies the current JWT token and returns the user's session info.
    Used by the admin frontend to validate sessions on app mount."""
    user = request.user
    return jsonify({
        "valid": True,
        "user_id": user.get("user_id"),
        "email": user.get("email"),
        "role": user.get("role"),
        "expires_at": datetime.datetime.utcfromtimestamp(user.get("exp", 0)).isoformat() if user.get("exp") else None
    })


@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    """Clears the HttpOnly auth cookie."""
    resp = jsonify({"success": True, "message": "Logged out successfully"})
    cookie_settings = get_cookie_settings()
    resp.set_cookie('token', '', **cookie_settings, expires=0)
    return resp


@app.route('/api/admin/request-otp', methods=['POST'])
@limiter.limit("3 per 10 minutes")
def admin_request_otp():
    """Requests an OTP for admin session re-authentication.

    Enumeration-safe: non-existent or non-admin accounts receive the same generic
    success response, so the API never reveals which emails are admins. OTP is
    only generated (and emailed) for real admin accounts.
    """
    data = request.get_json(silent=True) or {}
    email = data.get('email', '').strip().lower()
    if not email:
        return error_response("Email is required", 400)

    conn = get_db()
    cursor = conn.cursor()
    try:
        # Purge any expired OTP rows for this email first.
        cursor.execute("DELETE FROM admin_otps WHERE email = ? AND expires_at <= datetime('now')", (email,))

        # Respect the existing account lockout (login_guard) so a locked admin
        # cannot keep requesting OTPs.
        if is_account_locked(email):
            return error_response("Account temporarily locked. Try again later.", 423)

        cursor.execute("SELECT * FROM users WHERE LOWER(email) = ?", (email,))
        user = cursor.fetchone()

        admin_roles = ['admin', 'super_admin', 'manager', 'inventory_admin', 'delivery_admin', 'support_admin']
        role = None
        if user:
            role = normalize_role(user['role'])
        is_admin = bool(user) and role in admin_roles

        # Send the OTP ONLY for valid admin accounts; everyone else gets the
        # same generic 200 response (no email enumeration).
        if is_admin:
            user = dict(user)
            import random
            import string
            otp = ''.join(random.choices(string.digits, k=6))
            salt = secrets.token_hex(8)
            otp_hash = _hash_admin_otp(otp, salt)

            cursor.execute(
                '''INSERT INTO admin_otps (email, user_id, role, name, otp_hash, otp_salt, expires_at)
                   VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+5 minutes'))''',
                (email, user['id'], role, user.get('name'), otp_hash, salt),
            )
            conn.commit()

            # Send OTP via email in a background thread
            from threading import Thread
            subject = "Admin Session Re-authentication OTP"
            message = f"Your OTP for JDLX Admin Panel session re-authentication is: <br/><br/><b style='font-size: 24px; color: #4F46E5;'>{otp}</b><br/><br/>It will expire in 5 minutes."
            Thread(target=send_individual_email, args=(email, user.get('name') or 'Admin', subject, message)).start()

        return success_response(None, "If an account exists for this email, an OTP has been sent.")
    except Exception as e:
        logger.error(f"admin_request_otp error: {e}")
        return error_response("Failed to send OTP", 500)
    finally:
        conn.close()

@app.route('/api/admin/verify-otp', methods=['POST'])
@limiter.limit("10 per 10 minutes")
def admin_verify_otp():
    """Verifies an OTP and issues a new admin token.

    Hardened: attempt-limited (5 wrong guesses invalidate the OTP), rate-limited
    per IP, one-time use (row deleted on success or exhaustion), and failures are
    recorded via login_guard so repeated abuse locks the account out.
    """
    data = request.get_json(silent=True) or {}
    email = data.get('email', '').strip().lower()
    otp = data.get('otp', '').strip()

    if not email or not otp:
        return error_response("Email and OTP are required", 400)

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT * FROM admin_otps WHERE email = ? AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1",
            (email,),
        )
        row = cursor.fetchone()
        if not row:
            # No active OTP (missing or expired) — purge any stale row and give one answer.
            cursor.execute("DELETE FROM admin_otps WHERE email = ?", (email,))
            conn.commit()
            return error_response("OTP has expired. Please request a new one.", 401)

        otp_record = dict(row)
        expected_hash = _hash_admin_otp(otp, otp_record['otp_salt'])

        if not hmac.compare_digest(expected_hash, otp_record['otp_hash']):
            # Wrong OTP: count the attempt; once exhausted, invalidate the OTP and
            # feed the shared login lockout so the account gets temporarily locked.
            new_attempts = int(otp_record['attempts'] or 0) + 1
            cursor.execute("UPDATE admin_otps SET attempts = ? WHERE id = ?", (new_attempts, otp_record['id']))
            if new_attempts >= OTP_MAX_ATTEMPTS:
                cursor.execute("DELETE FROM admin_otps WHERE id = ?", (otp_record['id'],))
                record_login_attempt(email, get_client_ip(), "failed")
                try:
                    create_security_alert(
                        "admin_otp_bruteforce",
                        f"Admin OTP exhausted after {new_attempts} attempts for {email}.",
                        severity="high",
                        ip_address=get_client_ip(),
                    )
                except Exception:
                    pass
            conn.commit()
            return error_response("Invalid OTP", 401)

        # OTP verified! Atomically claim the row (one-time use). If a concurrent
        # request already consumed it, rowcount is 0 and we fail closed instead
        # of issuing a second token from the same OTP.
        user_id = otp_record['user_id']
        cursor.execute("DELETE FROM admin_otps WHERE id = ? AND expires_at > datetime('now')", (otp_record['id'],))
        if cursor.rowcount != 1:
            conn.commit()
            return error_response("OTP has expired. Please request a new one.", 401)
        conn.commit()

        # Fetch fresh user data and use the CURRENT role from the DB (never trust
        # the stale role stored with the OTP request).
        cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        user = cursor.fetchone()
        if not user:
            return error_response("User not found", 404)

        user = dict(user)
        user_role = normalize_role(user.get('role'))
        user_name = user.get('name')

        # Generate new token
        now_utc = datetime.datetime.utcnow()
        token_expiry = datetime.timedelta(hours=8)
        payload = {
            'user_id': user_id,
            'email': email,
            'role': user_role,
            'iat': now_utc,
            'jti': secrets.token_hex(16),
            'exp': now_utc + token_expiry
        }
        jwt_token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")

        user_data = {
            "id": user.get('id'),
            "name": user_name,
            "email": user.get('email'),
            "profile_image": user.get('profile_image'),
            "role": user_role
        }

        # Log successful re-auth
        log_admin_event(
            user_id,
            "admin_reauth_otp",
            "auth",
            user_id,
            "Admin re-authenticated via OTP successfully",
        )

        resp = jsonify({"success": True, "user": user_data})
        cookie_settings = get_cookie_settings()
        resp.set_cookie('token', jwt_token, **cookie_settings)
        return resp
    except Exception as e:
        logger.error(f"admin_verify_otp error: {e}")
        return error_response("Failed to verify OTP", 500)
    finally:
        conn.close()


def run_admin_anomaly_check(admin_id, action_type):
    """Runs anomaly detection for admin actions without interrupting business flow."""
    try:
        detect_admin_activity_anomaly(admin_id, action_type, get_client_ip())
    except Exception:
        pass


# Role -> default permission mapping. Sub-roles (manager, inventory_admin,
# delivery_admin, support_admin) get a scoped permission set matching the pages
# the admin panel shows them, so a manager cannot silently edit products, etc.
ROLE_DEFAULT_PERMISSIONS = {
    "admin": [
        "manage_products",
        "manage_orders",
        "manage_inventory",
        "manage_delivery",
        "manage_users",
    ],
    "manager": [
        "manage_products",
        "manage_orders",
        "manage_inventory",
        "manage_delivery",
        "manage_users",
        "view_analytics",
    ],
    "inventory_admin": [
        "manage_products",
        "manage_inventory",
        "view_analytics",
    ],
    "delivery_admin": [
        "manage_orders",
        "manage_delivery",
    ],
    "support_admin": [
        "manage_orders",
        "manage_users",
    ],
    "super_admin": AVAILABLE_ADMIN_PERMISSIONS,
}


def ensure_default_admin_permissions(cursor, admin_id, role="admin"):
    """Bootstraps default permissions for new admin accounts."""
    permissions = ROLE_DEFAULT_PERMISSIONS.get(role) or DEFAULT_ADMIN_PERMISSIONS
    if role == "super_admin":
        permissions = AVAILABLE_ADMIN_PERMISSIONS
    for permission in permissions:
        cursor.execute(
            '''
            INSERT OR IGNORE INTO admin_permissions (admin_id, permission)
            VALUES (?, ?)
            ''',
            (admin_id, permission),
        )


def upsert_admin_record(cursor, user_id, role):
    """Creates or updates an entry in the admins table."""
    cursor.execute(
        '''
        INSERT INTO admins (user_id, role)
        VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET role = excluded.role
        ''',
        (user_id, role),
    )


def remove_admin_record(cursor, user_id):
    """Deletes an entry from the admins table."""
    cursor.execute("DELETE FROM admins WHERE user_id = ?", (user_id,))


def maybe_bootstrap_super_admin(cursor, user_id, email):
    """Promotes the first user to super_admin if their email matches the bootstrap config."""
    if not INITIAL_SUPER_ADMIN_EMAIL or email.lower() != INITIAL_SUPER_ADMIN_EMAIL:
        return

    cursor.execute(
        "SELECT COUNT(*) as count FROM users WHERE role IN ('admin', 'super_admin')"
    )
    admin_count = cursor.fetchone()["count"]
    if admin_count == 0:
        cursor.execute("UPDATE users SET role = 'super_admin' WHERE id = ?", (user_id,))
        upsert_admin_record(cursor, user_id, 'super_admin')
        ensure_default_admin_permissions(cursor, user_id, role="super_admin")


# ==============================================================================
# PUBLIC ROUTES
# ==============================================================================

@app.route('/')
def index():
    """Base endpoint with API meta-information."""
    return jsonify({
        "status": "operational",
        "message": "JDLX Mobile Backend API",
        "version": "v4.2.0",
        "documentation": "/api/docs"
    }), 200


# --- Routes ---

def _issue_user_session(user_dict, email, ip_address):
    """Issue a JWT and build user_data for a fully authenticated user.

    Shared by Google OAuth login and the email-OTP signup/login flow so that
    session duration, admin audit logging, and the returned user payload stay
    identical everywhere. The caller is responsible for having persisted any
    DB changes before calling this.
    """
    user_role = normalize_role(user_dict.get('role'))

    # Read admin-controlled session duration for regular users (from system_settings).
    # Default: 8760 hours = 365 days, so store users stay logged in without auto-logout.
    user_session_hours = 8760
    try:
        conn = get_db()
        try:
            row = conn.execute("SELECT value FROM system_settings WHERE key = 'user_session_duration_hours'").fetchone()
            if row and row['value']:
                parsed = float(row['value'])
                if parsed and parsed > 0:
                    user_session_hours = parsed
        finally:
            conn.close()
    except Exception:
        pass  # never break login flow on settings read failure

    record_login_attempt(email, ip_address, "success")
    if user_role in ADMIN_ROLES:
        log_admin_event(
            user_dict['id'],
            "admin_login",
            "auth",
            user_dict['id'],
            "Admin login successful",
        )
        run_admin_anomaly_check(user_dict['id'], "admin_login")

    # Admin sessions expire in 8 hours (security, unchanged); regular users get the
    # admin-controlled duration from system_settings (default 8760h = 365 days).
    is_admin = user_role in ADMIN_ROLES
    token_expiry = datetime.timedelta(hours=8) if is_admin else datetime.timedelta(hours=user_session_hours)
    now_utc = datetime.datetime.utcnow()
    payload = {
        'user_id': user_dict['id'],
        'email': user_dict['email'],
        'role': user_role,
        'iat': now_utc,
        'jti': secrets.token_hex(16),
        'exp': now_utc + token_expiry
    }
    jwt_token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
    user_data = {
        "id": user_dict.get('id'),
        "name": user_dict.get('name'),
        "email": user_dict.get('email'),
        "profile_image": user_dict.get('profile_image'),
        "phone": user_dict.get('phone'),
        "gender": user_dict.get('gender'),
        "date_of_birth": user_dict.get('date_of_birth'),
        "age": user_dict.get('age'),
        "email_verified": user_dict.get('email_verified'),
        "phone_verified": user_dict.get('phone_verified'),
        "role": user_role
    }
    return user_data, jwt_token


# Admin-configurable OTP security settings (system_settings keys). These drive
# the escalating resend cooldown: every resend of an OTP waits longer than the
# previous one, so automated retry/brute-force attempts slow down naturally.
OTP_SECURITY_DEFAULTS = {
    'otp_resend_cooldown_base': 60,   # seconds to wait for the FIRST resend
    'otp_resend_cooldown_step': 60,   # extra seconds added per resend
    'otp_resend_cooldown_max': 300,   # cap on the per-resend wait
    'otp_resend_max': 5,              # max resends before a fresh OTP is required
    'otp_expiry_seconds': 600,        # OTP validity (matches the SQLite +10 min)
}


def get_otp_security_settings():
    """Reads OTP security settings from system_settings (admin-editable).

    Values are clamped to sane non-negative numbers; anything unset or unparseable
    falls back to the defaults, so admin misconfiguration never breaks login.
    """
    out = dict(OTP_SECURITY_DEFAULTS)
    try:
        conn = get_db()
        try:
            rows = conn.execute("SELECT key, value FROM system_settings").fetchall()
            for r in rows:
                if r['key'] in out:
                    try:
                        parsed = int(float(r['value']))
                        if parsed >= 0:
                            out[r['key']] = parsed
                    except (TypeError, ValueError):
                        pass
        finally:
            conn.close()
    except Exception:
        pass
    return out


def _otp_cooldown_remaining(settings, resend_count, last_sent_at):
    """Returns (allowed, wait_seconds) for resending an OTP.

    resend_count is the number of resends already performed on this OTP (0 for a
    freshly sent OTP). The wait grows after every send: base, base+step,
    base+2*step… capped at max — so the first resend waits `base`, the second
    waits `base+step`, and so on. A missing last-sent timestamp (legacy row) is
    always allowed.
    """
    if not last_sent_at:
        return True, 0
    count = max(0, int(resend_count or 0))
    cooldown_needed = min(
        settings['otp_resend_cooldown_base'] + settings['otp_resend_cooldown_step'] * count,
        settings['otp_resend_cooldown_max'],
    )
    try:
        last_dt = datetime.datetime.strptime(str(last_sent_at)[:19], '%Y-%m-%d %H:%M:%S')
        elapsed = (datetime.datetime.utcnow() - last_dt).total_seconds()
    except Exception:
        elapsed = cooldown_needed  # can't parse -> treat as still cooling down
    if elapsed >= cooldown_needed:
        return True, 0
    return False, max(1, int(cooldown_needed - elapsed))


def process_google_user_login(google_id, email, name, picture, ip_address, require_otp=False):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM users WHERE google_id = ?", (google_id,))
    user = cursor.fetchone()

    if user:
        # Existing account: update profile info and log in directly
        cursor.execute(
            "UPDATE users SET google_id = ?, profile_image = COALESCE(?, profile_image), name = COALESCE(?, name) WHERE id = ?",
            (google_id, picture or None, name or None, user['id'])
        )
        conn.commit()
        cursor.execute("SELECT * FROM users WHERE id = ?", (user['id'],))
        user = cursor.fetchone()
    elif email:
        cursor.execute("SELECT * FROM users WHERE LOWER(email) = ?", (email.lower(),))
        user = cursor.fetchone()
        if user:
            # If user exists with a DIFFERENT google_id, this is a conflict
            if user['google_id'] and user['google_id'] != google_id:
                conn.close()
                return {'link_conflict': True, 'email': email, 'existing_google_id': user['google_id']}

            # User exists but has NO google_id — link it directly
            cursor.execute(
                "UPDATE users SET google_id = ?, profile_image = COALESCE(?, profile_image), name = COALESCE(?, name) WHERE id = ?",
                (google_id, picture or None, name or None, user['id'])
            )
            conn.commit()
            cursor.execute("SELECT * FROM users WHERE id = ?", (user['id'],))
            user = cursor.fetchone()

            # If OTP required and user exists, trigger OTP (for admin/warehouse)
        # If user doesn't exist at all (neither by google_id nor email), create new
        if not user:
            cursor.execute(
                "INSERT INTO users (google_id, name, email, profile_image) VALUES (?, ?, ?, ?)",
                (google_id, name, email, picture)
            )
            conn.commit()
            cursor.execute("SELECT * FROM users WHERE google_id = ?", (google_id,))
            user = cursor.fetchone()

            # New User: Trigger Welcome Email in background
            if user and email:
                from threading import Thread
                Thread(target=send_welcome_email, args=(email, name or 'User')).start()

            # Referral code apply (additive)
            try:
                ref_code = request.args.get('ref') or (request.json.get('referral_code') if request.is_json else None)
                if ref_code:
                    from utils.referral import apply_referral_code
                    apply_referral_code(user['id'], ref_code)
            except Exception:
                pass  # never break signup flow

    # Update profile if new user was created via INSERT above
    if not user:
        cursor.execute("SELECT * FROM users WHERE google_id = ?", (google_id,))
        user = cursor.fetchone()

    # Continue with session issuance for all cases (existing or new)
    maybe_bootstrap_super_admin(cursor, user['id'], user['email'])
    conn.commit()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user['id'],))
    user = cursor.fetchone()
    user_dict = dict(user)
    user_role = normalize_role(user_dict.get('role'))
    if user_role in ADMIN_ROLES:
        ensure_default_admin_permissions(cursor, user['id'], role=user_role)
        upsert_admin_record(cursor, user['id'], user_role)
    else:
        remove_admin_record(cursor, user['id'])
    conn.commit()
    conn.close()

    return _issue_user_session(user_dict, email, ip_address)

@app.route('/api/auth/google', methods=['POST'])
def google_auth():
    """Handles Google One-Tap or Web Credential authentication."""
    data = request.json
    token = data.get('token')
    email_hint = (data.get('email') or 'unknown').strip().lower()
    ip_address = get_client_ip()

    if not token:
        return error_response("No token provided", 400)

    if email_hint != 'unknown' and is_account_locked(email_hint):
        create_security_alert(
            "multiple_failed_logins",
            f"Locked login attempt blocked for {email_hint}.",
            severity="high",
            ip_address=ip_address,
        )
        return error_response("Account temporarily locked. Try again later.", 423)

    try:
        # Verify Google Token with 30s clock skew tolerance
        idinfo = id_token.verify_oauth2_token(token, google_requests.Request(), GOOGLE_CLIENT_ID, clock_skew_in_seconds=30)
        google_id = idinfo['sub']
        email = idinfo['email']
        name = idinfo.get('name', '')
        picture = idinfo.get('picture', '')
        user_data, jwt_token = process_google_user_login(google_id, email, name, picture, ip_address)

        resp = jsonify({"user": user_data, "token": jwt_token})
        cookie_settings = get_cookie_settings()
        resp.set_cookie('token', jwt_token, **cookie_settings)
        return resp

    except ValueError:
        record_login_attempt(email_hint, ip_address, "failed")
        detect_failed_login_anomaly(email_hint, ip_address)
        return error_response("Invalid Google token", 401)


@app.route('/api/auth/google/link-verify', methods=['POST'])
@limiter.limit("10 per 10 minutes")
def google_link_verify():
    """Verify OTP to link Google account to existing user account."""
    data = request.get_json(silent=True) or {}
    email = data.get('email', '').strip().lower()
    otp = data.get('otp', '').strip()
    google_id = data.get('google_id', '').strip()
    
    if not email or not otp or not google_id:
        return error_response("Email, OTP, and Google ID required", 400)
    
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT * FROM google_link_otps WHERE email = ? AND google_id = ? AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1",
            (email, google_id)
        )
        row = cursor.fetchone()
        if not row:
            return error_response("Link request expired. Restart Google login.", 401)
        
        expected_hash = _hash_admin_otp(otp, row['otp_salt'])
        if not hmac.compare_digest(expected_hash, row['otp_hash']):
            new_attempts = int(row['attempts'] or 0) + 1
            cursor.execute("UPDATE google_link_otps SET attempts = ? WHERE id = ?", (new_attempts, row['id']))
            if new_attempts >= 5:
                cursor.execute("DELETE FROM google_link_otps WHERE id = ?", (row['id'],))
                record_login_attempt(email, get_client_ip(), "failed")
            conn.commit()
            return error_response("Invalid OTP", 401)
        
        # Success: Link Google account
        cursor.execute(
            "UPDATE users SET google_id = ?, profile_image = COALESCE(?, profile_image), name = COALESCE(?, name) WHERE id = ?",
            (google_id, row['picture'], row['name'], row['user_id'])
        )
        cursor.execute("DELETE FROM google_link_otps WHERE id = ?", (row['id'],))
        conn.commit()
        
        # Complete login
        ip_address = get_client_ip()
        user_data, jwt_token = process_google_user_login(google_id, email, row['name'] or '', row['picture'] or '', ip_address)
        
        resp = jsonify({"user": user_data})
        cookie_settings = get_cookie_settings()
        resp.set_cookie('token', jwt_token, **cookie_settings)
        return resp
    finally:
        conn.close()


@app.route('/api/auth/google/link-resend', methods=['POST'])
@limiter.limit("6 per 10 minutes")
def google_link_resend():
    """Resends the Google login/link OTP for an existing account.

    Enumeration-safe: non-existent emails get the same generic success response
    with no email sent. The resend wait ESCALATES on every resend (base + step
    per resend, capped at max — admin-configurable), and after otp_resend_max
    resends a fresh OTP is required. Returns the next cooldown so the store UI
    can show an accurate security countdown.
    """
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    google_id = (data.get('google_id') or '').strip()

    if not email or not google_id:
        return error_response("Email and Google ID are required", 400)
    if is_account_locked(email):
        return error_response("Account temporarily locked. Try again later.", 423)

    settings = get_otp_security_settings()
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM users WHERE LOWER(email) = ?", (email,))
        user = cursor.fetchone()
        if not user:
            return success_response(None, "OTP sent to your email.")

        # Escalating cooldown: only unexpired OTP rows count toward the resend
        # budget; an expired OTP is treated as a fresh request.
        cursor.execute(
            "SELECT * FROM google_link_otps WHERE email = ? AND google_id = ? AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1",
            (email, google_id)
        )
        existing = cursor.fetchone()
        resend_count = 0
        if existing:
            resend_count = int(existing['resend_count'] or 0)
            if resend_count >= settings['otp_resend_max']:
                return error_response(
                    "Too many OTP requests. Wait for the current OTP to expire and try again.", 429,
                    data={'cooldown_seconds': settings['otp_resend_cooldown_max']}
                )
            allowed, wait = _otp_cooldown_remaining(settings, resend_count, existing['last_sent_at'])
            if not allowed:
                return error_response(f"Please wait {wait}s before requesting another OTP.", 429,
                                      data={'cooldown_seconds': wait})
        # Only the newest OTP per email+google_id stays valid: drop previous rows.
        cursor.execute("DELETE FROM google_link_otps WHERE email = ? AND google_id = ?", (email, google_id))

        # Fresh OTP stores resend_count 0 (first resend waits `base`); each
        # resend bumps it so the wait escalates: base, base+step, base+2*step…
        new_count = (resend_count + 1) if existing else 0
        import random
        import string
        otp = ''.join(random.choices(string.digits, k=6))
        salt = secrets.token_hex(8)
        otp_hash = _hash_admin_otp(otp, salt)

        cursor.execute(
            "INSERT INTO google_link_otps (email, user_id, google_id, name, picture, otp_hash, otp_salt, expires_at, resend_count, last_sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?), ?, datetime('now'))",
            (email, user['id'], google_id, user['name'], user['profile_image'], otp_hash, salt,
             f'+{settings["otp_expiry_seconds"]} seconds', new_count)
        )
        conn.commit()

        # Send the OTP over SMTP synchronously so a failed send reaches the user
        # instead of being swallowed by a background thread.
        send_ok = send_individual_email(email, user['name'] or 'User',
            "Login Verification OTP",
            f"Your OTP to sign in to JDLX Mobile: <b style='font-size:24px'>{otp}</b><br>It will expire in {int(settings['otp_expiry_seconds'] / 60)} minutes."
        )
        if not send_ok:
            # Don't leave an OTP row for a code that was never emailed.
            cursor.execute("DELETE FROM google_link_otps WHERE email = ? AND google_id = ?", (email, google_id))
            conn.commit()
            return error_response("Could not send the OTP email right now. Please try again in a moment.", 500)

        next_cooldown = min(
            settings['otp_resend_cooldown_base'] + settings['otp_resend_cooldown_step'] * new_count,
            settings['otp_resend_cooldown_max']
        )
        return success_response({
            'cooldown_seconds': next_cooldown,
            'resend_count': new_count,
            'expires_in': settings['otp_expiry_seconds'],
        }, "OTP sent to your email.")
    except Exception as e:
        logger.error(f"google_link_resend error: {e}")
        try:
            cursor.execute("DELETE FROM google_link_otps WHERE email = ? AND google_id = ?", (email, google_id))
            conn.commit()
        except Exception:
            pass
        return error_response("Failed to send OTP", 500)
    finally:
        conn.close()


@app.route('/api/auth/email/send-otp', methods=['POST'])
@limiter.limit("6 per 10 minutes")
def email_send_otp():
    """Sends an email OTP for customer email-based signup/login.

    Enumeration-safe: the response is the same whether or not an account exists
    (a new user is created automatically on verify-otp). OTPs are stored hashed
    with a per-record salt, one active OTP per email, attempt-limited, and
    failures feed the shared login_guard lockout via verify-otp. The resend wait
    ESCALATES on every resend (base + step per resend, capped at max — all
    admin-configurable), and after otp_resend_max resends a fresh OTP is required.
    The response carries cooldown_seconds so the store UI can show an accurate
    security countdown.
    """
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    if not email or '@' not in email or '.' not in email.split('@')[-1]:
        return error_response("A valid email is required", 400)

    if is_account_locked(email):
        return error_response("Account temporarily locked. Try again later.", 423)

    settings = get_otp_security_settings()
    conn = get_db()
    cursor = conn.cursor()
    try:
        # Escalating cooldown: only an UNEXPIRED OTP row counts toward the resend
        # budget; an expired OTP is treated as a fresh request.
        cursor.execute(
            "SELECT * FROM customer_email_otps WHERE email = ? AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1",
            (email,)
        )
        existing = cursor.fetchone()
        resend_count = 0
        if existing:
            resend_count = int(existing['resend_count'] or 0)
            if resend_count >= settings['otp_resend_max']:
                return error_response(
                    "Too many OTP requests. Wait for the current OTP to expire and try again.", 429,
                    data={'cooldown_seconds': settings['otp_resend_cooldown_max']}
                )
            allowed, wait = _otp_cooldown_remaining(settings, resend_count, existing['last_sent_at'])
            if not allowed:
                return error_response(f"Please wait {wait}s before requesting another OTP.", 429,
                                      data={'cooldown_seconds': wait})
        # Only the newest OTP per email stays valid: drop every previous row.
        cursor.execute("DELETE FROM customer_email_otps WHERE email = ?", (email,))

        # Fresh OTP stores resend_count 0 (first resend waits `base`); each
        # resend bumps it so the wait escalates: base, base+step, base+2*step…
        new_count = (resend_count + 1) if existing else 0
        import random
        import string
        otp = ''.join(random.choices(string.digits, k=6))
        salt = secrets.token_hex(8)
        otp_hash = _hash_admin_otp(otp, salt)

        cursor.execute(
            "INSERT INTO customer_email_otps (email, otp_hash, otp_salt, expires_at, resend_count, last_sent_at) VALUES (?, ?, ?, datetime('now', ?), ?, datetime('now'))",
            (email, otp_hash, salt, f'+{settings["otp_expiry_seconds"]} seconds', new_count)
        )
        conn.commit()

        # Greet returning users by their saved account name; brand-new emails
        # (no account yet) fall back to the email prefix.
        existing_user = cursor.execute("SELECT name FROM users WHERE LOWER(email) = ?", (email,)).fetchone()
        greeting_name = ((existing_user['name'] if existing_user else '') or '').strip() or email.split('@')[0]

        # Send the OTP over SMTP synchronously so a failed send surfaces to the
        # caller instead of being silently swallowed by a background thread
        # (a dead thread previously left an OTP row with no email behind).
        send_ok = send_individual_email(email, greeting_name,
            "Sign in OTP",
            f"Your OTP to access your JDLX Mobile account: <b style='font-size:24px'>{otp}</b><br>It will expire in {int(settings['otp_expiry_seconds'] / 60)} minutes."
        )
        if not send_ok:
            # Don't leave an OTP row for a code that was never emailed.
            cursor.execute("DELETE FROM customer_email_otps WHERE email = ?", (email,))
            conn.commit()
            return error_response("Could not send the OTP email right now. Please try again in a moment.", 500)

        next_cooldown = min(
            settings['otp_resend_cooldown_base'] + settings['otp_resend_cooldown_step'] * new_count,
            settings['otp_resend_cooldown_max']
        )
        return success_response({
            'cooldown_seconds': next_cooldown,
            'resend_count': new_count,
            'expires_in': settings['otp_expiry_seconds'],
        }, "OTP sent to your email.")
    except Exception as e:
        logger.error(f"email_send_otp error: {e}")
        # If the insert succeeded but sending crashed, drop the stale row so no
        # unusable OTP lingers for this email.
        try:
            cursor.execute("DELETE FROM customer_email_otps WHERE email = ?", (email,))
            conn.commit()
        except Exception:
            pass
        return error_response("Failed to send OTP", 500)
    finally:
        conn.close()


@app.route('/api/auth/email/verify-otp', methods=['POST'])
@limiter.limit("10 per 10 minutes")
def email_verify_otp():
    """Verifies an email OTP and logs the user in.

    First-time signup: creates the customer account (users.google_id is NOT
    NULL, so a deterministic placeholder is derived from the email). Existing
    account: just logs in. OTP is one-time use, attempt-limited (5 wrong
    guesses invalidate it), and expired/missing OTPs get one answer.

    Accepts optional signup details collected by the store UI after the OTP
    step: first_name, last_name, age, phone. For a NEW account these are saved
    immediately so the display name (and every email we send) uses the name the
    user actually chose instead of the email prefix. For an existing account the
    name is left untouched, but empty phone/age fields are filled in.
    """
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    otp = (data.get('otp') or '').strip()

    if not email or not otp:
        return error_response("Email and OTP are required", 400)

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT * FROM customer_email_otps WHERE email = ? AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1",
            (email,)
        )
        row = cursor.fetchone()
        if not row:
            cursor.execute("DELETE FROM customer_email_otps WHERE email = ?", (email,))
            conn.commit()
            return error_response("OTP has expired. Please request a new one.", 401)

        expected_hash = _hash_admin_otp(otp, row['otp_salt'])
        if not hmac.compare_digest(expected_hash, row['otp_hash']):
            new_attempts = int(row['attempts'] or 0) + 1
            cursor.execute("UPDATE customer_email_otps SET attempts = ? WHERE id = ?", (new_attempts, row['id']))
            if new_attempts >= OTP_MAX_ATTEMPTS:
                cursor.execute("DELETE FROM customer_email_otps WHERE id = ?", (row['id'],))
                record_login_attempt(email, get_client_ip(), "failed")
            conn.commit()
            return error_response("Invalid OTP", 401)

        # Atomically claim the OTP (one-time use). If a concurrent request
        # already consumed it, fail closed instead of issuing a second session.
        cursor.execute("DELETE FROM customer_email_otps WHERE id = ? AND expires_at > datetime('now')", (row['id'],))
        if cursor.rowcount != 1:
            conn.commit()
            return error_response("OTP has expired. Please request a new one.", 401)

        ip_address = get_client_ip()
        cursor.execute("SELECT * FROM users WHERE LOWER(email) = ?", (email,))
        user = cursor.fetchone()
        is_new_user = False
        def _clean_signup_text(value, max_len):
            text = (value or '').strip()
            return ' '.join(text.split())[:max_len] or None

        first_name = _clean_signup_text(data.get('first_name'), 50)
        last_name = _clean_signup_text(data.get('last_name'), 50)
        age_raw = str(data.get('age') or '').strip()
        age = int(age_raw) if age_raw.isdigit() and 1 <= int(age_raw) <= 120 else None
        phone = _clean_signup_text(data.get('phone'), 15)
        if phone and not phone.replace('+', '').replace(' ', '').replace('-', '').isdigit():
            phone = None
        full_name = ' '.join(p for p in (first_name, last_name) if p) or None

        if not user:
            is_new_user = True
            # First-time signup: create the account. users.google_id is NOT NULL
            # UNIQUE, so use a deterministic placeholder derived from the email;
            # a real Google id can replace it later via the Google OTP-link flow.
            placeholder_google_id = 'email_' + hashlib.sha256(email.encode()).hexdigest()[:20]
            # Prefer the name the user just entered over the email prefix so the
            # welcome email and every later greeting use their real name.
            name = full_name or email.split('@')[0]
            cursor.execute(
                "INSERT INTO users (google_id, name, email, email_verified, age, phone) VALUES (?, ?, ?, 1, ?, ?)",
                (placeholder_google_id, name, email, age, phone)
            )
            conn.commit()
            cursor.execute("SELECT * FROM users WHERE LOWER(email) = ?", (email,))
            user = cursor.fetchone()

            if user:
                # Referral code apply (additive)
                try:
                    ref_code = request.json.get('referral_code') if request.is_json else None
                    if ref_code:
                        from utils.referral import apply_referral_code
                        apply_referral_code(user['id'], ref_code)
                except Exception:
                    pass  # never break signup flow

            maybe_bootstrap_super_admin(cursor, user['id'], user['email'])
            conn.commit()
            cursor.execute("SELECT * FROM users WHERE id = ?", (user['id'],))
            user = cursor.fetchone()
        else:
            # Existing account: never overwrite their saved name/details, but
            # fill in phone/age if the profile didn't have them yet.
            updates, params = [], []
            if phone and not (user['phone'] or '').strip():
                updates.append('phone = ?')
                params.append(phone)
            if age is not None and user['age'] is None:
                updates.append('age = ?')
                params.append(age)
            if updates:
                params.append(user['id'])
                cursor.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", tuple(params))
                conn.commit()
                cursor.execute("SELECT * FROM users WHERE id = ?", (user['id'],))
                user = cursor.fetchone()

        user_dict = dict(user)
        user_data, jwt_token = _issue_user_session(user_dict, email, ip_address)

        resp = jsonify({"user": user_data, "is_new_user": is_new_user})
        cookie_settings = get_cookie_settings()
        resp.set_cookie('token', jwt_token, **cookie_settings)
        return resp
    finally:
        conn.close()


@app.route('/api/auth/email/save-signup-details', methods=['POST'])
@token_required
def email_save_signup_details():
    """Saves the profile details collected right after the email-OTP signup.

    Called by the store with the session cookie issued by verify-otp. Stores
    the user-chosen first/last name (as the display name), age and mobile so
    the profile page and every email we send use the name the user picked
    instead of the email prefix.
    """
    user_id = request.user['user_id']
    data = request.get_json(silent=True) or {}

    def _clean(value, max_len):
        text = (value or '').strip()
        return ' '.join(text.split())[:max_len] or None

    first_name = _clean(data.get('first_name'), 50)
    last_name = _clean(data.get('last_name'), 50)
    full_name = ' '.join(p for p in (first_name, last_name) if p)
    age_raw = str(data.get('age') or '').strip()
    age = int(age_raw) if age_raw.isdigit() and 1 <= int(age_raw) <= 120 else None
    phone = _clean(data.get('phone'), 15)
    if phone and not phone.replace('+', '').replace(' ', '').replace('-', '').isdigit():
        phone = None

    if not full_name:
        return error_response("First name is required", 400)

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE users SET name = ?, age = ?, phone = ? WHERE id = ?",
                       (full_name, age, phone, user_id))
        conn.commit()
        cursor.execute(
            "SELECT id, name, email, profile_image, phone, gender, date_of_birth, age, email_verified, phone_verified FROM users WHERE id = ?",
            (user_id,)
        )
        user = cursor.fetchone()

        # Welcome email goes out AFTER the details are saved so it greets the
        # user by the name they actually chose (not the email prefix).
        if user:
            from threading import Thread
            Thread(target=send_welcome_email, args=(user['email'], user['name'])).start()

        return jsonify(dict(user))
    except Exception as e:
        logger.error(f"email_save_signup_details error: {e}")
        return error_response("Could not save your details. Please try again.", 500)
    finally:
        conn.close()


@app.route('/login/google', methods=['GET'])
def login_google():
    """Redirects to Google for customer authentication using a stateless flow."""
    flow = request.args.get('flow', 'user')
    frontend_url = request.args.get('frontend_url')
    
    if not frontend_url:
        referer = request.headers.get('Referer')
        if referer:
            from urllib.parse import urlparse
            parsed = urlparse(referer)
            frontend_url = f"{parsed.scheme}://{parsed.netloc}"
    
    if not frontend_url:
        frontend_url = FRONTEND_BASE_URL

    # Encode both flow and frontend_url into the state parameter
    # The referral code (if the user arrived via a shared ?ref= link) is carried
    # in the state so it survives the Google round-trip and can be applied to
    # the new account right after signup.
    ref_code_state = request.args.get('ref', '').strip()[:16]
    state_payload = f"{flow}|{frontend_url}"
    
    from urllib.parse import urlencode
    # Include CSRF nonce for OAuth state validation
    csrf_nonce = secrets.token_urlsafe(16)
    session['oauth_csrf_nonce'] = csrf_nonce
    state_payload = f"{state_payload}|{ref_code_state}|{csrf_nonce}"
    params = {
        'client_id': GOOGLE_CLIENT_ID,
        'redirect_uri': GOOGLE_REDIRECT_URI,
        'response_type': 'code',
        'scope': 'openid email profile',
        'prompt': 'select_account',
        'state': state_payload
    }
    auth_url = f"https://accounts.google.com/o/oauth2/auth?{urlencode(params)}"
    return redirect(auth_url)


@app.route('/admin/login/google', methods=['GET'])
def admin_login_google():
    """Redirects to Google using the dedicated Admin OAuth client."""
    frontend_url = request.args.get('frontend_url')
    if not frontend_url:
        referer = request.headers.get('Referer')
        if referer:
            from urllib.parse import urlparse
            parsed = urlparse(referer)
            frontend_url = f"{parsed.scheme}://{parsed.netloc}"
    
    if not frontend_url:
        frontend_url = ADMIN_FRONTEND_URL

    # Build manual redirect URL to bypass Authlib and use stateless frontend URL passing
    from urllib.parse import urlencode
    # Include CSRF nonce for OAuth state validation
    csrf_nonce = secrets.token_urlsafe(16)
    session['admin_oauth_csrf_nonce'] = csrf_nonce
    state_with_nonce = f"{frontend_url}|{csrf_nonce}"
    params = {
        'client_id': ADMIN_GOOGLE_CLIENT_ID,
        'redirect_uri': ADMIN_GOOGLE_REDIRECT_URI,
        'response_type': 'code',
        'scope': 'openid email profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
        'prompt': 'select_account',
        'state': state_with_nonce
    }
    auth_url = f"https://accounts.google.com/o/oauth2/auth?{urlencode(params)}"
    return redirect(auth_url)


@app.route('/admin/auth/google/callback', methods=['GET'])
def admin_google_callback():
    """Callback for admin authentication; enforces admin role requirements."""
    # Retrieve the dynamic frontend URL and validate CSRF nonce from state
    state = request.args.get('state', '')
    state_parts = state.split('|', 1)
    raw_frontend_url = state_parts[0] if state_parts else ''
    received_nonce = state_parts[1] if len(state_parts) > 1 else ''
    frontend_url = raw_frontend_url if raw_frontend_url.startswith('http') else ADMIN_FRONTEND_URL

    # Validate CSRF nonce (soft-check: log warning if missing, block if mismatched)
    stored_nonce = session.pop('admin_oauth_csrf_nonce', None)
    if stored_nonce and received_nonce and not hmac.compare_digest(stored_nonce, received_nonce):
        logger.warning(f"Admin OAuth CSRF nonce mismatch. Expected={stored_nonce}, Got={received_nonce}")
        return redirect(f"{frontend_url}/admin/login?error=csrf_validation_failed")
    
    try:
        # Bypassing Authlib's strict session state validation which often fails on localhost
        # due to cross-site cookie dropping (SameSite/Secure restrictions).
        code = request.args.get('code')
        if not code:
            return redirect(f"{frontend_url}/admin/login?error=oauth_failed&details=Missing authorization code")

        # 1. Exchange code for token directly (with retry + timeout for reliability)
        import requests as req_lib
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry

        http_session = req_lib.Session()
        retries = Retry(total=3, backoff_factor=0.5, status_forcelist=[500, 502, 503, 504],
                        allowed_methods=['POST', 'GET'])
        http_session.mount('https://', HTTPAdapter(max_retries=retries))

        token_resp = http_session.post(
            'https://oauth2.googleapis.com/token',
            data={
                'client_id': ADMIN_GOOGLE_CLIENT_ID,
                'client_secret': ADMIN_GOOGLE_CLIENT_SECRET,
                'code': code,
                'grant_type': 'authorization_code',
                'redirect_uri': ADMIN_GOOGLE_REDIRECT_URI
            },
            timeout=15
        ).json()

        if 'error' in token_resp:
            logger.error(f"Token exchange error: {token_resp}")
            return redirect(f"{frontend_url}/admin/login?error=oauth_failed&details={token_resp.get('error_description', token_resp['error'])}")

        access_token = token_resp.get('access_token')
        
        # 2. Fetch userinfo
        userinfo = http_session.get(
            'https://www.googleapis.com/oauth2/v3/userinfo',
            headers={'Authorization': f'Bearer {access_token}'},
            timeout=15
        ).json()

        if 'error' in userinfo or 'email' not in userinfo:
            logger.error(f"Userinfo error: {userinfo}")
            return redirect(f"{frontend_url}/admin/login?error=userinfo_failed")

        google_id = userinfo.get('sub')
        email = (userinfo.get('email') or '').strip().lower()
        name = userinfo.get('name', '')
        picture = userinfo.get('picture', '')

        if not google_id or not email:
            return redirect(f"{frontend_url}/admin/login?error=incomplete_profile")

        ip_address = get_client_ip()
        if is_account_locked(email):
            return redirect(f"{frontend_url}/admin/login?error=account_locked")

        result = process_google_user_login(google_id, email, name, picture, ip_address)
        
        # Handle link_conflict from process_google_user_login
        if isinstance(result, dict) and 'link_conflict' in result:
            return redirect(f"{frontend_url}/admin/login?error=google_link_conflict&email={result['email']}")
        
        user_data, jwt_token = result
        user_role = (user_data.get('role') or '').lower()

        admin_roles = {'admin', 'super_admin', 'manager', 'inventory_admin', 'delivery_admin', 'support_admin'}
        if user_role not in admin_roles:
            logger.warning(f"Non-admin login attempt via admin OAuth: {email} (role={user_role})")
            return redirect(f"{frontend_url}/admin/login?error=unauthorized")

        # Block disabled admin accounts (security control for the AdminAdmins page).
        try:
            conn = get_db()
            row = conn.execute(
                "SELECT status FROM admins WHERE user_id = ?", (user_data.get('id'),)
            ).fetchone()
            conn.close()
            if row and str(row['status']).strip().lower() == 'disabled':
                logger.warning(f"Disabled admin login attempt: {email}")
                return redirect(f"{frontend_url}/admin/login?error=account_disabled")
        except Exception:
            pass  # never break login on status read failure

        encoded_user = quote(json.dumps(user_data, separators=(',', ':')))
        cookie_settings = get_cookie_settings()
        resp = redirect(f"{frontend_url}/admin/dashboard")
        resp.set_cookie('token', jwt_token, **cookie_settings)
        return resp
            
    except Exception as exc:
        logger.error(f"Admin Google OAuth callback failed: {str(exc)}", exc_info=True)
        # Security: Never expose internal exception details to the client
        return redirect(f"{frontend_url}/admin/login?error=auth_error&details=Authentication+failed.+Please+try+again.")


@app.route('/google/callback', methods=['GET'])
def google_callback():
    """General Google OAuth callback; dispatches based on state-encoded flow."""
    state_payload = request.args.get('state', '')
    ref_code_state = ''
    if '|' in state_payload:
        parts = state_payload.split('|')
        flow = parts[0]
        frontend_url = parts[1] if len(parts) > 1 else FRONTEND_BASE_URL
        # The referral code rides in position 2 (old states only had
        # flow|frontend_url|nonce, so this stays backward compatible).
        # Only a code shaped like our JD-prefixed referral codes is accepted,
        # so a stray CSRF nonce from an old state can never be treated as one.
        # Case-insensitive: apply_referral_code() normalizes to uppercase.
        if len(parts) > 2 and parts[2].upper().startswith('JD') and len(parts[2]) <= 16:
            ref_code_state = parts[2]
    else:
        flow = 'user'
        frontend_url = state_payload if state_payload.startswith('http') else FRONTEND_BASE_URL

    code = request.args.get('code')
    if not code:
        logger.error("Missing code in Google OAuth callback")
        return error_response("Missing authorization code", 400)

    try:
        # 1. Exchange code for token directly (Stateless, with retry + timeout)
        import requests as req_lib
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry

        http_session = req_lib.Session()
        retries = Retry(total=3, backoff_factor=0.5, status_forcelist=[500, 502, 503, 504],
                        allowed_methods=['POST', 'GET'])
        http_session.mount('https://', HTTPAdapter(max_retries=retries))

        token_resp = http_session.post(
            'https://oauth2.googleapis.com/token',
            data={
                'client_id': GOOGLE_CLIENT_ID,
                'client_secret': GOOGLE_CLIENT_SECRET,
                'code': code,
                'grant_type': 'authorization_code',
                'redirect_uri': GOOGLE_REDIRECT_URI
            },
            timeout=15
        ).json()

        if 'error' in token_resp:
            logger.error(f"Token exchange error: {token_resp}")
            return error_response(f"Token exchange failed: {token_resp.get('error_description', token_resp['error'])}", 400)

        access_token = token_resp.get('access_token')
        
        # 2. Fetch userinfo
        userinfo = http_session.get(
            'https://www.googleapis.com/oauth2/v3/userinfo',
            headers={'Authorization': f'Bearer {access_token}'},
            timeout=15
        ).json()

        google_id = userinfo.get('sub')
        email = (userinfo.get('email') or '').strip().lower()
        name = userinfo.get('name', '')
        picture = userinfo.get('picture', '')

        if not google_id or not email:
            logger.error(f"Incomplete Google user profile: {userinfo}")
            return redirect(f"{frontend_url}/login?error=incomplete_profile")

        ip_address = get_client_ip()
        if is_account_locked(email):
            create_security_alert(
                "multiple_failed_logins",
                f"Locked login attempt blocked for {email}.",
                severity="high",
                ip_address=ip_address,
            )
            return redirect(f"{frontend_url}/login?error=account_locked")

        # 3. Process Login
        result = process_google_user_login(google_id, email, name, picture, ip_address)
        
        # Handle link_conflict from process_google_user_login
        if isinstance(result, dict) and 'link_conflict' in result:
            if result.get('email_send_failed'):
                return redirect(f"{frontend_url}/login?error=otp_email_failed&email={result.get('email', '')}&google_id={result.get('google_id', '')}")
            return redirect(f"{frontend_url}/login?error=google_link_conflict&email={result['email']}")
        
        user_data, jwt_token = result

        # Apply referral code carried through the OAuth state (from a shared
        # ?ref= link). Safe no-op when the code is invalid/already used.
        if ref_code_state:
            try:
                from utils.referral import apply_referral_code
                apply_referral_code(user_data['id'], ref_code_state)
            except Exception:
                pass  # never break login flow

        # Store in session as a backup (though we're moving towards stateless)
        session['oauth_user_id'] = user_data['id']
        session['oauth_email'] = user_data['email']

        encoded_user = quote(json.dumps(user_data, separators=(',', ':')))

        if flow in ('warehouse_login', 'warehouse'):
            from warehouse_routes import get_db as wh_get_db
            wh_conn = wh_get_db()
            try:
                wh = wh_conn.execute(
                    """SELECT w.*, ds.id AS store_id, ds.store_code 
                       FROM warehouses w 
                       LEFT JOIN dark_stores ds ON w.warehouse_name = ds.name 
                       WHERE w.email = ?""", 
                    (email,)
                ).fetchone()
            finally:
                wh_conn.close()

            if not wh:
                return redirect(f"{frontend_url}/warehouse/login?error=not_authorized")

            wh_token = issue_warehouse_token(wh['id'], email, wh['warehouse_role'])
            wh_user = {
                'id': wh['id'],
                'store_id': wh['store_id'],
                'partner_id': wh['partner_id'],
                'store_code': wh['store_code'],
                'warehouse_name': wh['warehouse_name'],
                'owner_name': wh['owner_name'],
                'email': wh['email'],
                'warehouse_role': wh['warehouse_role'],
                'role': wh['warehouse_role'],
                'address': wh['address'],
                'pincode': wh['pincode'],
                'warehouse_capacity': wh['warehouse_capacity'],
                'operations_status': wh['operations_status'],
                'weather_status': wh['weather_status'],
                'service_radius_km': wh['service_radius_km'],
            }
            cookie_settings = get_cookie_settings()
            resp = redirect(f"{frontend_url}/warehouse/dashboard")
            resp.set_cookie('token', wh_token, **cookie_settings)
            return resp

        if flow in ('delivery_login', 'delivery'):
            conn = get_db()
            try:
                dp = conn.execute("SELECT * FROM delivery_partners WHERE email = ?", (email,)).fetchone()
            finally:
                conn.close()

            if not dp:
                return redirect(f"{frontend_url}/warehouse/login?error=not_authorized&role=delivery")

            payload = {
                "partner_id": dp["id"],
                "email": email,
                "type": "delivery",
                "exp": datetime.datetime.utcnow() + datetime.timedelta(days=7),
            }
            dp_token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")
            dp_user = {
                'id': dp['id'],
                'partner_id': dp['partner_id'],
                'name': dp['name'],
                'email': dp['email'],
                'role': 'delivery',
                'status': dp['status']
            }
            cookie_settings = get_cookie_settings()
            resp = redirect(f"{frontend_url}/delivery/dashboard")
            resp.set_cookie('token', dp_token, **cookie_settings)
            return resp

        if flow in ('warehouse_request', 'warehouse_partner_request'):
            req_payload = {
                'email': email,
                'name': name,
                'type': 'warehouse_request',
                'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=2),
            }
            req_token = jwt.encode(req_payload, SECRET_KEY, algorithm='HS256')
            req_user = {'email': email, 'name': name}
            cookie_settings = get_cookie_settings()
            resp = redirect(f"{frontend_url}/warehouse/request")
            resp.set_cookie('token', req_token, **cookie_settings)
            return resp

        if flow == 'delivery_request':
            req_payload = {
                'email': email,
                'name': name,
                'type': 'delivery_request',
                'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=2),
            }
            req_token = jwt.encode(req_payload, SECRET_KEY, algorithm='HS256')
            req_user = {'email': email, 'name': name}
            cookie_settings = get_cookie_settings()
            resp = redirect(f"{frontend_url}/warehouse/request-delivery")
            resp.set_cookie('token', req_token, **cookie_settings)
            return resp

        if flow == 'admin':
            cookie_settings = get_cookie_settings()
            resp = redirect(f"{frontend_url}/admin/dashboard")
            resp.set_cookie('token', jwt_token, **cookie_settings)
            return resp

        # Default: User Flow - redirect to login with token and user parameters so frontend can restore session instantly
        encoded_user = quote(json.dumps(user_data, separators=(',', ':')))
        cookie_settings = get_cookie_settings()
        target_url = f"{frontend_url}/login?token={quote(jwt_token)}&user={encoded_user}"
        resp = redirect(target_url)
        resp.set_cookie('token', jwt_token, **cookie_settings)
        return resp

    except Exception as exc:
        logger.error(f"Google OAuth callback failed: {str(exc)}", exc_info=True)
        return redirect(f"{frontend_url}/?error=auth_error&details={quote(str(exc))}")


# ==============================================================================
# ADMIN: GENERAL MANAGEMENT
# ==============================================================================

@app.route('/api/settings', methods=['GET'])
@cache.cached(timeout=60)
def get_system_settings():
    """Retrieves public system settings."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM system_settings")
        settings_list = cursor.fetchall()
        settings = {row['key']: row['value'] for row in settings_list}
        conn.close()
        return success_response(settings, "Settings retrieved")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/settings', methods=['POST'])
@token_required
@require_super_admin()
def update_system_settings():
    """Updates system settings (Super Admin only)."""
    data = request.get_json(silent=True) or {}
    try:
        conn = get_db()
        cursor = conn.cursor()

        terms_changed = False
        if 'terms_and_conditions_content' in data:
            new_terms = str(data.get('terms_and_conditions_content') or '')
            cursor.execute("SELECT value FROM system_settings WHERE key = ?", ('terms_and_conditions_content',))
            old_row = cursor.fetchone()
            old_terms = old_row['value'] if old_row else ''
            if new_terms != (old_terms or ''):
                terms_changed = True

        for key, value in data.items():
            cursor.execute(
                '''
                INSERT INTO system_settings (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                ''',
                (key, str(value)),
            )

        if terms_changed:
            cursor.execute("SELECT value FROM system_settings WHERE key = ?", ('terms_and_conditions_version',))
            row = cursor.fetchone()
            current_ver = 1
            try:
                current_ver = int(row['value']) if row and row['value'] is not None else 1
            except Exception:
                current_ver = 1
            new_ver = current_ver + 1
            cursor.execute(
                '''
                INSERT INTO system_settings (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                ''',
                ('terms_and_conditions_version', str(new_ver)),
            )
            cursor.execute(
                '''
                INSERT INTO system_settings (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                ''',
                ('terms_and_conditions_updated_at', datetime.datetime.utcnow().isoformat()),
            )

        conn.commit()
        conn.close()
        log_admin_action(
            request.user.get('user_id'),
            "settings_updated",
            "system",
            request.user.get('user_id'),
        )
        return success_response(None, "Settings updated successfully")
    except Exception as e:
        return error_response(str(e), 500)


# --- Vendor (warehouse) Settlements & Payouts ---
# Amazon-style: customer pays the platform; warehouses are settled after the
# return window minus commission (backend/settlement.py). These endpoints give
# admins the platform-side view: commission earned, per-warehouse wallets,
# settlement records and payout-request approvals.

@app.route('/api/admin/vendor/overview', methods=['GET'])
@token_required
@require_admin()
def admin_vendor_overview():
    """Platform-side settlement overview: commission rate, totals, per-warehouse
    wallet/earnings and payout request summaries."""
    try:
        from settlement import get_commission_rate, get_settlement_window_days
        conn = get_db()
        cursor = conn.cursor()
        commission_rate = get_commission_rate(conn=conn)
        window_days = get_settlement_window_days(conn=conn)

        totals = cursor.execute('''
            SELECT
                COALESCE(SUM(CASE WHEN status = 'settled' THEN net_amount END), 0) as settled_amount,
                COALESCE(SUM(CASE WHEN status = 'settled' THEN commission_amount END), 0) as commission_earned,
                COALESCE(SUM(CASE WHEN status = 'pending' THEN net_amount END), 0) as pending_amount,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
                COUNT(CASE WHEN status = 'settled' THEN 1 END) as settled_count,
                COUNT(CASE WHEN status = 'void' THEN 1 END) as voided_count
            FROM vendor_settlements
        ''').fetchone()

        warehouses = cursor.execute('''
            SELECT
                w.id, w.warehouse_name, w.email, w.owner_name,
                COALESCE(vw.balance, 0) as wallet_balance,
                COALESCE(vw.lifetime_earnings, 0) as lifetime_earnings,
                (SELECT COUNT(*) FROM vendor_settlements vs WHERE vs.warehouse_id = w.id AND vs.status = 'pending') as pending_settlements,
                (SELECT COALESCE(SUM(vs.net_amount), 0) FROM vendor_settlements vs WHERE vs.warehouse_id = w.id AND vs.status = 'pending') as pending_settlements_amount,
                (SELECT COALESCE(SUM(vs.net_amount), 0) FROM vendor_settlements vs WHERE vs.warehouse_id = w.id AND vs.status = 'settled') as settled_amount
            FROM warehouses w
            LEFT JOIN vendor_wallets vw ON vw.warehouse_id = w.id
            WHERE w.account_status = 'active'
            ORDER BY w.warehouse_name ASC
        ''').fetchall()

        payout_rows = cursor.execute('''
            SELECT vp.*, w.warehouse_name, w.email
            FROM vendor_payouts vp
            JOIN warehouses w ON w.id = vp.warehouse_id
            ORDER BY vp.created_at DESC
            LIMIT 20
        ''').fetchall()

        conn.close()
        return success_response({
            'commission_rate': commission_rate,
            'settlement_window_days': window_days,
            'totals': {
                'settled_amount': round(float(totals['settled_amount']), 2),
                'commission_earned': round(float(totals['commission_earned']), 2),
                'pending_amount': round(float(totals['pending_amount']), 2),
                'pending_count': int(totals['pending_count'] or 0),
                'settled_count': int(totals['settled_count'] or 0),
                'voided_count': int(totals['voided_count'] or 0),
            },
            'warehouses': [dict(r) for r in warehouses],
            'recent_payouts': [dict(r) for r in payout_rows],
        }, "Vendor settlement overview")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/vendor/settlements', methods=['GET'])
@token_required
@require_admin()
def admin_vendor_settlements():
    """Settlement records with optional warehouse_id / status filters."""
    try:
        warehouse_id = request.args.get('warehouse_id', type=int)
        status = request.args.get('status')
        limit = min(request.args.get('limit', type=int) or 100, 500)
        conn = get_db()
        cursor = conn.cursor()
        query = '''
            SELECT vs.*, w.warehouse_name, o.order_number, o.total_amount as order_total,
                   o.order_status, o.created_at as order_created_at
            FROM vendor_settlements vs
            JOIN warehouses w ON w.id = vs.warehouse_id
            LEFT JOIN orders o ON o.id = vs.order_id
            WHERE 1=1
        '''
        params = []
        if warehouse_id:
            query += " AND vs.warehouse_id = ?"
            params.append(warehouse_id)
        if status:
            query += " AND vs.status = ?"
            params.append(status)
        query += " ORDER BY vs.created_at DESC LIMIT ?"
        params.append(limit)
        rows = cursor.execute(query, params).fetchall()
        conn.close()
        return success_response([dict(r) for r in rows], "Settlements retrieved")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/vendor/payouts', methods=['GET'])
@token_required
@require_admin()
def admin_vendor_payouts():
    """Payout requests with optional status filter."""
    try:
        status = request.args.get('status')
        conn = get_db()
        cursor = conn.cursor()
        query = '''
            SELECT vp.*, w.warehouse_name, w.email, w.owner_name, w.phone
            FROM vendor_payouts vp
            JOIN warehouses w ON w.id = vp.warehouse_id
            WHERE 1=1
        '''
        params = []
        if status:
            query += " AND vp.status = ?"
            params.append(status)
        query += " ORDER BY vp.created_at DESC LIMIT 200"
        rows = cursor.execute(query, params).fetchall()
        conn.close()
        return success_response([dict(r) for r in rows], "Payouts retrieved")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/vendor/payouts/<int:payout_id>/approve', methods=['POST'])
@token_required
@require_admin()
def admin_vendor_payout_approve(payout_id):
    """Marks a payout request as paid (admin has transferred the money)."""
    try:
        from settlement import process_vendor_payout
        data = request.get_json(silent=True) or {}
        ok, message = process_vendor_payout(payout_id, 'paid', data.get('admin_note'))
        if not ok:
            return error_response(message, 400)
        try:
            log_admin_action(request.user.get('user_id'), "vendor_payout_approved", "vendor", payout_id)
        except Exception:
            pass
        return success_response(None, message)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/vendor/payouts/<int:payout_id>/reject', methods=['POST'])
@token_required
@require_admin()
def admin_vendor_payout_reject(payout_id):
    """Rejects a payout request and refunds the held amount to the wallet."""
    try:
        from settlement import process_vendor_payout
        data = request.get_json(silent=True) or {}
        ok, message = process_vendor_payout(payout_id, 'rejected', data.get('admin_note'))
        if not ok:
            return error_response(message, 400)
        try:
            log_admin_action(request.user.get('user_id'), "vendor_payout_rejected", "vendor", payout_id)
        except Exception:
            pass
        return success_response(None, message)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/vendor/commission', methods=['POST'])
@token_required
@require_super_admin()
def admin_vendor_set_commission():
    """Updates the uniform platform commission rate for warehouse settlements."""
    data = request.get_json(silent=True) or {}
    try:
        rate = float(data.get('commission_rate') or 0)
    except (TypeError, ValueError):
        return error_response("Invalid commission rate", 400)
    if rate < 0 or rate > 100:
        return error_response("Commission rate must be between 0 and 100", 400)
    try:
        conn = get_db()
        conn.execute(
            "INSERT INTO system_settings (key, value) VALUES ('vendor_commission_rate', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (str(rate),),
        )
        conn.commit()
        conn.close()
        try:
            log_admin_action(request.user.get('user_id'), "vendor_commission_updated", "system", None)
        except Exception:
            pass
        return success_response(None, f"Commission rate set to {rate}%")
    except Exception as e:
        return error_response(str(e), 500)


# --- Banner Management ---

@app.route('/api/banners', methods=['GET'])
@cache.cached(timeout=60)
def get_banners():
    """Retrieves active banners for the storefront."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM banners WHERE is_active = 1 ORDER BY created_at DESC")
        banners = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return success_response(banners, "Banners retrieved")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/banners', methods=['POST'])
@token_required
@require_admin()
def update_banner():
    """Adds or updates a banner (Admin only)."""
    data = request.get_json(silent=True) or {}
    title = data.get('title')
    if not title:
        return error_response("Title is required", 400)

    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # If ID is provided, update, otherwise insert
        banner_id = data.get('id')
        overlay_opacity = data.get('overlay_opacity', 0.5)
        
        if banner_id:
            cursor.execute(
                '''
                UPDATE banners 
                SET title=?, subtitle=?, cta_text=?, image_url=?, badge_text=?, gradient=?, link_url=?, is_active=?, overlay_opacity=?
                WHERE id=?
                ''',
                (
                    title, data.get('subtitle'), data.get('cta_text'), 
                    data.get('image_url'), data.get('badge_text'), data.get('gradient'),
                    data.get('link_url'), data.get('is_active', 1), overlay_opacity, banner_id
                )
            )
        else:
            cursor.execute(
                '''
                INSERT INTO banners (title, subtitle, cta_text, image_url, badge_text, gradient, link_url, overlay_opacity)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''',
                (
                    title, data.get('subtitle'), data.get('cta_text'), 
                    data.get('image_url'), data.get('badge_text'), data.get('gradient'),
                    data.get('link_url'), overlay_opacity
                )
            )
        
        conn.commit()
        conn.close()
        return success_response(None, "Banner updated successfully")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/banners/<int:banner_id>', methods=['DELETE'])
@token_required
@require_admin()
def delete_banner(banner_id):
    """Deletes a specific banner (Admin only)."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM banners WHERE id = ?", (banner_id,))
        conn.commit()
        conn.close()
        return success_response(None, "Banner deleted successfully")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/list', methods=['GET'])
@token_required
@require_admin()
@require_permission("manage_admins")
def list_admin_users():
    """Lists all registered administrators."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            '''
            SELECT a.id, a.user_id, a.role, a.created_at, u.name, u.email, u.profile_image
            FROM admins a
            JOIN users u ON u.id = a.user_id
            ORDER BY a.created_at DESC
            '''
        )
        admins = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(admins), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/create', methods=['POST'])
@token_required
@require_super_admin()
def create_admin_user():
    """Promotes a user to an administrative role."""
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    role = normalize_role(data.get('role'))

    if not email:
        return error_response("email is required", 400)
    if role not in ADMIN_ROLES:
        return error_response(f"role must be one of: {', '.join(sorted(ADMIN_ROLES))}", 400)

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT id, role FROM users WHERE LOWER(email) = ?", (email,))
        user = cursor.fetchone()
        if not user:
            conn.close()
            return error_response("User not found. Ask the user to login first.", 404)

        cursor.execute("UPDATE users SET role = ? WHERE id = ?", (role, user['id']))
        upsert_admin_record(cursor, user['id'], role)
        ensure_default_admin_permissions(cursor, user['id'], role=role)
        conn.commit()
        conn.close()
        log_admin_action(
            request.user.get('user_id'),
            "admin_created",
            "admin",
            user['id'],
        )
        log_admin_event(
            request.user.get('user_id'),
            "admin_created_admin",
            "admin",
            user['id'],
            f"Created or elevated admin account for {email} with role {role}",
        )
        run_admin_anomaly_check(request.user.get('user_id'), "admin_created_admin")
        return jsonify({
            "message": "Admin user updated successfully",
            "admin_id": user['id'],
            "email": email,
            "role": role,
        }), 201
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/remove', methods=['DELETE'])
@token_required
@require_super_admin()
def remove_admin_user():
    """Revokes administrative access from a user."""
    data = request.get_json(silent=True) or {}
    admin_id = data.get('admin_id')
    email = (data.get('email') or '').strip().lower()

    if not admin_id and not email:
        return error_response("admin_id or email is required", 400)

    try:
        conn = get_db()
        cursor = conn.cursor()

        if admin_id:
            cursor.execute("SELECT id, email, role FROM users WHERE id = ?", (admin_id,))
        else:
            cursor.execute("SELECT id, email, role FROM users WHERE LOWER(email) = ?", (email,))
        user = cursor.fetchone()

        if not user:
            conn.close()
            return error_response("Admin user not found", 404)
        if user['role'] == 'super_admin':
            conn.close()
            return error_response("Cannot remove super_admin role", 400)

        cursor.execute("UPDATE users SET role = 'user' WHERE id = ?", (user['id'],))
        remove_admin_record(cursor, user['id'])
        cursor.execute("DELETE FROM admin_permissions WHERE admin_id = ?", (user['id'],))
        conn.commit()
        conn.close()
        log_admin_event(
            request.user.get('user_id'),
            "admin_removed_admin",
            "admin",
            user['id'],
            f"Removed admin access for {user['email']}",
        )
        run_admin_anomaly_check(request.user.get('user_id'), "admin_removed_admin")
        return jsonify({
            "message": "Admin removed successfully",
            "admin_id": user['id'],
            "email": user['email'],
            "role": "user",
        }), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/admins', methods=['GET'])
@token_required
@require_super_admin()
@require_permission("manage_admins")
def list_admins_v2():
    """Lists all admin accounts with status and last login (AdminAdmins page)."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT a.id, a.user_id, a.role, COALESCE(a.status, 'active') AS status,
                   a.created_at, u.name, u.email, u.profile_image, u.last_login
            FROM admins a
            JOIN users u ON u.id = a.user_id
            ORDER BY a.created_at DESC
        ''')
        admins = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(admins), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/admins', methods=['POST'])
@token_required
@require_super_admin()
@require_permission("manage_admins")
def create_admin_v2():
    """Promotes a user to an admin role (name, email, role)."""
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    name = (data.get('name') or '').strip()
    role = normalize_role(data.get('role'))

    if not email:
        return error_response("email is required", 400)
    if role not in ADMIN_ROLES:
        return error_response(f"role must be one of: {', '.join(sorted(ADMIN_ROLES))}", 400)

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT id, role FROM users WHERE LOWER(email) = ?", (email,))
        user = cursor.fetchone()
        if not user:
            conn.close()
            return error_response("User not found. Ask the user to login first.", 404)

        cursor.execute("UPDATE users SET role = ?, name = COALESCE(?, name) WHERE id = ?", (role, name or None, user['id']))
        upsert_admin_record(cursor, user['id'], role)
        ensure_default_admin_permissions(cursor, user['id'], role=role)
        conn.commit()
        conn.close()
        log_admin_action(request.user.get('user_id'), "admin_created", "admin", user['id'])
        log_admin_event(
            request.user.get('user_id'),
            "admin_created_admin",
            "admin",
            user['id'],
            f"Created or elevated admin account for {email} with role {role}",
        )
        run_admin_anomaly_check(request.user.get('user_id'), "admin_created_admin")
        return jsonify({
            "message": "Admin user updated successfully",
            "admin_id": user['id'],
            "email": email,
            "role": role,
        }), 201
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/admins/<int:admin_id>', methods=['PUT'])
@token_required
@require_super_admin()
@require_permission("manage_admins")
def update_admin_v2(admin_id):
    """Updates an admin's display name and/or role (admin_id = admins.id)."""
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    role = normalize_role(data.get('role'))
    if role not in ADMIN_ROLES:
        return error_response(f"role must be one of: {', '.join(sorted(ADMIN_ROLES))}", 400)
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT user_id, role AS old_role FROM admins WHERE id = ?", (admin_id,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            return error_response("Admin not found", 404)
        user_id = row['user_id']
        # A super_admin must not be able to demote themselves (would lock the
        # panel out of super-admin control).
        if row['old_role'] == 'super_admin' and user_id == request.user.get('user_id') and role != 'super_admin':
            conn.close()
            return error_response("You cannot change your own super_admin role", 400)
        if name:
            cursor.execute("UPDATE users SET name = ? WHERE id = ?", (name, user_id))
        cursor.execute("UPDATE admins SET role = ? WHERE id = ?", (role, admin_id))
        cursor.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
        # Revoke permissions the new role no longer carries (least privilege),
        # then ensure the new role's defaults are present.
        allowed_perms = ROLE_DEFAULT_PERMISSIONS.get(role) or []
        placeholders = ','.join('?' * len(allowed_perms)) if allowed_perms else "''"
        cursor.execute(
            f"DELETE FROM admin_permissions WHERE admin_id = ? AND permission NOT IN ({placeholders})",
            [user_id] + (allowed_perms if allowed_perms else []),
        )
        ensure_default_admin_permissions(cursor, user_id, role=role)
        conn.commit()
        conn.close()
        log_admin_action(request.user.get('user_id'), "admin_updated", "admin", user_id)
        return jsonify({"message": "Admin updated successfully", "role": role}), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/admins/<int:admin_id>/status', methods=['PATCH'])
@token_required
@require_super_admin()
@require_permission("manage_admins")
def update_admin_status_v2(admin_id):
    """Enables / disables an admin account. Disabled admins cannot log in."""
    data = request.get_json(silent=True) or {}
    status = (data.get('status') or '').strip().lower()
    if status not in ('active', 'disabled'):
        return error_response("status must be 'active' or 'disabled'", 400)
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT user_id, role FROM admins WHERE id = ?", (admin_id,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            return error_response("Admin not found", 404)
        # Prevent a super_admin from disabling their own account (would lock them out).
        if row['role'] == 'super_admin' and status == 'disabled' and row['user_id'] == request.user.get('user_id'):
            conn.close()
            return error_response("You cannot disable your own account", 400)
        cursor.execute("UPDATE admins SET status = ? WHERE id = ?", (status, admin_id))
        conn.commit()
        conn.close()
        log_admin_action(request.user.get('user_id'), "admin_status_changed", "admin", row['user_id'])
        return jsonify({"message": f"Admin {status}", "status": status}), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/admins/<int:admin_id>', methods=['DELETE'])
@token_required
@require_super_admin()
@require_permission("manage_admins")
def delete_admin_v2(admin_id):
    """Revokes admin access (admin_id = admins.id)."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT user_id, role FROM admins WHERE id = ?", (admin_id,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            return error_response("Admin not found", 404)
        user_id = row['user_id']
        if row['role'] == 'super_admin' and user_id == request.user.get('user_id'):
            conn.close()
            return error_response("You cannot remove your own account", 400)
        cursor.execute("UPDATE users SET role = 'user' WHERE id = ?", (user_id,))
        remove_admin_record(cursor, user_id)
        cursor.execute("DELETE FROM admin_permissions WHERE admin_id = ?", (user_id,))
        conn.commit()
        conn.close()
        log_admin_action(request.user.get('user_id'), "admin_removed", "admin", user_id)
        return jsonify({"message": "Admin removed successfully"}), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/activity-logs', methods=['GET'])
@token_required
@require_admin(['super_admin', 'admin'])
def get_activity_logs():
    """Retrieves activity logs for administrators."""
    admin_id = request.args.get('admin_id', type=int)
    action = (request.args.get('action') or '').strip()
    try:
        conn = get_db()
        cursor = conn.cursor()

        query = '''
            SELECT al.id, al.admin_id, al.action, al.entity_type, al.entity_id, al.timestamp,
                   u.name as admin_name, u.email as admin_email
            FROM activity_logs al
            JOIN users u ON u.id = al.admin_id
            WHERE 1=1
        '''
        params = []
        if admin_id:
            query += " AND al.admin_id = ?"
            params.append(admin_id)
        if action:
            query += " AND al.action = ?"
            params.append(action)
        query += " ORDER BY al.timestamp DESC LIMIT 500"

        cursor.execute(query, tuple(params))
        logs = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            '''
            SELECT DISTINCT u.id as admin_id, u.name, u.email
            FROM users u
            JOIN activity_logs al ON al.admin_id = u.id
            ORDER BY u.email ASC
            '''
        )
        admins = [dict(row) for row in cursor.fetchall()]

        cursor.execute("SELECT DISTINCT action FROM activity_logs ORDER BY action ASC")
        actions = [row['action'] for row in cursor.fetchall()]

        conn.close()
        return jsonify({"logs": logs, "admins": admins, "actions": actions}), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/audit-logs', methods=['GET'])
@token_required
@require_super_admin()
def get_admin_audit_logs():
    """Retrieves security-focused audit logs for admin actions."""
    admin_id = request.args.get('admin', type=int)
    action_type = (request.args.get('action_type') or '').strip()
    date_value = (request.args.get('date') or '').strip()
    search = (request.args.get('q') or '').strip()

    try:
        conn = get_db()
        cursor = conn.cursor()
        query = '''
            SELECT l.id, l.admin_id, l.action_type, l.target_entity, l.target_id, l.description,
                   l.ip_address, l.timestamp, u.name as admin_name, u.email as admin_email
            FROM admin_audit_logs l
            JOIN users u ON u.id = l.admin_id
            WHERE 1=1
        '''
        params = []
        if admin_id:
            query += " AND l.admin_id = ?"
            params.append(admin_id)
        if action_type:
            query += " AND l.action_type = ?"
            params.append(action_type)
        if date_value:
            query += " AND DATE(l.timestamp) = DATE(?)"
            params.append(date_value)
        if search:
            query += " AND (l.description LIKE ? OR l.target_entity LIKE ?)"
            pattern = f"%{search}%"
            params.extend([pattern, pattern])
        query += " ORDER BY l.timestamp DESC LIMIT 1000"

        cursor.execute(query, tuple(params))
        logs = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            '''
            SELECT DISTINCT u.id as admin_id, u.name, u.email
            FROM users u
            JOIN admin_audit_logs l ON l.admin_id = u.id
            ORDER BY u.email ASC
            '''
        )
        admins = [dict(row) for row in cursor.fetchall()]

        cursor.execute("SELECT DISTINCT action_type FROM admin_audit_logs ORDER BY action_type ASC")
        action_types = [row['action_type'] for row in cursor.fetchall()]

        conn.close()
        return jsonify({
            "logs": logs,
            "admins": admins,
            "action_types": action_types,
        }), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/audit-logs/<int:admin_id>', methods=['GET'])
@token_required
@require_super_admin()
def get_admin_audit_logs_by_admin(admin_id):
    """Retrieves audit logs for a specific administrator."""
    action_type = (request.args.get('action_type') or '').strip()
    date_value = (request.args.get('date') or '').strip()
    search = (request.args.get('q') or '').strip()
    try:
        conn = get_db()
        cursor = conn.cursor()
        query = '''
            SELECT l.id, l.admin_id, l.action_type, l.target_entity, l.target_id, l.description,
                   l.ip_address, l.timestamp, u.name as admin_name, u.email as admin_email
            FROM admin_audit_logs l
            JOIN users u ON u.id = l.admin_id
            WHERE l.admin_id = ?
        '''
        params = [admin_id]
        if action_type:
            query += " AND l.action_type = ?"
            params.append(action_type)
        if date_value:
            query += " AND DATE(l.timestamp) = DATE(?)"
            params.append(date_value)
        if search:
            query += " AND (l.description LIKE ? OR l.target_entity LIKE ?)"
            pattern = f"%{search}%"
            params.extend([pattern, pattern])
        query += " ORDER BY l.timestamp DESC LIMIT 1000"

        cursor.execute(query, tuple(params))
        logs = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({"logs": logs, "admin_id": admin_id}), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/audit-logs/clear', methods=['DELETE'])
@token_required
@require_super_admin()
def clear_admin_audit_logs():
    """Wipes all audit logs (Super Admin only)."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM admin_audit_logs")
        conn.commit()
        conn.close()
        return success_response(None, "Audit logs cleared", 200)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/security-alerts', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
@cache.cached(timeout=20, query_string=True)
def get_admin_security_alerts():
    """Retrieves high-level security overview and active alerts."""
    try:
        overview = get_security_overview(get_blocked_ips())
        return jsonify(overview), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/permissions', methods=['GET'])
@token_required
@require_admin()
@require_permission("manage_admins")
def list_admin_permissions():
    """Lists granular permissions for administrators."""
    admin_user_id = request.args.get('admin_id', type=int)
    try:
        conn = get_db()
        cursor = conn.cursor()
        if admin_user_id:
            cursor.execute(
                "SELECT permission FROM admin_permissions WHERE admin_id = ? ORDER BY permission ASC",
                (admin_user_id,),
            )
            permissions = [row['permission'] for row in cursor.fetchall()]
            conn.close()
            return jsonify({
                "admin_id": admin_user_id,
                "permissions": permissions,
                "available_permissions": AVAILABLE_ADMIN_PERMISSIONS,
            }), 200

        cursor.execute(
            '''
            SELECT ap.admin_id, u.email, u.name, ap.permission
            FROM admin_permissions ap
            JOIN users u ON u.id = ap.admin_id
            ORDER BY u.email ASC, ap.permission ASC
            '''
        )
        rows = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({
            "items": rows,
            "available_permissions": AVAILABLE_ADMIN_PERMISSIONS,
        }), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/permissions', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_admins")
def assign_admin_permission():
    """Assigns a new granular permission to an administrator."""
    data = request.get_json(silent=True) or {}
    admin_user_id = data.get('admin_id')
    permission = (data.get('permission') or '').strip()
    if not admin_user_id or not permission:
        return error_response("admin_id and permission are required", 400)
    if permission not in AVAILABLE_ADMIN_PERMISSIONS:
        return error_response("Invalid permission", 400)

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT role FROM users WHERE id = ?", (admin_user_id,))
        user = cursor.fetchone()
        if not user or normalize_role(user['role']) not in ADMIN_ROLES:
            conn.close()
            return error_response("Target user is not an admin", 400)

        cursor.execute(
            "INSERT OR IGNORE INTO admin_permissions (admin_id, permission) VALUES (?, ?)",
            (admin_user_id, permission),
        )
        conn.commit()
        conn.close()
        return success_response(None, "Permission assigned", 201)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/permissions', methods=['DELETE'])
@token_required
@require_admin()
@require_permission("manage_admins")
def remove_admin_permission():
    """Removes a granular permission from an administrator."""
    data = request.get_json(silent=True) or {}
    admin_user_id = data.get('admin_id')
    permission = (data.get('permission') or '').strip()
    if not admin_user_id or not permission:
        return error_response("admin_id and permission are required", 400)

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT role FROM users WHERE id = ?", (admin_user_id,))
        user = cursor.fetchone()
        if not user:
            conn.close()
            return error_response("Admin user not found", 404)
        if normalize_role(user['role']) == 'super_admin' and permission == 'manage_admins':
            conn.close()
            return error_response("Cannot remove manage_admins from super_admin", 400)

        cursor.execute(
            "DELETE FROM admin_permissions WHERE admin_id = ? AND permission = ?",
            (admin_user_id, permission),
        )
        conn.commit()
        conn.close()
        return success_response(None, "Permission removed", 200)
    except Exception as e:
        return error_response(str(e), 500)


# ==============================================================================

# ==============================================================================
# STOREFRONT: PRODUCTS & CATEGORIES
# ==============================================================================

@app.route('/api/categories', methods=['GET'])
@cache.cached(timeout=60)
def get_categories():
    """Retrieves all product categories."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM categories ORDER BY name ASC")
    categories = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return success_response(categories, "Categories retrieved")


@app.route('/api/device-models', methods=['GET'])
def get_device_models():
    """Retrieves active device models for sticker customization."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, brand, type, status
            FROM device_models
            WHERE status = 'active'
            ORDER BY brand ASC, name ASC
        """)
        models = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return success_response(models, "Device models retrieved")
    except Exception as e:
        return error_response(str(e), 500)


def table_has_column(cursor, table_name, column_name):
    try:
        cursor.execute(f"PRAGMA table_info({table_name})")
        return any(row[1] == column_name for row in cursor.fetchall())
    except Exception as e:
        print(f"DEBUG: Failed to inspect {table_name}.{column_name}: {e}")
        return False



@app.route('/api/cart', methods=['GET'])
def get_cart():
    """Retrieves the user's server-side cart, supporting both token and session_id."""
    try:
        user_id = None
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
            try:
                import jwt
                decoded = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
                user_id = decoded.get('user_id')
            except Exception as e:
                print(f"DEBUG: JWT decode failed: {e}")
                pass
        
        session_id = request.args.get('session_id')
        
        if not user_id and not session_id:
            return success_response([], "Empty cart (no user or session)")

        conn = get_db()
        cursor = conn.cursor()
        
        # MIGRATION: If we have both, move session items to user
        if user_id and session_id:
            cursor.execute("UPDATE cart SET user_id = ?, session_id = NULL WHERE session_id = ? AND user_id IS NULL", (user_id, session_id))
            conn.commit()
        
        if user_id:
            cursor.execute("""
                SELECT c.*, p.name, p.price as base_price, p.images as base_images, p.category, p.stock as base_stock,
                       pv.name as variant_name, pv.price as variant_price, pv.images as variant_images, pv.stock as variant_stock,
                       pv.options as variant_options
                FROM cart c 
                JOIN products p ON c.product_id = p.id 
                LEFT JOIN product_variants pv ON c.variant_id = pv.id
                WHERE c.user_id = ?
            """, (user_id,))
        else:
            cursor.execute("""
                SELECT c.*, p.name, p.price as base_price, p.images as base_images, p.category, p.stock as base_stock,
                       pv.name as variant_name, pv.price as variant_price, pv.images as variant_images, pv.stock as variant_stock,
                       pv.options as variant_options
                FROM cart c 
                JOIN products p ON c.product_id = p.id 
                LEFT JOIN product_variants pv ON c.variant_id = pv.id
                WHERE c.session_id = ?
            """, (session_id,))
            
        items = []
        for row in cursor.fetchall():
            item = dict(row)
            if item.get('variant_id'):
                item['name'] = item['variant_name'] or item['name']
                item['price'] = item['variant_price'] if item['variant_price'] is not None else item['base_price']
                img_val = item['variant_images'] or item['base_images']
                item['stock'] = item['variant_stock'] if item['variant_stock'] is not None else item['base_stock']
                # Parse the option map so the UI can show e.g. "Size: M · Color: Red"
                if item.get('variant_options'):
                    try:
                        item['variant_options'] = json.loads(item['variant_options'])
                    except Exception:
                        item['variant_options'] = {}
                else:
                    item['variant_options'] = {}
            else:
                item['price'] = item['base_price']
                img_val = item['base_images']
                item['stock'] = item['base_stock']
            
            if img_val and isinstance(img_val, str):
                try: item['images'] = json.loads(img_val)
                except: item['images'] = [img_val]
            else:
                item['images'] = img_val or []
                
            items.append(item)

        conn.close()
        return success_response(items, "Cart retrieved")
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/cart', methods=['POST'])
def update_server_cart():
    """Syncs the cart with the server, supporting both logged-in users and guests."""
    data = request.json
    # Attempt to get user_id from token, otherwise use session_id
    user_id = None
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        token = auth_header.split(' ')[1]
        try:
            import jwt
            decoded = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
            user_id = decoded.get('user_id')
        except Exception as e:
            print(f"DEBUG: update_server_cart JWT decode failed: {e}")
            pass

    session_id = data.get('session_id')
    action = data.get('action', 'add')
    variant_id = data.get('variant_id')

    # Allow clear_cart without a product_id
    product_id = None
    if action != 'clear_cart':
        try:
            product_id = int(data.get('product_id'))
        except (TypeError, ValueError):
            return error_response("Invalid Product ID", 400)
        
    try:
        quantity = int(data.get('quantity', 1))
    except (TypeError, ValueError):
        quantity = 1

    if not user_id and not session_id:
        return error_response("User ID or Session ID required", 400)

    try:
        conn = get_db()
        cursor = conn.cursor()
        cart_has_updated_at = table_has_column(cursor, 'cart', 'updated_at')
        
        # MIGRATION: Before any update, ensure session items are moved to user
        if user_id and session_id:
            cursor.execute("UPDATE cart SET user_id = ?, session_id = NULL WHERE session_id = ? AND user_id IS NULL", (user_id, session_id))
            conn.commit()
            
        # 1. AUTO-RELEASE: Clear cart items older than 30 mins
        if cart_has_updated_at:
            cursor.execute("DELETE FROM cart WHERE updated_at < datetime('now', '-30 minutes')")
        
        # Build where clause based on what we have
        where_clause = "user_id = ?" if user_id else "session_id = ?"
        id_val = user_id if user_id else session_id

        if action == 'clear_cart':
            cursor.execute(f"DELETE FROM cart WHERE {where_clause}", (id_val,))
            conn.commit()
            conn.close()
            return success_response(None, "Cart cleared")

        # Stock Validation
        if variant_id:
            cursor.execute("SELECT stock FROM product_variants WHERE id = ? AND product_id = ? AND status = 'active'", (variant_id, product_id))
            variant = cursor.fetchone()
            if not variant:
                return error_response("Variant not found or inactive for this product", 404)
            available = variant['stock'] if variant else 0
        else:
            cursor.execute('''
                SELECT name, stock as total_stock
                FROM products
                WHERE id = ?
            ''', (product_id,))
            product = cursor.fetchone()
            if not product:
                return error_response("Product not found", 404)
            available = max(0, int(product['total_stock'] or 0))

        cart_where = f"{where_clause} AND product_id = ?"
        cart_params = [id_val, product_id]
        if variant_id:
            cart_where += " AND variant_id = ?"
            cart_params.append(variant_id)
        else:
            cart_where += " AND variant_id IS NULL"

        if action == 'remove':
            cursor.execute(f"DELETE FROM cart WHERE {cart_where}", cart_params)
        elif action == 'add':
            cursor.execute(f"SELECT id, quantity FROM cart WHERE {cart_where}", cart_params)
            existing = cursor.fetchone()
            new_qty = (existing['quantity'] if existing else 0) + quantity
            
            if new_qty > available:
                return error_response(f"Only {available} items available in total", 400)
                
            if existing:
                if cart_has_updated_at:
                    cursor.execute("UPDATE cart SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (new_qty, existing['id']))
                else:
                    cursor.execute("UPDATE cart SET quantity = ? WHERE id = ?", (new_qty, existing['id']))
            else:
                if user_id:
                    cursor.execute("INSERT INTO cart (user_id, product_id, variant_id, quantity) VALUES (?, ?, ?, ?)", (user_id, product_id, variant_id, new_qty))
                else:
                    cursor.execute("INSERT INTO cart (session_id, product_id, variant_id, quantity) VALUES (?, ?, ?, ?)", (session_id, product_id, variant_id, new_qty))
        elif action == 'update':
            if quantity > available:
                return error_response(f"Only {available} items available in total", 400)
            
            if cart_has_updated_at:
                cursor.execute(f"UPDATE cart SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE {cart_where}", [quantity] + cart_params)
            else:
                cursor.execute(f"UPDATE cart SET quantity = ? WHERE {cart_where}", [quantity] + cart_params)
            
        conn.commit()
        conn.close()
        return success_response(None, "Cart updated")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/products/<int:product_id>/notify', methods=['POST'])
@limiter.limit("5 per minute")
def register_product_notification(product_id):
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    user_id = data.get('user_id') # Optional
    
    if not email or '@' not in email or '.' not in email:
        return error_response("Valid email is required", 400)
        
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Get product name
        cursor.execute("SELECT name FROM products WHERE id = ?", (product_id,))
        product = cursor.fetchone()
        if not product:
            return error_response("Product not found", 404)
            
        # Check if already subscribed to prevent spamming duplicate confirmation emails
        cursor.execute("""
            SELECT id FROM product_notifications 
            WHERE email = ? AND product_id = ?
        """, (email, product_id))
        existing = cursor.fetchone()

        if existing:
            return jsonify({"success": True, "message": "Notification alert active!"})

        # Register notification
        cursor.execute("""
            INSERT INTO product_notifications (user_id, email, product_id)
            VALUES (?, ?, ?)
        """, (user_id, email, product_id))
        
        # Send confirmation email
        try:
            send_availability_subscription_confirmation(email, product['name'])
        except Exception as mail_err:
            logger.error(f"Failed to send restock confirmation email to {email}: {mail_err}")
        
        # Create in-app notification if user is logged in
        if user_id:
            cursor.execute("""
                INSERT INTO notifications (user_id, title, message, type)
                VALUES (?, ?, ?, ?)
            """, (user_id, "Alert Activated", f"We will notify you when {product['name']} is available.", "system"))
            
        conn.commit()
        return jsonify({"success": True, "message": "Notification alert active!"})
    except Exception as e:
        conn.rollback()
        return error_response(str(e), 500)
    finally:
        conn.close()

@app.route('/api/wishlist', methods=['GET'])
@token_required
def get_wishlist():
    """Retrieves the user's wishlist."""
    try:
        user_id = request.user.get('user_id')
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT w.created_at, w.variant_id, p.id, p.name, p.price, p.images, p.category, p.stock,
                   pv.name as variant_name, pv.price as variant_price, pv.images as variant_images, pv.stock as variant_stock,
                   pv.options as variant_options
            FROM wishlist w 
            JOIN products p ON w.product_id = p.id 
            LEFT JOIN product_variants pv ON w.variant_id = pv.id
            WHERE w.user_id = ?
            ORDER BY w.created_at DESC
        """, (user_id,))
        items = []
        for row in cursor.fetchall():
            item = normalize_product_row(row)
            if item.get('variant_id'):
                item['name'] = item['variant_name'] or item['name']
                item['price'] = item['variant_price'] if item['variant_price'] is not None else item['price']
                if item.get('variant_images'):
                    item['images'] = item['variant_images']
                if item.get('variant_stock') is not None:
                    item['stock'] = item['variant_stock']
                if item.get('variant_options'):
                    try:
                        item['variant_options'] = json.loads(item['variant_options'])
                    except Exception:
                        item['variant_options'] = {}
            items.append(item)
        conn.close()
        return success_response(items, "Wishlist retrieved")
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/wishlist', methods=['POST'])
@token_required
def add_to_wishlist():
    """Adds a product (or variant) to the user's wishlist."""
    data = request.json
    product_id = data.get('product_id')
    variant_id = data.get('variant_id')
    if not product_id:
        return error_response("Product ID required", 400)
    
    try:
        user_id = request.user.get('user_id')
        conn = get_db()
        cursor = conn.cursor()
        
        # Validate variant exists if provided
        if variant_id:
            cursor.execute("SELECT id FROM product_variants WHERE id = ? AND product_id = ?", (variant_id, product_id))
            if not cursor.fetchone():
                return error_response("Variant not found for this product", 404)
        
        cursor.execute("INSERT OR IGNORE INTO wishlist (user_id, product_id, variant_id) VALUES (?, ?, ?)", (user_id, product_id, variant_id))
        conn.commit()
        conn.close()
        return success_response(None, "Product added to wishlist")
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/wishlist/<int:product_id>', methods=['DELETE'])
@token_required
def remove_from_wishlist(product_id):
    """Removes a product (or variant) from the user's wishlist."""
    variant_id = request.args.get('variant_id', type=int)
    try:
        user_id = request.user.get('user_id')
        conn = get_db()
        cursor = conn.cursor()
        if variant_id:
            cursor.execute("DELETE FROM wishlist WHERE user_id = ? AND product_id = ? AND variant_id = ?", (user_id, product_id, variant_id))
        else:
            cursor.execute("DELETE FROM wishlist WHERE user_id = ? AND product_id = ? AND variant_id IS NULL", (user_id, product_id))
        conn.commit()
        conn.close()
        return success_response(None, "Product removed from wishlist")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/brands', methods=['GET'])
def get_brands():
    """Retrieves all product brands."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM brands ORDER BY name ASC")
    brands = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return success_response(brands, "Brands retrieved")


@app.route('/api/brands', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_products")
def create_brand():
    """Creates a new brand."""
    data = request.get_json(silent=True) or {}
    name = data.get('name', '').strip()
    if not name:
        return error_response("Brand name is required", 400)
    
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO brands (name) VALUES (?)", (name,))
        conn.commit()
        new_id = cursor.lastrowid
        # Clear cache
        cache.delete('all_brands')
        return success_response({"id": new_id, "name": name}, "Brand created successfully", 201)
    except sqlite3.IntegrityError:
        return error_response("Brand already exists", 409)
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()


@app.route('/api/categories/<int:category_id>/products', methods=['GET'])
@cache.cached(timeout=30, query_string=True)
def get_category_products(category_id):
    """Retrieves all available products within a specific category."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM products WHERE status='available' AND category_id=? AND lifecycle_state IN ('live', 'coming_soon')", (category_id,))
        products = [normalize_product_row(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(products)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/products/search', methods=['GET'])
def search_products():
    """Search for products by name, category, or description."""
    query = request.args.get('q', '').strip()
    category_id = request.args.get('category_id')
    
    if not query and not category_id:
        return jsonify([])
    try:
        print(f"[DEBUG] search_products: query='{query}', category_id={category_id}")
        conn = get_db()
        cursor = conn.cursor()
        
        sql = """
            SELECT p.*, c.name as category_name,
                   COALESCE(c.device_customization_enabled, 0) as device_customization_enabled
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.status = 'available' AND p.lifecycle_state IN ('live', 'coming_soon')
        """
        params = []
        
        if query:
            search_pattern = f"%{query}%"
            sql += " AND (p.name LIKE ? OR c.name LIKE ? OR p.category LIKE ?)"
            params.extend([search_pattern, search_pattern, search_pattern])
            
        if category_id:
            sql += " AND p.category_id = ?"
            params.append(category_id)
            
        sql += " LIMIT 20"
        
        cursor.execute(sql, params)
        products = [normalize_product_row(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(products)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/products', methods=['GET'])
@cache.cached(timeout=60, query_string=True)
def get_products():
    """
    Get products with smart pagination and caching.
    Supports filtering by category and store availability.
    Now includes linked variant products (each variant is a separate product).
    """
    category = request.args.get('category')
    category_id = request.args.get('category_id')
    store_id = request.args.get('store_id', type=int)
    limit = request.args.get('limit', type=int) or 20
    page = request.args.get('page', type=int) or 1
    offset = request.args.get('offset', type=int)
    
    try:
        limit = max(1, min(int(limit), 100))
        if offset is None:
            page = max(1, page)
            offset = (page - 1) * limit
        else:
            offset = max(0, offset)
        
        conn = get_db()
        cursor = conn.cursor()
        
        if store_id:
            query = '''
                SELECT p.id, p.name, p.variant_group_id, p.variant_name, p.is_parent,
                       p.price,
                       p.images, p.category_id, p.category, 
                       p.delivery_time, p.return_policy, p.is_featured, p.prepaid_only, p.share_token, p.seo_slug,
                       p.has_variants,
                       wi.stock_quantity as physical_stock,
                       wi.stock_quantity as stock,
                       wi.reserved_stock as reserved_stock,
                       wi.stock_quantity as available_stock,
                       (SELECT COALESCE(SUM(quantity), 0) FROM cart WHERE product_id = p.id) as cart_reserved,
                       wi.low_stock_threshold, p.status,
                       c.name as category_name,
                       c.important_note as category_note,
                       c.return_policy as category_return_policy,
                       COALESCE(c.device_customization_enabled, 0) as device_customization_enabled,
                       COALESCE(AVG(r.rating), 0) as average_rating, 
                       COUNT(r.id) as total_reviews
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                INNER JOIN warehouse_inventory wi ON p.id = wi.product_id
                LEFT JOIN product_reviews r ON p.id = r.product_id
                WHERE p.status = 'available' AND wi.warehouse_id = ? AND p.lifecycle_state IN ('live', 'coming_soon')
            '''
            params = [store_id]
        else:
            query = '''
                SELECT p.id, p.name, p.variant_group_id, p.variant_name, p.is_parent,
                       p.price,
                       p.images, p.category_id, p.category, 
                       p.delivery_time,
                       p.stock,
                       p.return_policy, p.is_featured, p.prepaid_only, p.share_token, p.seo_slug,
                       p.has_variants,
                       0 as reserved_stock,
                       COALESCE((SELECT SUM(quantity) FROM cart WHERE product_id = p.id), 0) as cart_reserved,
                       p.low_stock_threshold, p.status,
                       c.name as category_name,
                       c.important_note as category_note,
                       c.return_policy as category_return_policy,
                       COALESCE(c.device_customization_enabled, 0) as device_customization_enabled,
                       COALESCE(AVG(r.rating), 0) as average_rating, 
                       COUNT(r.id) as total_reviews
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                LEFT JOIN product_reviews r ON p.id = r.product_id
                WHERE p.status = 'available' AND p.lifecycle_state IN ('live', 'coming_soon')
            '''
            params = []
        
        if category_id:
            query += " AND p.category_id = ?"
            params.append(category_id)
        elif category:
            query += " AND p.category = ?"
            params.append(category)
        
        query += " GROUP BY p.id ORDER BY p.id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        
        cursor.execute(query, params)
        rows = cursor.fetchall()

        # Fetch global return policy fallback
        cursor.execute("SELECT value FROM system_settings WHERE key = 'global_return_policy'")
        row_global = cursor.fetchone()
        global_policy = row_global['value'] if row_global and row_global['value'] else "7 Days Return Policy"

        products = []
        for row in rows:
            p_dict = normalize_product_row(row)
            p_dict["final_return_policy"] = p_dict.get("return_policy") or p_dict.get("category_return_policy") or global_policy
            products.append(p_dict)
        
        total_count = None
        if request.args.get('include_count'):
            if store_id:
                count_query = 'SELECT COUNT(DISTINCT p.id) as total FROM products p INNER JOIN warehouse_inventory wi ON p.id = wi.product_id WHERE p.status = "available" AND wi.warehouse_id = ? AND p.lifecycle_state IN ("live", "coming_soon")'
                count_params = [store_id]
            else:
                count_query = 'SELECT COUNT(DISTINCT p.id) as total FROM products p WHERE p.status = "available" AND p.lifecycle_state IN ("live", "coming_soon")'
                count_params = []
                
            if category_id:
                count_query += " AND p.category_id = ?"
                count_params.append(category_id)
            elif category:
                count_query += " AND p.category = ?"
                count_params.append(category)
            
            cursor.execute(count_query, count_params)
            count_result = cursor.fetchone()
            total_count = count_result['total'] if count_result else 0
        
        conn.close()
        
        response_data = {
            'data': products,
            'pagination': {
                'page': page if offset is None else None,
                'limit': limit,
                'offset': offset,
                'total': total_count,
                'total_pages': (total_count + limit - 1) // limit if total_count is not None else None
            }
        }
        
        response_payload = products if not request.args.get('include_meta') else response_data
        response, status_code = success_response(response_payload, "Products retrieved successfully")
        response.headers['Cache-Control'] = 'public, max-age=300'
        return response, status_code
        
    except Exception as e:
        logger.error(f"Error fetching products: {str(e)}")
        return error_response("Failed to fetch products", 500)


@app.route('/api/products/recommendations', methods=['GET'])
@cache.cached(timeout=60, query_string=True)
def get_recommendations():
    """Get recommended products based on ratings and popularity."""
    limit = request.args.get('limit', default=8, type=int)
    try:
        conn = get_db()
        query, params = optimizer.get_recommendations_query(limit)
        cursor = conn.cursor()
        cursor.execute(query, params)
        products = [normalize_product_row(row) for row in cursor.fetchall()]
        conn.close()
        
        for p in products:
            if not p.get('delivery_time'):
                p['delivery_time'] = "10-20 mins"
                
        return success_response(products, "Recommendations retrieved successfully")
    except Exception as e:
        import traceback
        logger.error(f"Error fetching recommendations: {str(e)}\n{traceback.format_exc()}")
        return error_response("Failed to fetch recommendations", 500)


def resolve_product_id_from_token(token):
    """Helper function to resolve product ID from share_token, seo_slug, or other formats."""
    conn = get_db()
    cursor = conn.cursor()

    # 1. Try exact share_token lookup
    cursor.execute("SELECT id FROM products WHERE share_token = ?", (token,))
    row = cursor.fetchone()

    # 2. Try exact seo_slug lookup
    if not row:
        cursor.execute("SELECT id FROM products WHERE seo_slug = ?", (token,))
        row = cursor.fetchone()

    # 3. Try parsing slug-token format (e.g. name-slug-TOKEN)
    if not row and '-' in token:
        parts = token.split('-')
        potential_token = parts[-1]
        
        # Try matching by share_token
        cursor.execute("SELECT id FROM products WHERE share_token = ?", (potential_token,))
        row = cursor.fetchone()
        
        # If still not found and potential_token is numeric, try as ID
        if not row and potential_token.isdigit():
            cursor.execute("SELECT id FROM products WHERE id = ?", (int(potential_token),))
            row = cursor.fetchone()

    # 4. Try exact ID lookup as last resort (for migration/redirect support)
    if not row and token.isdigit():
        cursor.execute("SELECT id FROM products WHERE id = ?", (int(token),))
        row = cursor.fetchone()
        
    conn.close()
    return row['id'] if row else None


@app.route('/s/<token>', methods=['GET'])
def share_product_html(token):
    """Serves product page with OG meta tags for social media sharing (for crawlers)."""
    try:
        product_id = resolve_product_id_from_token(token)
        if not product_id:
            return redirect('/', code=302)
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT p.id, p.name, p.price, p.description, p.images, p.share_token, p.seo_slug
            FROM products p 
            WHERE p.id = ?
        """, (product_id,))
        product = cursor.fetchone()
        conn.close()
        
        if not product:
            return redirect('/', code=302)
        
        # Extract first image
        images_data = product['images'] or ''
        first_image = ''
        if images_data:
            try:
                if images_data.startswith('['):
                    images_list = json.loads(images_data)
                    if images_list and len(images_list) > 0:
                        first_image = images_list[0]
                else:
                    first_image = images_data
            except:
                first_image = images_data if images_data else ''
        
        # Ensure image URL is absolute and publicly accessible
        if first_image and not first_image.startswith('http'):
            first_image = 'https://jdlx-mobile.onrender.com' + ('' if first_image.startswith('/') else '/') + first_image
        
        # Use fallback logo if no image
        if not first_image:
            first_image = 'https://jdlxmobile.in/logo512.png'
        
        product_name = html.escape(product['name'] or 'Premium Product')
        product_desc = html.escape(product['description'] or 'Check out this amazing product from JDLX Mobile')
        product_price = html.escape(str(product['price'] or 0))
        share_token = html.escape(product['share_token'] or token)
        escaped_image = html.escape(first_image)
        
        # Build the full product URL
        product_url = f"https://jdlxmobile.in/s/{share_token}"
        
        # Build the HTML response with OG meta tags
        html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    
    <title>{product_name} | JDLX MOBILE</title>
    <meta name="description" content="Buy {product_name} for only ₹{product_price}. {product_desc}">
    <meta name="keywords" content="JDLX, Mobile Accessories, {product_name}">
    
    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="product">
    <meta property="og:url" content="{product_url}">
    <meta property="og:title" content="{product_name} | JDLX MOBILE">
    <meta property="og:description" content="Buy {product_name} for only ₹{product_price}. {product_desc}">
    <meta property="og:image" content="{escaped_image}">
    <meta property="og:image:type" content="image/jpeg">
    <meta property="og:site_name" content="JDLX MOBILE">
    
    <!-- Twitter -->
    <meta property="twitter:card" content="summary_large_image">
    <meta property="twitter:url" content="{product_url}">
    <meta property="twitter:title" content="{product_name} | JDLX MOBILE">
    <meta property="twitter:description" content="Buy {product_name} for only ₹{product_price}. {product_desc}">
    <meta property="twitter:image" content="{escaped_image}">
    
    <!-- Redirect to React app after 1 second (for user experience) -->
    <meta http-equiv="refresh" content="1;url=https://jdlxmobile.in/product/{product_id}/{share_token}">
    <link rel="canonical" href="{product_url}">
    
    <style>
        body {{
            margin: 0;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #f8fafc;
            text-align: center;
        }}
        .container {{
            max-width: 600px;
            margin: 50px auto;
            background: white;
            padding: 40px;
            border-radius: 16px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }}
        h1 {{ color: #0f172a; margin: 20px 0; }}
        p {{ color: #64748b; font-size: 16px; }}
        .price {{ font-size: 28px; color: #f59e0b; font-weight: bold; margin: 20px 0; }}
        img {{ max-width: 100%; height: auto; margin: 20px 0; border-radius: 12px; }}
        .spinner {{
            display: inline-block;
            width: 40px;
            height: 40px;
            border: 4px solid #e2e8f0;
            border-top-color: #f59e0b;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }}
        @keyframes spin {{
            to {{ transform: rotate(360deg); }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="spinner"></div>
        <h1>{product_name}</h1>
        <p className="price">₹{product_price}</p>
        <p>{product_desc}</p>
        <p style="margin-top: 30px; color: #999; font-size: 14px;">Redirecting to JDLX Mobile...</p>
    </div>
</body>
</html>
"""
        return html, 200, {'Content-Type': 'text/html; charset=utf-8'}
    except Exception as e:
        logger.error(f"Error generating share product HTML: {str(e)}")
        return redirect('/', code=302)


@app.route('/api/products/s/<token>', methods=['GET'])
def get_product_by_token(token):
    """Retrieves detailed information for a single product by its secure share token or SEO slug (JSON API)."""
    try:
        product_id = resolve_product_id_from_token(token)
        if not product_id:
            return error_response("Product not found", 404)
        
        return get_product(product_id)
    except Exception as e:
        logger.error(f"Error fetching product by token: {str(e)}")
        return error_response("Failed to fetch product", 500)


@app.route('/api/products/<int:product_id>', methods=['GET'])
def get_product(product_id):
    """Retrieves detailed information for a single product.
    
    Now supports linked variants: fetches variant products linked via variant_group_id.
    """
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT p.*, c.name as category_name, c.important_note as category_note,
                   c.return_policy as category_return_policy,
                   COALESCE(c.device_customization_enabled, 0) as device_customization_enabled
            FROM products p 
            LEFT JOIN categories c ON p.category_id = c.id 
            WHERE p.id = ?
        """, (product_id,))
        product = cursor.fetchone()
        
        if not product:
            conn.close()
            return error_response("Product not found", 404)
            
        cursor.execute("SELECT AVG(rating) as avg_rating, COUNT(*) as total_reviews FROM product_reviews WHERE product_id = ?", (product_id,))
        stats = cursor.fetchone()
        
        product_dict = normalize_product_row(product)
        product_dict['average_rating'] = round(stats['avg_rating'], 1) if stats['avg_rating'] else 0
        product_dict['total_reviews'] = stats['total_reviews']
        
        # Fetch global return policy fallback
        cursor.execute("SELECT value FROM system_settings WHERE key = 'global_return_policy'")
        row_global = cursor.fetchone()
        global_policy = row_global['value'] if row_global and row_global['value'] else '7 Days Return Policy'

        # Determine the effective return policy: Product > Category > Global
        product_dict['final_return_policy'] = product_dict.get('return_policy') or product_dict.get('category_return_policy') or global_policy

        # Fetch linked variant products (new system: variants are separate products linked via variant_group_id)
        variant_group_id = product_dict.get('variant_group_id')
        is_parent = product_dict.get('is_parent', 0)
        
        if is_parent and variant_group_id:
            # This is a parent product - fetch its linked variants
            cursor.execute("""
                SELECT id, name, variant_name, price, stock, images, share_token, seo_slug, 
                       mrp, barcode, global_sku_code, offline_price, category, delivery_time
                FROM products 
                WHERE variant_group_id = ? AND id != ?
                ORDER BY id ASC
            """, (variant_group_id, product_id))
            linked_variants = [dict(r) for r in cursor.fetchall()]
            
            # Also fetch option groups from parent
            cursor.execute(
                "SELECT id, option_name, option_values, sort_order FROM product_variant_options WHERE product_id = ? ORDER BY sort_order ASC, id ASC",
                (product_id,)
            )
            variant_options = []
            for row in cursor.fetchall():
                o = dict(row)
                try:
                    o['option_values'] = json.loads(o.get('option_values') or '[]')
                except:
                    o['option_values'] = []
                variant_options.append(o)
            
            # Convert linked variants to variant format for backward compatibility
            variants = []
            for v in linked_variants:
                variant = {
                    'id': v['id'],
                    'name': v['variant_name'] or v['name'],
                    'price': v['price'],
                    'stock': v['stock'],
                    'images': v['images'],
                    'mrp': v.get('mrp'),
                    'sku': v.get('global_sku_code'),
                    'barcode': v.get('barcode'),
                    'offline_price': v.get('offline_price'),
                    'share_token': v['share_token'],
                    'seo_slug': v['seo_slug'],
                    'options': {},  # Options stored in product_variant_options on parent
                    'product_id': v['id']  # Link to the variant product
                }
                if variant['images']:
                    try:
                        variant['images'] = json.loads(variant['images'])
                    except:
                        pass
                variants.append(variant)
            
            product_dict['variants'] = variants
            product_dict['variant_options'] = variant_options
            product_dict['linked_variant_products'] = linked_variants  # Full variant product data
        else:
            # Check if this is a variant product (has variant_group_id but not is_parent)
            if variant_group_id and variant_group_id != product_id:
                # This is a variant product - fetch parent and siblings
                cursor.execute("""
                    SELECT id, name, variant_name, price, stock, images, share_token, seo_slug,
                           mrp, barcode, global_sku_code, offline_price, category, delivery_time,
                           is_parent
                    FROM products 
                    WHERE variant_group_id = ?
                    ORDER BY is_parent DESC, id ASC
                """, (variant_group_id,))
                group_products = [dict(r) for r in cursor.fetchall()]
                
                # Find parent
                parent = next((p for p in group_products if p['is_parent']), None)
                siblings = [p for p in group_products if not p['is_parent']]
                
                if parent:
                    # Fetch option groups from parent
                    cursor.execute(
                        "SELECT id, option_name, option_values, sort_order FROM product_variant_options WHERE product_id = ? ORDER BY sort_order ASC, id ASC",
                        (parent['id'],)
                    )
                    variant_options = []
                    for row in cursor.fetchall():
                        o = dict(row)
                        try:
                            o['option_values'] = json.loads(o.get('option_values') or '[]')
                        except:
                            o['option_values'] = []
                        variant_options.append(o)
                    
                    # Convert siblings to variant format
                    variants = []
                    for v in siblings:
                        variant = {
                            'id': v['id'],
                            'name': v['variant_name'] or v['name'],
                            'price': v['price'],
                            'stock': v['stock'],
                            'images': v['images'],
                            'mrp': v.get('mrp'),
                            'sku': v.get('global_sku_code'),
                            'barcode': v.get('barcode'),
                            'offline_price': v.get('offline_price'),
                            'share_token': v['share_token'],
                            'seo_slug': v['seo_slug'],
                            'options': {},
                            'product_id': v['id']
                        }
                        if variant['images']:
                            try:
                                variant['images'] = json.loads(variant['images'])
                            except:
                                pass
                        variants.append(variant)
                    
                    product_dict['variants'] = variants
                    product_dict['variant_options'] = variant_options
                    product_dict['linked_variant_products'] = siblings
                    product_dict['parent_product'] = parent
                else:
                    product_dict['variants'] = []
                    product_dict['variant_options'] = []
            else:
                # Regular product without variants
                product_dict['variants'] = []
                product_dict['variant_options'] = []

        # Fetch recommendations
        cursor.execute("""
            SELECT pr.recommendation_type, p.id, p.name, p.price, p.images, p.brand
            FROM product_recommendations pr
            JOIN products p ON pr.recommended_product_id = p.id
            WHERE pr.product_id = ?
            ORDER BY pr.priority DESC
        """, (product_id,))
        recs = cursor.fetchall()
        
        product_dict['recommendation_controls'] = {
            'related': [dict(r) for r in recs if r['recommendation_type'] == 'related'],
            'upsell': [dict(r) for r in recs if r['recommendation_type'] == 'upsell'],
            'cross_sell': [dict(r) for r in recs if r['recommendation_type'] == 'cross_sell'],
            'frequent': [dict(r) for r in recs if r['recommendation_type'] == 'frequent'],
            'manual_priority': product_dict.get('recommendation_priority', 0),
            'smart_weight': product_dict.get('recommendation_weight', 1.0)
        }

        # Fetch product content
        cursor.execute("SELECT * FROM product_content WHERE product_id = ?", (product_id,))
        content = cursor.fetchone()
        if content:
            content_dict = dict(content)
            # Parse JSON fields
            for json_field in ['highlights', 'specifications']:
                if content_dict.get(json_field):
                    try:
                        content_dict[json_field] = json.loads(content_dict[json_field])
                    except:
                        pass
            product_dict['content'] = content_dict
        else:
            product_dict['content'] = None

        # Fetch badges
        cursor.execute("""
            SELECT badge_type, priority, start_date, end_date
            FROM product_badges
            WHERE product_id = ? AND is_active = 1
            AND (start_date IS NULL OR start_date <= CURRENT_TIMESTAMP)
            AND (end_date IS NULL OR end_date >= CURRENT_TIMESTAMP)
            ORDER BY priority DESC
        """, (product_id,))
        product_dict['badges'] = [dict(r) for r in cursor.fetchall()]

        # Fetch fulfillment
        cursor.execute("SELECT * FROM product_fulfillment WHERE product_id = ?", (product_id,))
        fulfillment = cursor.fetchone()
        product_dict['fulfillment'] = dict(fulfillment) if fulfillment else None

        # Fetch discovery
        cursor.execute("SELECT * FROM product_discovery WHERE product_id = ?", (product_id,))
        discovery = cursor.fetchone()
        if discovery:
            discovery_dict = dict(discovery)
            for json_field in ['search_keywords', 'product_tags', 'search_synonyms']:
                if discovery_dict.get(json_field):
                    try:
                        discovery_dict[json_field] = json.loads(discovery_dict[json_field])
                    except:
                        discovery_dict[json_field] = []
                else:
                    discovery_dict[json_field] = []
            product_dict['discovery'] = discovery_dict
        else:
            product_dict['discovery'] = None

        # Fetch analytics
        cursor.execute("SELECT * FROM product_analytics WHERE product_id = ?", (product_id,))
        analytics = cursor.fetchone()
        if analytics:
            ana_dict = dict(analytics)
            # Calculate Conversion Rate (Purchases / Views)
            views = ana_dict.get('view_count', 0)
            purchases = ana_dict.get('purchase_count', 0)
            ana_dict['conversion_rate'] = round((purchases / views * 100), 2) if views > 0 else 0
            product_dict['analytics'] = ana_dict
        else:
            product_dict['analytics'] = {
                'view_count': 0,
                'cart_add_count': 0,
                'purchase_count': 0,
                'wishlist_count': 0,
                'conversion_rate': 0
            }

        conn.close()

        return success_response(product_dict, "Product details retrieved successfully")
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/products/<int:product_id>/stock', methods=['GET'])
def get_product_stock(product_id):
    """Returns the latest available stock for a product."""
    store_id = request.args.get('store_id', type=int)
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        if store_id:
            cursor.execute("""
                SELECT wi.stock_quantity, wi.reserved_stock
                FROM warehouse_inventory wi
                WHERE wi.product_id = ? AND wi.warehouse_id = ?
            """, (product_id, store_id))
            row = cursor.fetchone()
            if row:
                stock_data = {
                    "stock": row['stock_quantity'],
                    "reserved_stock": row['reserved_stock'],
                    "available": max(0, row['stock_quantity'])
                }
            else:
                stock_data = None
        else:
            cursor.execute("SELECT stock, low_stock_threshold FROM products WHERE id = ?", (product_id,))
            row = cursor.fetchone()
            if row:
                # Requirement 4: Show stock based on available_stock (which is SQ - HR) only.
                # Do NOT subtract cart_reserved.
                stock_data = {
                    "stock": row['stock'],
                    "reserved_stock": 0,
                    "available": max(0, row['stock'])
                }
            else:
                stock_data = None
        
        conn.close()
        if not stock_data:
            return error_response("Product not found", 404)
            
        return success_response(stock_data, "Stock data retrieved successfully")
    except Exception as e:
        return error_response(str(e), 500)

def trigger_order_email(order_id):
    from notifier import send_order_email
    
    conn = get_db()
    try:
        cursor = conn.cursor()
        # Fetch order details
        order = cursor.execute("""
            SELECT id, user_id, customer_name, delivery_address, total_amount, 
                   platform_fee, delivery_fee, fitting_charge, payment_type, 
                   estimated_delivery 
            FROM orders WHERE id = ?
        """, (order_id,)).fetchone()
        
        if not order:
            return False
            
        # Fetch user email
        user = cursor.execute("SELECT email FROM users WHERE id = ?", (order['user_id'],)).fetchone()
        if not user or not user['email']:
            return False
            
        # Fetch order items
        db_items = cursor.execute("""
            SELECT product_name, quantity, price FROM order_items WHERE order_id = ?
        """, (order_id,)).fetchall()
        
        items = []
        subtotal = 0
        for item in db_items:
            items.append({
                "name": item['product_name'] or "Unknown Product",
                "qty": item['quantity'],
                "price": item['price']
            })
            subtotal += float(item['price']) * int(item['quantity'])
            
        # Fetch discount applied from offer_usage if any
        discount = cursor.execute("SELECT discount_applied FROM offer_usage WHERE order_id = ?", (order_id,)).fetchone()
        discount_applied = discount['discount_applied'] if discount else 0
        
        order_details = {
            "order_id": order_id,
            "customer_name": order['customer_name'],
            "subtotal": subtotal,
            "platform_fee": order['platform_fee'],
            "delivery_fee": order['delivery_fee'],
            "fitting_charge": order['fitting_charge'],
            "discount_applied": discount_applied,
            "total_amount": order['total_amount'],
            "items": items,
            "address": order['delivery_address'],
            "estimated_delivery": order['estimated_delivery'],
            "payment_type": order['payment_type']
        }
        
        send_order_email(user['email'], order_details)
        return True
    except Exception as e:
        logger.error(f"Error in trigger_order_email: {e}")
        return False
    finally:
        conn.close()

def confirm_order_and_decrement_stock_logic(cursor, order_id):
    """
    Confirms an order and decrements the inventory stock safely.
    Ensures this is only done once per order to prevent double-decrement bugs.
    """
    # 1. Fetch current order status. Customer checkout uses global catalog stock and
    # standard fulfillment only.
    cursor.execute("SELECT order_status, dark_store_id FROM orders WHERE id = ?", (order_id,))
    order = cursor.fetchone()
    if not order:
        print(f"[ORDER CONFIRMATION ERROR] Order #{order_id} not found.")
        return False

    current_status = order['order_status'].upper()
    
    # 2. Only proceed if status is 'PLACED' to guarantee idempotency
    if current_status != 'PLACED':
        print(f"[ORDER CONFIRMATION WARNING] Order #{order_id} is already in '{current_status}' status. Skipping stock decrement.")
        return False

    store_id = order['dark_store_id']

    # 3. Fetch order items
    cursor.execute("SELECT product_id, quantity, variant_id FROM order_items WHERE order_id = ?", (order_id,))
    items = cursor.fetchall()

    # 4. Decrement global product/variant stock atomically. A mid-loop stock
    #    failure must NOT leave partial decrements behind — the whole set is
    #    wrapped in a savepoint so it stays all-or-nothing even when the caller
    #    commits after catching the ValueError (e.g. payment verify/webhook).
    cursor.execute("SAVEPOINT confirm_stock_decrement")
    for item in items:
        product_id = item['product_id']
        qty = item['quantity']
        v_id = item['variant_id']

        if v_id:
            cursor.execute(
                """UPDATE product_variants
                   SET stock = stock - ?
                   WHERE id = ? AND product_id = ? AND stock >= ?""",
                (qty, v_id, product_id, qty)
            )
            if cursor.rowcount == 0:
                cursor.execute(
                    "UPDATE orders SET order_status = 'INVENTORY_UNAVAILABLE' WHERE id = ?",
                    (order_id,)
                )
                # Undo the decrements already applied for earlier items in this order.
                cursor.execute("ROLLBACK TO SAVEPOINT confirm_stock_decrement")
                raise ValueError(f"Insufficient variant stock for product {product_id}")

            cursor.execute("""
                UPDATE products
                SET stock = CASE WHEN stock >= ? THEN stock - ? ELSE 0 END
                WHERE id = ?
            """, (qty, qty, product_id))
        else:
            cursor.execute(
                """UPDATE products
                   SET stock = stock - ?
                   WHERE id = ? AND stock >= ?""",
                (qty, product_id, qty)
            )
            if cursor.rowcount == 0:
                cursor.execute(
                    "UPDATE orders SET order_status = 'INVENTORY_UNAVAILABLE' WHERE id = ?",
                    (order_id,)
                )
                # Undo the decrements already applied for earlier items in this order.
                cursor.execute("ROLLBACK TO SAVEPOINT confirm_stock_decrement")
                raise ValueError(f"Insufficient stock for product {product_id}")

        # Decrement warehouse partner inventory stock if store_id is set (Multi-Vendor stock sync)
        if store_id:
            if v_id:
                cursor.execute(
                    """UPDATE warehouse_inventory
                       SET stock_quantity = CASE WHEN stock_quantity >= ? THEN stock_quantity - ? ELSE 0 END,
                           available_stock = CASE WHEN available_stock >= ? THEN available_stock - ? ELSE 0 END
                       WHERE (warehouse_id = ? OR warehouse_partner_id = ?) AND product_id = ? AND variant_id = ?""",
                    (qty, qty, qty, qty, store_id, store_id, product_id, v_id)
                )
            else:
                cursor.execute(
                    """UPDATE warehouse_inventory
                       SET stock_quantity = CASE WHEN stock_quantity >= ? THEN stock_quantity - ? ELSE 0 END,
                           available_stock = CASE WHEN available_stock >= ? THEN available_stock - ? ELSE 0 END
                       WHERE (warehouse_id = ? OR warehouse_partner_id = ?) AND product_id = ?""",
                    (qty, qty, qty, qty, store_id, store_id, product_id)
                )

        # Trigger Low Stock Notifications if stock drops to or below threshold
        cursor.execute("SELECT name, stock, low_stock_threshold FROM products WHERE id = ?", (product_id,))
        prod_data = cursor.fetchone()
        if prod_data and 0 < prod_data['stock'] <= (prod_data['low_stock_threshold'] or 5):
            try:
                trigger_low_stock_notifications_svc(
                    product_id, 
                    prod_data['stock'], 
                    prod_data['name'],
                    get_db,
                    notification_service.notify_user_internal
                )
            except Exception as notify_err:
                print(f"[LOW STOCK WARNING] Failed to trigger notification: {notify_err}")

    cursor.execute("RELEASE SAVEPOINT confirm_stock_decrement")

    # 5. Update order status to 'CONFIRMED' and confirmed_at timestamp
    cursor.execute(
        "UPDATE orders SET order_status = 'CONFIRMED', confirmed_at = CURRENT_TIMESTAMP WHERE id = ?",
        (order_id,)
    )

    # 6. Create warehouse order assignment only when an explicit warehouse/store is attached.
    if store_id:
        cursor.execute("SELECT id FROM warehouse_order_assignments WHERE order_id = ?", (order_id,))
        if not cursor.fetchone():
            cursor.execute(
                "INSERT INTO warehouse_order_assignments (order_id, warehouse_id, assignment_status) VALUES (?, ?, 'assigned')",
                (order_id, store_id)
            )
            print(f"[ORDER CONFIRMATION] Created warehouse assignment for Order #{order_id} to Warehouse #{store_id}")

    print(f"[ORDER CONFIRMATION SUCCESS] Order #{order_id} has been confirmed and stock has been decremented.")
    return True


@app.route('/api/checkout', methods=['POST'])
@token_required
@limiter.limit("5 per minute")
def checkout():
    data = request.json
    user_id = request.user['user_id']
    items = data.get('items', [])
    address = data.get('address')
    address_id = data.get('address_id')
    phone = data.get('phone')
    try:
        total_amount = float(data.get('total_amount') or 0)
    except (ValueError, TypeError):
        total_amount = 0.0

    user_lat = data.get('latitude', 28.6139)  # Default to Delhi
    user_lng = data.get('longitude', 77.2090)
    # Customer checkout uses global catalog stock and standard fulfillment only.
    delivery_type = 'scheduled'


    try:
        conn = get_db()
        cursor = conn.cursor()

        # Override if address_id provided
        if address_id:
            cursor.execute("SELECT address_text, latitude, longitude FROM user_addresses WHERE id = ? AND user_id = ?", (address_id, user_id))
            saved_addr = cursor.fetchone()
            if saved_addr:
                address = saved_addr['address_text']
                user_lat = saved_addr['latitude']
                user_lng = saved_addr['longitude']

        if not items or not address or not phone:
            return error_response("Missing order details", 400)

        try:
            product_ids = [int(item.get('id')) for item in items if item.get('id')]
        except (TypeError, ValueError):
            return error_response("Invalid order items", 400)
        if len(product_ids) != len(items):
            return error_response("Invalid order items", 400)

        placeholders = ",".join(["?"] * len(product_ids))
        cursor.execute(f"""
            SELECT p.id, p.name, p.category, p.stock, p.prepaid_only, p.price, p.sub_category, c.name as category_name,
                   COALESCE(c.device_customization_enabled, 0) as device_customization_enabled
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.id IN ({placeholders})
        """, product_ids)
        product_meta = {row['id']: dict(row) for row in cursor.fetchall()}

        for item in items:
            item['id'] = int(item.get('id'))
            try:
                qty = int(item.get('qty') or item.get('quantity', 1))
            except (ValueError, TypeError):
                qty = 1
            if qty <= 0:
                return error_response(f"Quantity for product {item.get('id')} must be at least 1", 400)
            item['qty'] = qty
            product = product_meta.get(item['id'])
            if not product:
                return error_response(f"Product {item.get('id')} not found", 404)
            device_model = (item.get('device_model') or '').strip()
            item['device_model'] = device_model or None
            if is_sticker_category(product) and not item['device_model']:
                return error_response(f"Select Your Device Model is required for {product['name']}", 400)

        delivery_message = None
        est_time = "3-5 business days"
        store_id = None
        # Select warehouse from warehouse_inventory for the ordered product/variant (Multi-Vendor matching logic)
        for item in items:
            p_id = item["id"]
            v_id = item.get("variant_id")
            
            if v_id:
                cursor.execute("""
                    SELECT COALESCE(wi.warehouse_id, wi.warehouse_partner_id) as wh_id
                    FROM warehouse_inventory wi
                    JOIN warehouses w ON w.id = COALESCE(wi.warehouse_id, wi.warehouse_partner_id)
                    JOIN product_variants pv ON pv.id = wi.variant_id
                    WHERE wi.product_id = ? AND wi.variant_id = ? AND (wi.stock_quantity > 0 OR wi.available_stock > 0)
                      AND w.operations_status = 'open' AND w.account_status = 'active'
                      AND pv.status = 'active'
                    LIMIT 1
                """, (p_id, v_id))
                row = cursor.fetchone()
                if row:
                    store_id = row["wh_id"]
                    break
            
            # Fallback to checking product without variant
            cursor.execute("""
                SELECT COALESCE(wi.warehouse_id, wi.warehouse_partner_id) as wh_id
                FROM warehouse_inventory wi
                JOIN warehouses w ON w.id = COALESCE(wi.warehouse_id, wi.warehouse_partner_id)
                WHERE wi.product_id = ? AND (wi.stock_quantity > 0 OR wi.available_stock > 0)
                  AND w.operations_status = 'open' AND w.account_status = 'active'
                LIMIT 1
            """, (p_id,))
            row = cursor.fetchone()
            if row:
                store_id = row["wh_id"]
                break

        # Fallback to checking any warehouse holding this product regardless of operations status
        if not store_id:
            for item in items:
                p_id = item["id"]
                v_id = item.get("variant_id")
                if v_id:
                    cursor.execute("""
                        SELECT COALESCE(wi.warehouse_id, wi.warehouse_partner_id) as wh_id
                        FROM warehouse_inventory wi
                        JOIN product_variants pv ON pv.id = wi.variant_id
                        WHERE wi.product_id = ? AND wi.variant_id = ? AND pv.status = 'active'
                        LIMIT 1
                    """, (p_id, v_id))
                    row = cursor.fetchone()
                    if row:
                        store_id = row["wh_id"]
                        break
                cursor.execute("""
                    SELECT COALESCE(wi.warehouse_id, wi.warehouse_partner_id) as wh_id
                    FROM warehouse_inventory wi
                    WHERE wi.product_id = ?
                    LIMIT 1
                """, (p_id,))
                row = cursor.fetchone()
                if row:
                    store_id = row["wh_id"]
                    break

        # Hard fallback to the first active/any warehouse in the database to prevent order errors
        if not store_id:
            cursor.execute("SELECT id FROM warehouses WHERE operations_status = 'open' AND account_status = 'active' LIMIT 1")
            row = cursor.fetchone()
            if row:
                store_id = row["id"]
            else:
                cursor.execute("SELECT id FROM warehouses LIMIT 1")
                row = cursor.fetchone()
                if row:
                    store_id = row["id"]

        # 2. Check global product/variant inventory.
        for item in items:
            product = product_meta.get(item['id'])
            if item.get('variant_id'):
                cursor.execute(
                    "SELECT stock, name, price, status FROM product_variants WHERE id = ? AND product_id = ?",
                    (item.get('variant_id'), item['id'])
                )
                stock_row = cursor.fetchone()
                if not stock_row:
                    return error_response(f"Variant for product {item['id']} not found", 404)
                if stock_row['status'] != 'active':
                    return error_response(f"Variant {stock_row['name']} is not available", 400)
                available_stock = int(stock_row['stock'] or 0)
                stock_name = stock_row['name'] or product['name']
                item['price'] = float(stock_row['price'] if stock_row['price'] is not None else (product.get('price') or 0))
            else:
                available_stock = int(product.get('stock') or 0)
                stock_name = product['name']
                item['price'] = float(product.get('price') or 0)

            if available_stock < item['qty']:
                return error_response(
                    f"Insufficient stock for {stock_name}. Available: {max(0, available_stock)}",
                    400
                )

            if product and product.get('prepaid_only'):
                is_prepaid_only_order = True

        # C2 fix: recompute order total from DB prices x quantity.
        # The client-supplied total_amount and item prices are never trusted.
        total_amount = round(sum(float(item['price']) * item['qty'] for item in items), 2)

        # Get dynamic fees from settings
        cursor.execute("SELECT key, value FROM system_settings WHERE key IN ('platform_fee', 'free_delivery_threshold', 'delivery_fee', 'prepaid_delivery_charge', 'cod_delivery_charge', 'cod_advance_amount', 'cod_enabled', 'cod_enabled_shiprocket', 'free_delivery_enabled', 'auto_cod_protection')")
        settings_rows = cursor.fetchall()
        settings = {row['key']: row['value'] for row in settings_rows}
        
        platform_fee = safe_float(settings.get('platform_fee'), 7)
        free_thresh = safe_float(settings.get('free_delivery_threshold'), 499)
        free_delivery_enabled = settings.get('free_delivery_enabled', 'true').lower() == 'true'
        prepaid_fee = safe_float(settings.get('prepaid_delivery_charge'), 49)
        cod_fee = safe_float(settings.get('cod_delivery_charge'), 99)
        cod_advance = max(0, safe_float(settings.get('cod_advance_amount'), 49))
        cod_enabled = settings.get('cod_enabled', 'true').lower() == 'true'
        cod_enabled_shiprocket = settings.get('cod_enabled_shiprocket', 'false').lower() == 'true'
        auto_cod_protection = settings.get('auto_cod_protection', 'true').lower() == 'true'

        payment_type = data.get('payment_type', 'PREPAID').upper()
        if payment_type == 'COD':
            if not cod_enabled:
                return error_response("Cash on Delivery is currently disabled", 400)
            
            # 1. Check for prepaid-only products
            if locals().get('is_prepaid_only_order', False):
                return error_response("Your cart contains items that require prepaid payment.", 400)

            # 2. Check for Pincode Restrictions
            delivery_pincode = data.get('pincode')
            if delivery_pincode:
                cursor.execute("SELECT cod_allowed FROM pincode_rules WHERE pincode = ?", (delivery_pincode,))
                pincode_rule = cursor.fetchone()
                if pincode_rule and not pincode_rule['cod_allowed']:
                    return error_response(f"Cash on Delivery is not available for pincode {delivery_pincode}.", 400)

            # 3. Check for User Restrictions
            cursor.execute("SELECT cod_restricted FROM users WHERE id = ?", (user_id,))
            user_info = cursor.fetchone()
            if user_info and user_info['cod_restricted']:
                return error_response("Cash on Delivery is restricted for your account due to policy violations.", 400)

            # 4. Fake COD Protection (Block repeated rejected orders)
            # Check orders from last 30 days if enabled by admin
            if auto_cod_protection:
                cursor.execute('''
                    SELECT COUNT(*) as rejected_count FROM orders 
                    WHERE user_id = ? AND payment_type = 'COD' 
                    AND order_status IN ('CANCELLED', 'REJECTED')
                    AND created_at > datetime('now', '-30 days')
                ''', (user_id,))
                rejected_row = cursor.fetchone()
                if rejected_row and rejected_row['rejected_count'] >= 2:
                    return error_response("COD is temporarily disabled for you due to multiple recent order cancellations.", 400)

        # Calculate Delivery Charge
        actual_delivery_fee = 0
        free_delivery_applied = 0
        
        if free_delivery_enabled and total_amount >= free_thresh:
            # Free delivery applies to ALL delivery types (quick + shiprocket)
            actual_delivery_fee = 0
            free_delivery_applied = 1
        elif delivery_type == 'shiprocket':
            # Shiprocket uses the same prepaid/cod fee structure
            actual_delivery_fee = cod_fee if payment_type == 'COD' else prepaid_fee
        elif payment_type == 'PREPAID':
            actual_delivery_fee = prepaid_fee
        else: # COD
            actual_delivery_fee = cod_fee

        # C2 fix: fitting charge is derived from business rules and DB product data,
        # not trusted from the client. UV glass fitting = Rs.80, other fitting = Rs.40.
        fitting_charge = 0.0
        for item in items:
            client_fc = 0
            try:
                client_fc = float(item.get('fitting_charge') or 0)
            except (TypeError, ValueError):
                client_fc = 0
            if client_fc < 0:
                return error_response("Invalid fitting charge", 400)
            if client_fc > 0:
                sub_cat = (product_meta.get(item['id'], {}).get('sub_category') or '').lower()
                expected_fc = 80.0 if 'uv glass' in sub_cat else 40.0
                if abs(client_fc - expected_fc) > 0.01:
                    return error_response(f"Invalid fitting charge for {product_meta.get(item['id'], {}).get('name', 'item')}", 400)
                item['fitting_charge'] = expected_fc
                fitting_charge += expected_fc * item['qty']
            else:
                item['fitting_charge'] = 0.0

        # C2 fix: discount_applied is recomputed and verified against the offers table.
        # A client-supplied discount without a valid, applicable offer is ignored.
        discount_applied = 0.0
        raw_offer_id = data.get('offer_id')
        offer_id = None
        try:
            offer_id = int(raw_offer_id) if raw_offer_id else None
        except (TypeError, ValueError):
            offer_id = None
        if offer_id:
            try:
                cursor.execute("SELECT * FROM offers WHERE id = ? AND is_active = 1", (offer_id,))
                offer_row = cursor.fetchone()
                if offer_row:
                    offer = dict(offer_row)
                    offer_ok = True
                    if offer.get('end_date'):
                        try:
                            if datetime.datetime.now() > datetime.datetime.strptime(offer['end_date'], '%Y-%m-%d %H:%M:%S'):
                                offer_ok = False
                        except Exception:
                            pass
                    if offer.get('start_date') and offer_ok:
                        try:
                            if datetime.datetime.now() < datetime.datetime.strptime(offer['start_date'], '%Y-%m-%d %H:%M:%S'):
                                offer_ok = False
                        except Exception:
                            pass
                    if offer_ok and offer.get('min_order_amount') and total_amount < float(offer['min_order_amount']):
                        offer_ok = False
                    if offer_ok and offer.get('usage_limit') and int(offer.get('usage_count') or 0) >= int(offer['usage_limit']):
                        offer_ok = False
                    if offer_ok and offer.get('target_type') == 'specific_user':
                        applicable_ids = json.loads(offer.get('applicable_ids') or '[]')
                        if str(user_id) not in [str(x) for x in applicable_ids]:
                            offer_ok = False
                    if offer_ok and offer.get('per_user_limit'):
                        cursor.execute("SELECT COUNT(*) FROM offer_usage WHERE offer_id = ? AND user_id = ?", (offer['id'], user_id))
                        if cursor.fetchone()[0] >= int(offer['per_user_limit']):
                            offer_ok = False
                    if offer_ok:
                        # Pass per-item (DB-verified) prices so multi-vendor offers
                        # discount ONLY their own products' value — identical base
                        # to what the customer saw at checkout.
                        checkout_items = [
                            {
                                'product_id': int(item.get('id')),
                                'price': float(item.get('price') or 0),
                                'quantity': int(item.get('qty') or item.get('quantity') or 1),
                            }
                            for item in items
                            if item.get('id')
                        ]
                        discount_applied = float(calculate_discount(offer, total_amount, product_ids, items=checkout_items) or 0)
            except Exception:
                pass  # offers table missing or malformed data - treat as no discount
        wallet_amount = max(0, float(data.get('wallet_amount', 0) or 0))
        taxable_subtotal = max(0, total_amount - discount_applied)
        pre_wallet_total = taxable_subtotal + platform_fee + actual_delivery_fee + fitting_charge
        wallet_amount = min(wallet_amount, pre_wallet_total)
        final_total = max(0, pre_wallet_total - wallet_amount)
        
        # Calculate Pay Now and COD amounts
        pay_now_amount = final_total
        cod_remaining_amount = 0
        cod_advance_paid = 0
        
        if payment_type == 'COD':
            cod_advance_paid = cod_advance
            pay_now_amount = min(cod_advance_paid, final_total)
            cod_advance_paid = pay_now_amount
            cod_remaining_amount = max(0, final_total - cod_advance_paid)

        # 3. Insert Order with correct column names and delivery_type
        order_number = f"ORD-{uuid.uuid4().hex[:8].upper()}"
        
        estimated_delivery_str = est_time
        
        cursor.execute('''
            INSERT INTO orders (
                order_number, user_id, customer_name, customer_phone, delivery_address, 
                order_status, total_amount, dark_store_id, estimated_delivery, 
                delivery_latitude, delivery_longitude, payment_status, delivery_type,
                platform_fee, delivery_fee, fitting_charge, payment_type,
                cod_advance_paid, cod_remaining_amount, free_delivery_applied,
                source, agent_id
            )
            VALUES (?, ?, ?, ?, ?, 'PLACED', ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, 'ONLINE', NULL)
        ''', (
            order_number, user_id, data.get('customer_name', 'Valued Customer'), 
            phone, address, final_total, store_id, estimated_delivery_str,
            user_lat, user_lng, delivery_type, platform_fee, actual_delivery_fee, fitting_charge,
            payment_type, cod_advance_paid, cod_remaining_amount, free_delivery_applied
        ))

        
        order_id = cursor.lastrowid

        # 4. Insert Order Items and Update both store and global stock (Requirement 2: HARD RESERVATION)
        for item in items:
            v_id = item.get('variant_id')
            product_name = product_meta.get(item['id'], {}).get('name', 'Unknown Product')
            item_subtotal = float(item['price']) * int(item['qty'])
            
            # Snapshot variant details at time of order for historical accuracy
            variant_name = item.get('variant_name')
            variant_options = item.get('variant_options')
            variant_mrp = item.get('variant_mrp')
            variant_sku = item.get('variant_sku')
            variant_image = item.get('variant_image')
            
            if v_id:
                cursor.execute("SELECT name, options, mrp, sku, images FROM product_variants WHERE id = ?", (v_id,))
                variant_data = cursor.fetchone()
                if variant_data:
                    if not variant_name:
                        variant_name = variant_data['name']
                    if not variant_options:
                        variant_options = variant_data['options']
                    if not variant_mrp:
                        variant_mrp = variant_data['mrp']
                    if not variant_sku:
                        variant_sku = variant_data['sku']
                    if not variant_image:
                        variant_image = variant_data['images']

            item_subtotal = float(item['price']) * int(item['qty'])
            cursor.execute(
                """INSERT INTO order_items (order_id, product_id, product_name, variant_id, quantity, price, subtotal, device_model, fitting_charge, variant_name, variant_options, variant_mrp, variant_sku, variant_image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (order_id, item['id'], product_name, v_id, item['qty'], item['price'], item_subtotal, item.get('device_model'), item.get('fitting_charge', 0), variant_name, variant_options, variant_mrp, variant_sku, variant_image)
            )

            # Note: Inventory stock is NOT decremented here during placement anymore.
            # Stock will be decremented and synced only when payment is verified and order is confirmed.

        # 4b. Deduct wallet balance for the applied wallet amount atomically within this transaction
        #     (guarded UPDATE so the balance can never go negative / be double-spent).
        wallet_amount = round(wallet_amount, 2)
        if wallet_amount > 0:
            cursor.execute(
                "UPDATE wallet SET balance = balance - ? WHERE user_id = ? AND balance >= ?",
                (wallet_amount, user_id, wallet_amount)
            )
            if cursor.rowcount == 0:
                conn.rollback()
                return error_response("Insufficient wallet balance", 400)
            cursor.execute(
                "INSERT INTO wallet_transactions (user_id, amount, type, reason, reference_id) VALUES (?, ?, 'debit', ?, ?)",
                (user_id, wallet_amount, f"Payment for order {order_number}", str(order_id))
            )

        # 4b2. H4 fix: record offer usage server-side and atomically inside this
        #      transaction. A client-side record-usage call can no longer be forged,
        #      replayed, or used to inflate usage counts / bypass per-user limits.
        if offer_id is not None and discount_applied > 0:
            try:
                cursor.execute(
                    "SELECT COUNT(*) FROM offer_usage WHERE offer_id = ? AND user_id = ?",
                    (offer_id, user_id),
                )
                if cursor.fetchone()[0] < int(offer.get('per_user_limit') or 1):
                    cursor.execute(
                        "INSERT INTO offer_usage (offer_id, user_id, order_id, discount_applied) VALUES (?, ?, ?, ?)",
                        (offer_id, user_id, order_id, discount_applied),
                    )
                    cursor.execute(
                        "UPDATE offers SET usage_count = usage_count + 1 WHERE id = ? AND (usage_limit IS NULL OR usage_count < usage_limit)",
                        (offer_id,),
                    )
                    if cursor.rowcount == 0:
                        raise ValueError("Offer usage limit reached")
            except Exception as usage_err:
                logger.error(f"Failed to record offer usage for order #{order_id}: {usage_err}")
                conn.rollback()
                return error_response("Unable to apply offer, please try again", 400)

        # 4c. PREPAID orders fully covered by the wallet have no payment gateway flow, so confirm them
        #     immediately. This runs before the commit so a stock failure rolls back both the order
        #     and the wallet debit together.
        if payment_type == 'PREPAID' and pay_now_amount <= 0:
            try:
                confirm_order_and_decrement_stock_logic(cursor, order_id)
            except Exception as conf_err:
                logger.error(f"Failed to confirm stock for wallet-prepaid order #{order_id}: {conf_err}")
                conn.rollback()
                return error_response(f"Insufficient stock to fulfill order: {str(conf_err)}", 400)

        conn.commit()

        # 5. Sync with Shiprocket for COD orders.
        # Prepaid orders will sync in verify_payment after successful payment.
        if payment_type == 'COD':
            if pay_now_amount <= 0:
                try:
                    confirm_order_and_decrement_stock_logic(cursor, order_id)
                except Exception as conf_err:
                    logger.error(f"Failed to confirm stock for COD order #{order_id}: {conf_err}")
                    conn.rollback()
                    return error_response(f"Insufficient stock to fulfill order: {str(conf_err)}", 400)
            try:
                order_payload = {
                    "order_number": order_number,
                    "customer_name": data.get('customer_name', 'Valued Customer'),
                    "customer_phone": phone,
                    "delivery_address": address,
                    "total_amount": final_total,
                    "items": items,
                    "payment_status": "pending"
                }
                sr_res = sync_to_shiprocket(order_payload, cursor)
                if sr_res and 'order_id' in sr_res:
                    cursor.execute("UPDATE orders SET shiprocket_order_id = ? WHERE id = ?", (sr_res['order_id'], order_id))
                    conn.commit()
            except Exception as e:
                logger.error(f"Shiprocket Sync Failed: {str(e)}")
        # Get user details for email
        cursor.execute("SELECT name, email FROM users WHERE id = ?", (user_id,))
        user_info = cursor.fetchone()

        # Check for app review eligibility
        check_and_trigger_review(cursor, user_id)

        # Trigger Gmail Notification
        conn.commit()
        conn.close()
        
        return jsonify({
            "message": delivery_message or "Order placed successfully", 
            "order_id": order_id,
            "estimated_delivery_time": est_time,
            "assigned_store": None,
            "delivery_type": delivery_type,
            "summary": {
                "subtotal": total_amount,
                "discount": discount_applied,
                "wallet_amount": wallet_amount,
                "delivery_charge": actual_delivery_fee,
                "free_delivery_status": "Applied" if free_delivery_applied else "Not Applicable",
                "pay_now_amount": pay_now_amount,
                "remaining_cod_amount": cod_remaining_amount,
                "payment_type": payment_type
            }
        }), 201
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/order/<int:order_id>/status', methods=['GET'])
@token_required
def get_order_status(order_id):
    user_id = request.user['user_id']
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT o.*, o.order_status as status,
                   dp.name as partner_name, dp.phone as partner_phone,
                   ds.store_code, ds.name as store_name
            FROM orders o 
            LEFT JOIN delivery_partners dp ON o.delivery_partner_id = dp.id 
            LEFT JOIN dark_stores ds ON o.store_id = ds.id
            WHERE o.id = ? AND o.user_id = ?
        ''', (order_id, user_id))
        order = cursor.fetchone()
        
        if not order:
            conn.close()
            return error_response("Order not found", 404)
        
        # Include the ordered products (name + image) so the tracking page can
        # render the item list. Falls back to the snapshot name stored on the
        # item if the product row was deleted or never linked.
        cursor.execute('''
            SELECT oi.product_id, oi.quantity, oi.price, oi.subtotal,
                   oi.fitting_charge, oi.product_name, oi.device_model,
                   oi.variant_id, oi.variant_name, oi.variant_options, oi.variant_mrp, oi.variant_sku, oi.variant_image,
                   COALESCE(p.images, '') as images
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = ?
        ''', (str(order_id),))
        items = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        # Add variant snapshot info to each item for historical accuracy
        for item in items:
            if item.get('variant_id'):
                item['variant_info'] = {
                    'variant_id': item.get('variant_id'),
                    'variant_name': item.get('variant_name'),
                    'variant_options': item.get('variant_options'),
                    'variant_mrp': item.get('variant_mrp'),
                    'variant_sku': item.get('variant_sku'),
                    'variant_image': item.get('variant_image'),
                }
        
        order_dict = dict(order)
        order_dict['items'] = items
        return jsonify(order_dict)
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/user/orders', methods=['GET'])
@token_required
def get_user_orders():
    user_id = request.user['user_id']
    try:
        conn = get_db()
        cursor = conn.cursor()
        query = """
            SELECT o.id, o.order_number, o.created_at, o.order_status as status, 
                   o.total_amount, o.delivery_type, s.status as shipment_status
            FROM orders o
            LEFT JOIN shipments s ON o.id = s.order_id
            WHERE o.user_id = ? 
            ORDER BY o.created_at DESC
        """
        cursor.execute(query, (user_id,))
        orders = [dict(row) for row in cursor.fetchall()]
        
        # Fetch order items with variant snapshot data for each order
        for order in orders:
            cursor.execute('''
                SELECT oi.product_id, oi.quantity, oi.price, oi.subtotal,
                       oi.fitting_charge, oi.product_name, oi.device_model,
                       oi.variant_id, oi.variant_name, oi.variant_options, oi.variant_mrp, oi.variant_sku, oi.variant_image,
                       COALESCE(p.images, '') as images
                FROM order_items oi
                LEFT JOIN products p ON oi.product_id = p.id
                WHERE oi.order_id = ?
            ''', (str(order['id']),))
            items = [dict(row) for row in cursor.fetchall()]
            for item in items:
                if item.get('variant_id'):
                    item['variant_info'] = {
                        'variant_id': item.get('variant_id'),
                        'variant_name': item.get('variant_name'),
                        'variant_options': item.get('variant_options'),
                        'variant_mrp': item.get('variant_mrp'),
                        'variant_sku': item.get('variant_sku'),
                        'variant_image': item.get('variant_image'),
                    }
            order['items'] = items
        conn.close()
        return jsonify(orders), 200
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/order/<int:order_id>/tracking', methods=['GET'])
@token_required
def get_order_tracking(order_id):
    user_id = request.user['user_id']
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT o.order_status, o.estimated_delivery, dp.name as rider_name, dp.phone as rider_phone 
            FROM orders o 
            LEFT JOIN delivery_partners dp ON o.delivery_partner_id = dp.id 
            WHERE o.id = ? AND o.user_id = ?
        ''', (order_id, user_id))
        tracking_data = cursor.fetchone()
        
        # Fetch order items with variant snapshot data
        cursor.execute('''
            SELECT oi.product_id, oi.quantity, oi.price, oi.subtotal,
                   oi.fitting_charge, oi.product_name, oi.device_model,
                   oi.variant_id, oi.variant_name, oi.variant_options, oi.variant_mrp, oi.variant_sku, oi.variant_image,
                   COALESCE(p.images, '') as images
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = ?
        ''', (str(order_id),))
        items = [dict(row) for row in cursor.fetchall()]
        
        for item in items:
            if item.get('variant_id'):
                item['variant_info'] = {
                    'variant_id': item.get('variant_id'),
                    'variant_name': item.get('variant_name'),
                    'variant_options': item.get('variant_options'),
                    'variant_mrp': item.get('variant_mrp'),
                    'variant_sku': item.get('variant_sku'),
                    'variant_image': item.get('variant_image'),
                }
        
        conn.close()
        
        if tracking_data:
            return jsonify({
                "order_status": tracking_data['order_status'],
                "assigned_rider": {
                    "name": tracking_data['rider_name'],
                    "phone": tracking_data['rider_phone']
                } if tracking_data['rider_name'] else None,
                "estimated_delivery_time": tracking_data['estimated_delivery'],
                "items": items
            })
        return error_response("Order not found", 404)
    except Exception as e:
        return error_response(str(e), 500)

# Order statuses an admin may set manually via /api/admin/order/<id>/status.
# Arbitrary strings (e.g. 'HACKED') must never be written into orders.order_status.
ALLOWED_ADMIN_ORDER_STATUSES = {
    'PLACED', 'CONFIRMED', 'PACKING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY',
    'DELIVERED', 'CANCELLED', 'REFUNDED', 'REJECTED',
}
# Statuses that are final — an order in one of these cannot be moved anywhere else.
# Prevents resurrecting finished orders (protects stock accounting and prevents
# double-decrement / double referral-reward scenarios).
TERMINAL_ORDER_STATUSES = {'DELIVERED', 'CANCELLED', 'REFUNDED', 'REJECTED'}


def handle_stock_on_status_change(cursor, order_id, old_status, new_status):
    """Adjusts inventory based on order status transitions."""
    if old_status == new_status:
        return

    # Transitions to DELIVERED: Stock is already reduced at checkout. 
    # No action needed for stock_quantity.
    if new_status == 'DELIVERED' and old_status != 'DELIVERED':
        pass

    # Transitions to CANCELLED/REFUNDED/REJECTED after confirmation: add global
    # stock AND warehouse inventory back (the decrement at confirm time reduces
    # both, so both must be restored or warehouse partner stock is lost forever).
    elif (
        new_status in ['CANCELLED', 'REFUNDED', 'REJECTED']
        and old_status in ['CONFIRMED', 'PACKING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY']
    ):
        cursor.execute("SELECT dark_store_id FROM orders WHERE id = ?", (order_id,))
        order_row = cursor.fetchone()
        store_id = order_row['dark_store_id'] if order_row else None

        cursor.execute("SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = ?", (order_id,))
        items = cursor.fetchall()
        for item in items:
            if item['variant_id']:
                cursor.execute(
                    "UPDATE product_variants SET stock = stock + ? WHERE id = ? AND product_id = ?",
                    (item['quantity'], item['variant_id'], item['product_id'])
                )
            cursor.execute(
                "UPDATE products SET stock = stock + ? WHERE id = ?",
                (item['quantity'], item['product_id'])
            )
            # Mirror the confirm-time warehouse_inventory decrement (same WHERE
            # shape, variant-aware) so warehouse partner stock is restored too.
            if store_id:
                if item['variant_id']:
                    cursor.execute(
                        """UPDATE warehouse_inventory
                           SET stock_quantity = COALESCE(stock_quantity, 0) + ?,
                               available_stock = COALESCE(available_stock, 0) + ?
                           WHERE (warehouse_id = ? OR warehouse_partner_id = ?) AND product_id = ? AND variant_id = ?""",
                        (item['quantity'], item['quantity'], store_id, store_id, item['product_id'], item['variant_id'])
                    )
                else:
                    cursor.execute(
                        """UPDATE warehouse_inventory
                           SET stock_quantity = COALESCE(stock_quantity, 0) + ?,
                               available_stock = COALESCE(available_stock, 0) + ?
                           WHERE (warehouse_id = ? OR warehouse_partner_id = ?) AND product_id = ?""",
                        (item['quantity'], item['quantity'], store_id, store_id, item['product_id'])
                    )
@app.route('/api/admin/order/<int:order_id>/status', methods=['PATCH'])
@token_required
@require_admin()
@require_permission("manage_orders")
def admin_update_order_status(order_id):
    data = request.json
    new_status = data.get('status', '').upper()

    # Whitelist: only real lifecycle statuses may be set. Arbitrary strings (e.g.
    # 'HACKED') can no longer be written into orders.order_status.
    if new_status not in ALLOWED_ADMIN_ORDER_STATUSES:
        return error_response(f"Invalid order status '{new_status}'", 400)

    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Get current status
        cursor.execute("SELECT order_status FROM orders WHERE id = ?", (order_id,))
        current_status_row = cursor.fetchone()
        if current_status_row is None:
            conn.close()
            return error_response("Order not found", 404)
        old_status = current_status_row['order_status'] if current_status_row else None

        # Terminal states (DELIVERED/CANCELLED/REFUNDED/REJECTED) are final — an
        # order cannot be resurrected from them.
        if old_status in TERMINAL_ORDER_STATUSES and new_status != old_status:
            conn.close()
            return error_response(f"Cannot change status of a {old_status} order", 400)

        handle_stock_on_status_change(cursor, order_id, old_status, new_status)

        timestamp_col = None
        if new_status == 'PACKED': timestamp_col = "packed_at"
        elif new_status == 'SHIPPED': timestamp_col = "shipped_at"
        elif new_status == 'DELIVERED': timestamp_col = "delivered_at"
        
        if timestamp_col:
            cursor.execute(f"UPDATE orders SET order_status = ?, {timestamp_col} = CURRENT_TIMESTAMP WHERE id = ?", (new_status, order_id))
        else:
            cursor.execute("UPDATE orders SET order_status = ? WHERE id = ?", (new_status, order_id))

        # Notify user about status update
        cursor.execute("SELECT user_id, total_amount FROM orders WHERE id = ?", (order_id,))
        user_row = cursor.fetchone()
        if user_row:
            user_id = user_row['user_id']
            order_amount = user_row['total_amount']
            notification_service.send_order_notification(user_id, order_id, new_status)
            # Check for app review eligibility
            check_and_trigger_review(cursor, user_id)

            if new_status == 'DELIVERED':
                # Referral reward check (additive)
                try:
                    from utils.referral import process_referral_reward
                    process_referral_reward(order_id, user_id, order_amount)
                except Exception:
                    pass  # never break order flow

        if new_status == 'DELIVERED':
            # Free the delivery partner
            cursor.execute("UPDATE delivery_partners SET status = 'AVAILABLE', active_order_id = NULL WHERE active_order_id = ?", (order_id,))
            
        conn.commit()
        conn.close()
        log_admin_action(request.user.get('user_id'), "order_modified", "order", order_id)
        log_admin_event(
            request.user.get('user_id'),
            "admin_cancelled_order" if new_status == "CANCELLED" else "admin_modified_order",
            "order",
            order_id,
            f"Updated order status to {new_status}",
        )
        run_admin_anomaly_check(
            request.user.get('user_id'),
            "admin_cancelled_order" if new_status == "CANCELLED" else "admin_modified_order",
        )
        return success_response(None, f"Order status updated to {new_status}")
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/admin/users/<int:user_id>/cod-restriction', methods=['PATCH'])
@token_required
@require_admin()
@require_permission("manage_users")
def admin_toggle_user_cod_restriction(user_id):
    data = request.json
    restricted = 1 if data.get('restricted') else 0
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("UPDATE users SET cod_restricted = ? WHERE id = ?", (restricted, user_id))
        conn.commit()
        conn.close()
        return success_response(None, f"User COD restriction {'enabled' if restricted else 'disabled'}")
    except Exception as e:
        return error_response(str(e), 500)

# ==============================================================================
# USER PROFILE & MANAGEMENT
# ==============================================================================

@app.route('/api/user/profile', methods=['GET', 'PUT'])
@token_required
def user_profile():
    """Retrieves or updates the authenticated user's profile information."""
    user_id = request.user['user_id']
    if request.method == 'GET':
        try:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT id, name, email, profile_image, phone, gender, date_of_birth, age, about, terms_accepted_version, terms_accepted_at, email_verified, phone_verified FROM users WHERE id = ?", (user_id,))
            user = cursor.fetchone()
            conn.close()
            if not user:
                return error_response("User not found", 404)
            return jsonify(dict(user))
        except Exception as e:
            return error_response(str(e), 500)
    else:
        data = request.form.to_dict() if request.form else request.get_json(silent=True) or {}
        name = data.get('name')
        phone = data.get('phone')
        gender = data.get('gender')
        dob = data.get('date_of_birth')
        about = data.get('about')
        age_raw = str(data.get('age') or '').strip()
        age = int(age_raw) if age_raw.isdigit() and 1 <= int(age_raw) <= 120 else None
        
        image_url = None
        if 'file' in request.files:
            file = request.files['file']
            if file and allowed_file(file.filename):
                is_valid, error = validate_image_file(file)
                if not is_valid:
                    return error_response(error, 400)
                # 1. Try uploading to persistent cloud storage first
                try:
                    from services.cloud_image_service import upload_file_object_to_cloud
                    cloud_url = upload_file_object_to_cloud(file)
                    if cloud_url:
                        logger.info(f"Successfully uploaded profile image to cloud: {cloud_url}")
                        image_url = cloud_url
                except Exception as e:
                    logger.error(f"Cloud upload failed for profile image: {str(e)}")

                # 2. Fallback to local storage if cloud storage fails or is unconfigured
                if not image_url:
                    logger.warning("Cloud upload failed for profile image. Falling back to ephemeral local storage.")
                    filename = secure_filename(file.filename)
                    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                    # Performance: resize + re-encode before saving. Same URL,
                    # smaller file — optimize_and_save is internally failsafe
                    # and saves the original bytes on any processing failure.
                    from utils.image_optimizer import optimize_and_save
                    optimize_and_save(file, filepath)
                    image_url = f"/static/uploads/{filename}"
                
        try:
            conn = get_db()
            cursor = conn.cursor()
            updates = []
            params = []
            if name:
                updates.append('name = ?')
                params.append(name)
            if phone:
                updates.append('phone = ?')
                params.append(phone)
            if gender:
                updates.append('gender = ?')
                params.append(gender)
            if dob:
                updates.append('date_of_birth = ?')
                params.append(dob)
            if age is not None:
                updates.append('age = ?')
                params.append(age)
            if about is not None:
                updates.append('about = ?')
                params.append(str(about)[:500])
            if image_url:
                updates.append('profile_image = ?')
                params.append(image_url)
            
            if updates:
                params.append(user_id)
                cursor.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", tuple(params))
                conn.commit()
                
            cursor.execute("SELECT id, name, email, profile_image, phone, gender, date_of_birth, age, about, terms_accepted_version, terms_accepted_at, email_verified, phone_verified FROM users WHERE id = ?", (user_id,))
            user = cursor.fetchone()
            conn.close()
            return jsonify(dict(user))
        except Exception as e:
            return error_response(str(e), 500)


@app.route('/api/user/terms/accept', methods=['POST'])
@token_required
def accept_terms():
    """Marks the authenticated user as having accepted the latest Terms & Conditions."""
    user_id = request.user['user_id']
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM system_settings WHERE key = ?", ('terms_and_conditions_version',))
        row = cursor.fetchone()
        current_ver = 1
        try:
            current_ver = int(row['value']) if row and row['value'] is not None else 1
        except Exception:
            current_ver = 1

        cursor.execute(
            "UPDATE users SET terms_accepted_version = ?, terms_accepted_at = CURRENT_TIMESTAMP WHERE id = ?",
            (current_ver, user_id),
        )
        conn.commit()

        cursor.execute("SELECT id, name, email, profile_image, phone, gender, date_of_birth, about, terms_accepted_version, terms_accepted_at, email_verified, phone_verified FROM users WHERE id = ?", (user_id,))
        user = cursor.fetchone()
        conn.close()
        return jsonify(dict(user))
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/user/addresses', methods=['GET', 'POST', 'PUT', 'DELETE'])
@token_required
def manage_addresses():
    """CRUD operations for user delivery addresses."""
    user_id = request.user['user_id']
    data = request.get_json(silent=True) or {}
    try:
        conn = get_db()
        cursor = conn.cursor()
        if request.method == 'GET':
            cursor.execute("SELECT * FROM user_addresses WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
            addrs = [dict(row) for row in cursor.fetchall()]
            conn.close()
            return jsonify(addrs)
            
        elif request.method == 'POST':
            fields = ['full_name', 'phone', 'house', 'city', 'state', 'pincode', 'landmark', 'is_default']
            vals = [data.get(f) for f in fields]
            cursor.execute(
                "INSERT INTO user_addresses (user_id, full_name, phone, house, city, state, pincode, landmark, is_default) VALUES (?,?,?,?,?,?,?,?,?)",
                (user_id,) + tuple(vals)
            )
            conn.commit()
            addr_id = cursor.lastrowid
            if data.get('is_default'):
                cursor.execute("UPDATE user_addresses SET is_default = 0 WHERE user_id = ? AND id != ?", (user_id, addr_id))
                conn.commit()
            cursor.execute("SELECT * FROM user_addresses WHERE id = ?", (addr_id,))
            newaddr = dict(cursor.fetchone())
            conn.close()
            return jsonify(newaddr), 201
            
        elif request.method == 'PUT':
            addr_id = data.get('id')
            if not addr_id:
                return error_response("id required", 400)
            updates = []
            params = []
            for f in ['full_name', 'phone', 'house', 'city', 'state', 'pincode', 'landmark', 'is_default']:
                if f in data:
                    updates.append(f + " = ?")
                    params.append(data.get(f))
            if updates:
                params.append(addr_id)
                cursor.execute(f"UPDATE user_addresses SET {', '.join(updates)} WHERE id = ? AND user_id = ?", tuple(params + [user_id]))
                conn.commit()
                if data.get('is_default'):
                    cursor.execute("UPDATE user_addresses SET is_default = 0 WHERE user_id = ? AND id != ?", (user_id, addr_id))
                    conn.commit()
            cursor.execute("SELECT * FROM user_addresses WHERE id = ?", (addr_id,))
            updated = cursor.fetchone()
            conn.close()
            if not updated:
                return error_response("Address not found", 404)
            return jsonify(dict(updated))
            
        else: # DELETE
            addr_id = data.get('id')
            if not addr_id:
                return error_response("id required", 400)
            cursor.execute("DELETE FROM user_addresses WHERE id = ? AND user_id = ?", (addr_id, user_id))
            conn.commit()
            conn.close()
            return success_response(None, "Deleted")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/user/wishlist', methods=['GET', 'POST', 'DELETE'])
@token_required
def user_wishlist():
    """Manages the user's product wishlist."""
    user_id = request.user['user_id']
    data = request.get_json(silent=True) or {}
    try:
        conn = get_db()
        cursor = conn.cursor()
        if request.method == 'GET':
            cursor.execute("SELECT w.id, p.* FROM wishlist w JOIN products p ON p.id = w.product_id WHERE w.user_id = ?", (user_id,))
            items = [dict(row) for row in cursor.fetchall()]
            conn.close()
            return jsonify(items)
        elif request.method == 'POST':
            prod = data.get('product_id')
            if not prod:
                return error_response("product_id required", 400)
            cursor.execute("INSERT OR IGNORE INTO wishlist (user_id, product_id) VALUES (?,?)", (user_id, prod))
            conn.commit()
            conn.close()
            return success_response(None, "added", 201)
        else:
            prod = data.get('product_id')
            cursor.execute("DELETE FROM wishlist WHERE user_id = ? AND product_id = ?", (user_id, prod))
            conn.commit()
            conn.close()
            return success_response(None, "removed")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/user/wallet', methods=['GET'])
@token_required
def user_wallet():
    """Returns the wallet balance and transaction history for the user.

    Wallet credits are only created by server-side flows (referral rewards,
    refunds, admin adjustments) via utils.wallet.add_wallet_credit. This
    endpoint is read-only; users cannot self-credit their own wallet.
    """
    user_id = request.user['user_id']
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT balance FROM wallet WHERE user_id = ?", (user_id,))
        bal = cursor.fetchone()
        if not bal:
            cursor.execute("INSERT INTO wallet(user_id, balance) VALUES(?,?)", (user_id, 0))
            conn.commit()
            balance = 0
        else:
            balance = bal['balance']
        cursor.execute("SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
        txs = [dict(r) for r in cursor.fetchall()]
        conn.close()
        return jsonify({"balance": balance, "transactions": txs})
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/user/notifications', methods=['GET', 'PUT'])
@token_required
def user_notifications():
    """Retrieves or marks notifications as read for the user."""
    user_id = request.user['user_id']
    try:
        conn = get_db()
        cursor = conn.cursor()
        if request.method == 'GET':
            cursor.execute("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
            notes = [dict(r) for r in cursor.fetchall()]
            conn.close()
            return jsonify(notes)
        else:
            data = request.get_json(silent=True) or {}
            nid = data.get('id')
            if nid:
                cursor.execute("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?", (nid, user_id))
            else:
                cursor.execute("UPDATE notifications SET is_read = 1 WHERE user_id = ?", (user_id,))
            conn.commit()
            conn.close()
            return success_response(None, "marked")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/user/support', methods=['GET', 'POST'])
@token_required
def user_support():
    """Retrieves support tickets or creates a new one."""
    user_id = request.user['user_id']
    try:
        conn = get_db()
        cursor = conn.cursor()
        if request.method == 'GET':
            cursor.execute("SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
            tickets = [dict(r) for r in cursor.fetchall()]
            conn.close()
            return jsonify(tickets)
        else:
            data = request.get_json(silent=True) or {}
            subject = data.get('subject')
            message = data.get('message')
            if not subject or not message:
                return error_response("subject and message required", 400)
            cursor.execute("INSERT INTO support_tickets (user_id, subject, message) VALUES (?,?,?)", (user_id, subject, message))
            conn.commit()
            nid = cursor.lastrowid
            cursor.execute("SELECT * FROM support_tickets WHERE id = ?", (nid,))
            ticket = dict(cursor.fetchone())
            conn.close()
            return jsonify(ticket), 201
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/user/login-history', methods=['GET'])
@token_required
def user_login_history():
    """Retrieves the login history for the authenticated user."""
    user_id = request.user['user_id']
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM login_history WHERE user_id = ? ORDER BY timestamp DESC", (user_id,))
        logs = [dict(r) for r in cursor.fetchall()]
        conn.close()
        return jsonify(logs)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/user/payments', methods=['GET', 'POST', 'DELETE'])
@token_required
def user_payments():
    """Manages saved payment methods for the user."""
    user_id = request.user['user_id']
    data = request.get_json(silent=True) or {}
    try:
        conn = get_db()
        cursor = conn.cursor()
        if request.method == 'GET':
            cursor.execute("SELECT id, method_type, last4, created_at FROM saved_payments WHERE user_id = ?", (user_id,))
            pys = [dict(r) for r in cursor.fetchall()]
            conn.close()
            return jsonify(pys)
        elif request.method == 'POST':
            mtype = data.get('method_type')
            token_val = data.get('token')
            last4 = data.get('last4')
            if not mtype or not token_val:
                return error_response("method_type and token required", 400)
            cursor.execute("INSERT INTO saved_payments (user_id, method_type, token, last4) VALUES (?,?,?,?)", (user_id, mtype, token_val, last4))
            conn.commit()
            conn.close()
            return success_response(None, "saved", 201)
        else: # DELETE
            pid = data.get('id')
            cursor.execute("DELETE FROM saved_payments WHERE user_id = ? AND id = ?", (user_id, pid))
            conn.commit()
            conn.close()
            return success_response(None, "deleted")
    except Exception as e:
        return error_response(str(e), 500)

# ==============================================================================
# ADMIN: USER & COMMUNICATION
# ==============================================================================

@app.route('/api/admin/users', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
def get_admin_users():
    """Retrieves a paginated list of users with basic analytics."""
    try:
        page = request.args.get('page', 1, type=int)
        limit = request.args.get('limit', 20, type=int)
        search = request.args.get('search', '').strip()
        status = request.args.get('status', '').strip()
        offset = (page - 1) * limit
        
        conn = get_db()
        cursor = conn.cursor()
        query = """
            SELECT u.*, 
                   (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) as total_orders, 
                   (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND UPPER(o.order_status) = 'CANCELLED') as cancelled_orders 
            FROM users u WHERE 1=1
        """
        params = []
        if search:
            query += " AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)"
            pat = f"%{search}%"
            params.extend([pat, pat, pat])
        if status:
            query += " AND account_status = ?"
            params.append(status)
            
        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        cursor.execute(query, params)
        users = [dict(row) for row in cursor.fetchall()]
        
        cursor.execute("SELECT COUNT(*) as total, SUM(CASE WHEN account_status = 'active' THEN 1 ELSE 0 END) as active, SUM(CASE WHEN account_status = 'suspended' THEN 1 ELSE 0 END) as suspended FROM users")
        stats = dict(cursor.fetchone())
        cursor.execute("SELECT COUNT(*) as new_today FROM users WHERE DATE(created_at) = DATE('now')")
        stats['new_today'] = cursor.fetchone()['new_today']
        conn.close()
        
        return jsonify({
            "users": users,
            "analytics": stats
        })
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/users/<int:user_id>', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
def get_admin_user_details(user_id):
    """Retrieves detailed information and order history for a specific user."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        user = cursor.fetchone()
        if not user:
            conn.close()
            return error_response("User not found", 404)
            
        user_dict = dict(user)
        cursor.execute("SELECT id, order_number, created_at, order_status, total_amount, delivery_type FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", (user_id,))
        orders = [dict(row) for row in cursor.fetchall()]
        user_dict['orders'] = orders
        
        cursor.execute("SELECT SUM(total_amount) as total_spent, COUNT(*) as cancelled_count FROM orders WHERE user_id = ? AND order_status = 'CANCELLED'", (user_id,))
        stats = cursor.fetchone()
        user_dict['total_spent'] = stats['total_spent'] or 0
        user_dict['cancelled_count'] = stats['cancelled_count'] or 0
        conn.close()
        return jsonify(user_dict)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/users/<int:user_id>/status', methods=['PATCH'])
@token_required
@require_admin()
@require_permission("manage_users")
def update_user_account_status(user_id):
    """Updates a user's account status (e.g., active, suspended)."""
    status = request.json.get('status')
    reason = request.json.get('reason')
    if not status:
        return error_response("status required", 400)
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT name, email FROM users WHERE id = ?", (user_id,))
        user_row = cursor.fetchone()

        cursor.execute("UPDATE users SET account_status = ? WHERE id = ?", (status, user_id))
        conn.commit()

        if user_row:
            from threading import Thread
            Thread(target=send_user_status_update_email, args=(user_row['email'], user_row['name'], status, reason)).start()

        conn.close()
        return success_response(None, f"User status updated to {status}")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/users/<int:user_id>/logout-all', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_users")
def admin_logout_user_all_devices(user_id):
    """Invalidates all current sessions for a user by updating min_token_iat."""
    try:
        now_ts = int(time.time())
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if user exists
        user = cursor.execute("SELECT id, name, email FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            conn.close()
            return error_response("User not found", 404)
            
        cursor.execute("UPDATE users SET min_token_iat = ? WHERE id = ?", (now_ts, user_id))
        conn.commit()
        
        # Log admin action
        log_admin_event(
            request.user['user_id'],
            "user_logout_all_devices",
            "users",
            user_id,
            f"Logged out user {user['email']} from all devices",
        )

        # Trigger Security Email Notification in Background
        from threading import Thread
        from notifier import send_security_logout_email
        Thread(target=send_security_logout_email, args=(user['email'], user['name'])).start()
        
        conn.close()
        return success_response(None, f"User {user['name']} has been logged out from all devices.")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/users/<int:user_id>/send-email', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_users")
def send_manual_user_email(user_id):
    """Sends a manual email to a specific user and records it in history."""
    subject = request.json.get('subject')
    message = request.json.get('message')
    
    if not subject or not message:
        return error_response("Subject and message are required", 400)
        
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT name, email FROM users WHERE id = ?", (user_id,))
        user_row = cursor.fetchone()
        conn.close()
        
        if not user_row:
            return error_response("User not found", 404)
            
        try:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO mail_history (admin_id, recipient_type, recipient_email, subject, message)
                VALUES (?, ?, ?, ?, ?)
            ''', (request.user.get('user_id'), 'individual', user_row['email'], subject, message))
            conn.commit()
            conn.close()
        except Exception as db_err:
            logger.error(f"Failed to record mail history: {str(db_err)}")

        # Send email synchronously to catch errors
        success = send_individual_email(user_row['email'], user_row['name'], subject, message)

        if success:
            return success_response(None, f"Email successfully sent to {user_row['email']}")
        else:
            return error_response(f"Failed to send email to {user_row['email']}. Check SMTP settings.", 500)
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/user/app-installed', methods=['POST'])
@token_required
@limiter.limit("5 per hour")
def user_app_installed():
    """Records that the logged-in user installed the app (PWA added to home
    screen). When a user later uninstalls, push can no longer reach them —
    email still can, so admins can target app-installed users specifically.
    Idempotent: the original install timestamp is kept on repeated reports."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET app_installed = 1, app_installed_at = COALESCE(app_installed_at, CURRENT_TIMESTAMP) WHERE id = ?",
            (request.user['user_id'],),
        )
        conn.commit()
        conn.close()
        return success_response(None, "App install recorded")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/notifications/bulk', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_admins")
def send_bulk_notices():
    """Sends a bulk email notification to all registered users (or only users
    who installed the app, when app_installed_only is set — those users can no
    longer be reached by push after uninstalling, so email is the fallback)."""
    data = request.get_json(silent=True) or {}
    subject = data.get('subject')
    message = data.get('message')
    app_installed_only = data.get('app_installed_only', False) in (True, 'true', '1', 1)
    
    if not subject or not message:
        return error_response("Subject and message are required", 400)
        
    try:
        conn = get_db()
        cursor = conn.cursor()
        if app_installed_only:
            cursor.execute("SELECT email FROM users WHERE email IS NOT NULL AND app_installed = 1")
            recipient_type = 'bulk_app_installed'
        else:
            cursor.execute("SELECT email FROM users WHERE email IS NOT NULL")
            recipient_type = 'bulk'
        user_emails = [row['email'] for row in cursor.fetchall()]
        conn.close()
        
        if not user_emails:
            return error_response("No matching users found", 404)
            
        try:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO mail_history (admin_id, recipient_type, recipient_count, subject, message)
                VALUES (?, ?, ?, ?, ?)
            ''', (request.user.get('user_id'), recipient_type, len(user_emails), subject, message))
            conn.commit()
            conn.close()
        except Exception as db_err:
            logger.error(f"Failed to record bulk mail history: {str(db_err)}")

        from threading import Thread
        Thread(target=send_bulk_notification_email, args=(user_emails, subject, message)).start()
        
        target_label = "app-installed users" if app_installed_only else "users"
        return success_response(None, f"Bulk notification process started for {len(user_emails)} {target_label}")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/notifications/in-app-broadcast', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_admins")
def admin_in_app_broadcast():
    """Creates an in-app notification for all users (admin broadcast) and
    delivers a VAPID web push to every user who opted in for push."""
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    message = (data.get('message') or '').strip()
    ntype = (data.get('type') or 'SYSTEM').strip() or 'SYSTEM'
    # Admins can choose whether the broadcast also reaches phones (default ON).
    send_push = data.get('send_push', True) not in (False, 'false', '0', 0)

    if not title or not message:
        return error_response("Title and message are required", 400)

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE id IS NOT NULL")
        user_ids = [row['id'] for row in cursor.fetchall()]

        if not user_ids:
            conn.close()
            return error_response("No users found", 404)

        cursor.executemany(
            "INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)",
            [(uid, title, message, ntype) for uid in user_ids],
        )
        conn.commit()
        conn.close()

        # Deliver phone (VAPID web) push to every subscribed user in the
        # background so the API responds instantly. Only users who opted in
        # via the browser get a push — the in-app rows above cover everyone.
        if send_push:
            try:
                from notifications.notification_service import notification_service
                from threading import Thread
                Thread(
                    target=notification_service.send_broadcast_web_push,
                    args=(title, message, ntype),
                    daemon=True,
                ).start()
            except Exception as push_err:
                logger.error(f"Failed to start push broadcast: {push_err}")

        return success_response(
            {"count": len(user_ids)},
            f"In-app notification created for {len(user_ids)} users",
        )
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/mail-history', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
def get_mail_history():
    """Retrieves a history of emails sent by administrators."""
    try:
        page = request.args.get('page', 1, type=int)
        limit = request.args.get('limit', 10, type=int)
        offset = (page - 1) * limit
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT mh.*, u.name as admin_name, u.email as admin_email
            FROM mail_history mh
            JOIN users u ON u.id = mh.admin_id
            ORDER BY mh.sent_at DESC
            LIMIT ? OFFSET ?
        ''', (limit, offset))
        history = [dict(row) for row in cursor.fetchall()]
        
        cursor.execute("SELECT COUNT(*) as total FROM mail_history")
        total = cursor.fetchone()['total']
        
        conn.close()
        return jsonify({
            "history": history,
            "total": total,
            "page": page,
            "limit": limit
        }), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/warehouse/applications/<int:app_id>/send-email', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_inventory")
def send_warehouse_applicant_email(app_id):
    """Sends an email to a warehouse partner applicant."""
    data = request.json
    subject = data.get('subject')
    message = data.get('message')
    
    if not subject or not message:
        return error_response("Subject and message are required", 400)
        
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT email, owner_name, warehouse_name FROM warehouse_applications WHERE id = ?", (app_id,))
        app_row = cursor.fetchone()
        
        if not app_row:
            conn.close()
            return error_response("Warehouse application not found", 404)
            
        recipient_email = app_row['email']
        recipient_name = app_row['owner_name'] or app_row['warehouse_name'] or 'Warehouse Partner'
        
        try:
            cursor.execute('''
                INSERT INTO mail_history (admin_id, recipient_type, recipient_email, subject, message)
                VALUES (?, ?, ?, ?, ?)
            ''', (request.user.get('user_id'), 'individual', recipient_email, subject, message))
            conn.commit()
        except Exception as db_err:
            logger.error(f"Failed to record warehouse applicant email history: {str(db_err)}")
            
        conn.close()
        from threading import Thread
        from notifier import send_individual_email
        Thread(target=send_individual_email, args=(recipient_email, recipient_name, subject, message)).start()
        
        return success_response(None, f"Email sent to {recipient_email}", 200)
    except Exception as e:
        return error_response(str(e), 500)


# ==============================================================================
# ADMIN: SYSTEM ANALYTICS
# ==============================================================================

@app.route('/api/admin/metrics', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
def get_admin_metrics():
    """Retrieves high-level operational metrics (success rates, error counts, etc.)."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        try:
            cursor.execute("SELECT payment_status, COUNT(*) as count FROM payments GROUP BY payment_status")
            payment_stats = {row['payment_status']: row['count'] for row in cursor.fetchall()}
            total_payments = sum(payment_stats.values()) or 1
            success_rate = (payment_stats.get('SUCCESS', 0) / total_payments) * 100
        except sqlite3.OperationalError:
            success_rate = 100.0
        
        try:
            with open('backend/logs/app.log', 'r') as f:
                errors = sum(1 for line in f if 'ERROR' in line)
        except:
            errors = 0
            
        try:
            cursor.execute("SELECT COUNT(*) as count FROM delivery_partners WHERE status = 'AVAILABLE'")
            available_riders = cursor.fetchone()['count']
        except sqlite3.OperationalError:
            available_riders = 0
        
        cursor.execute("SELECT COUNT(*) as count FROM products WHERE stock <= low_stock_threshold")
        global_low_stock = cursor.fetchone()['count']
        conn.close()
        
        return jsonify({
            "payment_success_rate": f"{success_rate:.1f}%",
            "system_errors_24h": errors,
            "available_riders": available_riders,
            "global_low_stock": global_low_stock,
            "db_status": "Healthy",
            "uptime": "99.9%"
        }), 200
    except Exception as e:
        return error_response("Failed to fetch metrics", 500)


@app.route('/api/admin/stats', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
def admin_stats():
    """Retrieves simple summary statistics for the admin dashboard."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                COUNT(*) as total_orders, 
                SUM(
                    CASE 
                        WHEN order_status IN ('PLACED', 'CANCELLED', 'REJECTED') THEN 0
                        WHEN payment_type = 'PREPAID' THEN total_amount
                        ELSE cod_advance_paid
                    END
                ) as total_revenue 
            FROM orders
        """)
        stats = cursor.fetchone()
        cursor.execute("SELECT COUNT(*) as total_users FROM users")
        user_count = cursor.fetchone()
        cursor.execute("SELECT COUNT(*) as low_stock_count FROM products WHERE stock <= low_stock_threshold")
        low_stock = cursor.fetchone()
        conn.close()
        return jsonify({
            "total_orders": stats['total_orders'],
            "total_revenue": stats['total_revenue'] or 0,
            "total_users": user_count['total_users'],
            "low_stock_count": low_stock['low_stock_count']
        })
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/system-stats', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
@cache.cached(timeout=30, query_string=True)
def admin_system_stats():
    """Retrieves detailed system metrics via the metrics utility."""
    try:
        metrics = get_system_stats()
        return jsonify({
            "total_users": metrics["total_users"],
            "total_orders": metrics["total_orders"],
            "active_delivery_partners": metrics["active_delivery_partners"],
            "low_stock_products": metrics["low_stock_products"],
            "daily_revenue": metrics["daily_revenue"],
        }), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/system/health', methods=['GET'])
@token_required
@require_super_admin()
def admin_system_health_detail():
    """Retrieves detailed health metrics for system components."""
    try:
        metrics = get_system_health_metrics()
        return jsonify(metrics), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/system/logs', methods=['GET'])
@token_required
@require_super_admin()
def get_admin_system_logs():
    """Retrieves security alerts, blocked IPs, and failed login logs."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM security_alerts ORDER BY created_at DESC LIMIT 20")
        suspicious = [dict(row) for row in cursor.fetchall()]
        
        blocked = get_blocked_ips()
        
        cursor.execute("SELECT * FROM login_attempts WHERE status = 'failed' ORDER BY timestamp DESC LIMIT 20")
        failed_logins = [dict(row) for row in cursor.fetchall()]
        
        conn.close()
        return jsonify({
            "suspicious_activity": suspicious,
            "blocked_ips": blocked,
            "failed_login_attempts": failed_logins
        }), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/system/self-healing', methods=['GET'])
@token_required
@require_super_admin()
def get_self_healing_status():
    """Retrieves logs and current status of the self-healing system."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM system_recovery_logs ORDER BY timestamp DESC LIMIT 20")
        logs = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({
            "self_healing_mode": False,
            "logs": logs
        }), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/system/self-healing/scan', methods=['POST'])
@token_required
@require_super_admin()
def run_system_scan():
    """Triggers a manual system integrity scan."""
    try:
        report = trigger_system_scan()
        return jsonify(report), 200
    except Exception as e:
        return error_response(str(e), 500)


# ==============================================================================
# ADMIN: INVENTORY & OPERATIONS
# ==============================================================================

@app.route('/api/admin/orders', methods=['GET'])
@token_required
@require_admin()
@require_permission("manage_orders")
def get_admin_orders():
    """Retrieves all orders with customer and store details for administrative review."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        status_filter = (request.args.get('status') or '').strip()
        payment_filter = (request.args.get('payment_status') or '').strip()
        search = (request.args.get('search') or '').strip()
        start_date = (request.args.get('start_date') or '').strip()
        end_date = (request.args.get('end_date') or '').strip()

        where = []
        params = []

        if status_filter and status_filter != 'all':
            where.append("UPPER(o.order_status) = ?")
            params.append(status_filter.upper())

        if payment_filter and payment_filter != 'all':
            where.append("o.payment_status = ?")
            params.append(payment_filter)

        if search:
            like = f"%{search}%"
            where.append("(o.order_number LIKE ? OR u.name LIKE ? OR o.phone LIKE ? OR o.customer_phone LIKE ?)")
            params.extend([like, like, like, like])

        if start_date:
            where.append("date(o.created_at) >= date(?)")
            params.append(start_date)

        if end_date:
            where.append("date(o.created_at) <= date(?)")
            params.append(end_date)

        query = """
            SELECT o.*, u.name as customer_name, u.email as customer_email,
                   COALESCE(ds.store_code, w.partner_id) as store_code,
                   COALESCE(ds.name, w.owner_name, w.partner_id, 'Default Store') as store_name,
                   s.status as shipment_status
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            LEFT JOIN dark_stores ds ON COALESCE(o.store_id, o.dark_store_id) = ds.id
            LEFT JOIN warehouses w ON COALESCE(o.store_id, o.dark_store_id) = w.id
            LEFT JOIN shipments s ON o.id = s.order_id
        """
        if where:
            query += " WHERE " + " AND ".join(where)
        query += " ORDER BY o.created_at DESC"

        cursor.execute(query, params)
        orders = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(orders)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/analytics/top-pages', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
def analytics_top_pages():
    """Top visited pages from the analytics_events table."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT page_path, COUNT(*) AS views,
                   COALESCE(ROUND(AVG(CAST(event_value AS REAL)), 1), 0) AS avg_duration
            FROM analytics_events
            WHERE page_path IS NOT NULL AND page_path != ''
            GROUP BY page_path
            ORDER BY views DESC
            LIMIT 15
        ''')
        data = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({"success": True, "data": data}), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 200


@app.route('/api/admin/analytics/traffic-sources', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
def analytics_traffic_sources():
    """Traffic source breakdown from analytics sessions."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT COALESCE(NULLIF(referrer, ''), 'Direct') AS source, COUNT(*) AS visits
            FROM analytics_sessions
            GROUP BY source
            ORDER BY visits DESC
            LIMIT 15
        ''')
        data = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({"success": True, "data": data}), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 200


@app.route('/api/admin/analytics/onboarding-sources', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
def analytics_onboarding_sources():
    """Where users say they heard about JDLX Mobile (onboarding screen).

    source: friends | relatives | social_media | other; platform carries the
    social network (whatsapp/instagram/facebook/youtube) when social_media was
    chosen. Optional ?days= filter (default 90, max 365).
    """
    try:
        days = 90
        try:
            days = max(1, min(365, int(request.args.get('days', 90))))
        except Exception:
            pass
        conn = get_db()
        cursor = conn.cursor()
        try:
            cursor.execute('''
                SELECT source, COUNT(*) AS count
                FROM onboarding_sources
                WHERE created_at >= datetime('now', ?)
                GROUP BY source
                ORDER BY count DESC
            ''', (f'-{days} days',))
            sources = [dict(row) for row in cursor.fetchall()]

            cursor.execute('''
                SELECT platform, COUNT(*) AS count
                FROM onboarding_sources
                WHERE platform IS NOT NULL AND platform != ''
                  AND created_at >= datetime('now', ?)
                GROUP BY platform
                ORDER BY count DESC
            ''', (f'-{days} days',))
            platforms = [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()
        return jsonify({"success": True, "data": {
            "sources": sources,
            "platforms": platforms,
            "total": sum(int(s['count']) for s in sources),
            "days": days,
        }}), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 200


@app.route('/api/admin/analytics/devices', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
def analytics_devices():
    """Device type breakdown (summary + details)."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT COALESCE(NULLIF(device_type, ''), 'desktop') AS device, COUNT(*) AS count
            FROM analytics_sessions
            GROUP BY device
            ORDER BY count DESC
        ''')
        rows = cursor.fetchall()
        conn.close()
        summary = {"mobile": 0, "desktop": 0, "tablet": 0}
        details = []
        for row in rows:
            device = (row['device'] or 'desktop').lower()
            count = row['count']
            if 'mobile' in device:
                summary['mobile'] += count
            elif 'tablet' in device:
                summary['tablet'] += count
            else:
                summary['desktop'] += count
            details.append({"device": row['device'], "count": count})
        return jsonify({"success": True, "data": {"summary": summary, "details": details}}), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 200


@app.route('/api/admin/analytics/searches', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
def analytics_searches():
    """Top search queries."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT query, COUNT(*) AS count
            FROM search_queries
            WHERE query IS NOT NULL AND query != ''
            GROUP BY query
            ORDER BY count DESC
            LIMIT 15
        ''')
        data = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({"success": True, "data": data}), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 200


@app.route('/api/admin/analytics/funnel', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
def analytics_funnel():
    """Conversion funnel from analytics events (view -> cart -> checkout -> purchase)."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        # Normalize event types to funnel stages; unknown events are skipped.
        cursor.execute('''
            SELECT
                CASE
                    WHEN LOWER(event_type) LIKE '%purchase%' OR LOWER(event_type) LIKE '%order%' THEN 'purchase'
                    WHEN LOWER(event_type) LIKE '%checkout%' THEN 'checkout'
                    WHEN LOWER(event_type) LIKE '%cart%' OR LOWER(event_type) LIKE '%add_to_cart%' THEN 'add_to_cart'
                    WHEN LOWER(event_type) LIKE '%view%' OR LOWER(event_type) LIKE '%page%' THEN 'view'
                    ELSE NULL
                END AS stage,
                COUNT(*) AS count
            FROM analytics_events
            GROUP BY stage
            HAVING stage IS NOT NULL
        ''')
        rows = cursor.fetchall()
        conn.close()
        order = ['view', 'add_to_cart', 'checkout', 'purchase']
        by_stage = {r['stage']: r['count'] for r in rows if r['stage']}
        steps = []
        total = by_stage.get('view', 0) or 1
        for stage in order:
            count = by_stage.get(stage, 0)
            percentage = round((count / total) * 100, 1) if total else 0
            steps.append({"name": stage.replace('_', ' ').title(), "count": count, "percentage": percentage})
        return jsonify({"success": True, "data": {"steps": steps}}), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 200


@app.route('/api/admin/analytics/user-journeys', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
def analytics_user_journeys():
    """Most common page-to-page transitions."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            WITH ordered AS (
                SELECT session_id, page_path,
                       LAG(page_path) OVER (PARTITION BY session_id ORDER BY created_at) AS prev_path
                FROM analytics_events
                WHERE page_path IS NOT NULL AND page_path != ''
            )
            SELECT prev_path AS from_page, page_path AS to_page, COUNT(*) AS count
            FROM ordered
            WHERE prev_path IS NOT NULL AND prev_path != page_path
            GROUP BY from_page, to_page
            ORDER BY count DESC
            LIMIT 15
        ''')
        data = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify({"success": True, "data": data}), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 200


@app.route('/api/admin/cancelled-analytics', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
def get_cancelled_analytics():
    """Retrieves detailed stats, timelines, reasons and user information for cancelled and rejected orders."""
    try:
        conn = get_db()
        cursor = conn.cursor()

        # 1. Main detailed list of cancelled/rejected orders (Only confirmed orders that were later cancelled/rejected)
        cursor.execute("""
            SELECT o.id, o.order_number, o.user_id, o.total_amount, o.order_status, 
                   COALESCE(o.cancelled_at, o.updated_at) as cancelled_at, 
                   COALESCE(o.cancellation_reason, 'No reason specified') as cancellation_reason,
                   COALESCE(u.name, o.customer_name, 'Guest Customer') as customer_name,
                   COALESCE(u.email, 'N/A') as customer_email
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            WHERE o.order_status IN ('CANCELLED', 'REJECTED')
              AND o.confirmed_at IS NOT NULL
            ORDER BY cancelled_at DESC
        """)
        orders_list = [dict(row) for row in cursor.fetchall()]

        # 2. Monthly cancellations trend
        cursor.execute("""
            SELECT strftime('%Y-%m', COALESCE(o.cancelled_at, o.updated_at)) as period,
                   COUNT(*) as count,
                   ROUND(SUM(o.total_amount), 2) as total_amount
            FROM orders o
            WHERE o.order_status IN ('CANCELLED', 'REJECTED')
              AND o.confirmed_at IS NOT NULL
            GROUP BY period
            ORDER BY period ASC
        """)
        monthly_trends = [dict(row) for row in cursor.fetchall()]

        # 3. Weekly cancellations trend
        cursor.execute("""
            SELECT strftime('%Y-W%W', COALESCE(o.cancelled_at, o.updated_at)) as period,
                   COUNT(*) as count,
                   ROUND(SUM(o.total_amount), 2) as total_amount
            FROM orders o
            WHERE o.order_status IN ('CANCELLED', 'REJECTED')
              AND o.confirmed_at IS NOT NULL
            GROUP BY period
            ORDER BY period ASC
        """)
        weekly_trends = [dict(row) for row in cursor.fetchall()]

        # 4. Yearly cancellations trend
        cursor.execute("""
            SELECT strftime('%Y', COALESCE(o.cancelled_at, o.updated_at)) as period,
                   COUNT(*) as count,
                   ROUND(SUM(o.total_amount), 2) as total_amount
            FROM orders o
            WHERE o.order_status IN ('CANCELLED', 'REJECTED')
              AND o.confirmed_at IS NOT NULL
            GROUP BY period
            ORDER BY period ASC
        """)
        yearly_trends = [dict(row) for row in cursor.fetchall()]

        # 5. Cancellation Reason Distribution
        cursor.execute("""
            SELECT COALESCE(o.cancellation_reason, 'No reason specified') as reason,
                   COUNT(*) as count
            FROM orders o
            WHERE o.order_status IN ('CANCELLED', 'REJECTED')
              AND o.confirmed_at IS NOT NULL
            GROUP BY reason
            ORDER BY count DESC
        """)
        reasons_dist = [dict(row) for row in cursor.fetchall()]

        # 6. Overall stats (Cancelled vs Rejected)
        cursor.execute("""
            SELECT 
                SUM(CASE WHEN order_status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled_count,
                SUM(CASE WHEN order_status = 'REJECTED' THEN 1 ELSE 0 END) as rejected_count,
                ROUND(SUM(total_amount), 2) as lost_revenue
            FROM orders
            WHERE order_status IN ('CANCELLED', 'REJECTED')
              AND confirmed_at IS NOT NULL
        """)
        summary_stats_row = cursor.fetchone()
        summary_stats = dict(summary_stats_row) if summary_stats_row else {}

        conn.close()

        return jsonify({
            "orders": orders_list,
            "trends": {
                "monthly": monthly_trends,
                "weekly": weekly_trends,
                "yearly": yearly_trends
            },
            "reasons": reasons_dist,
            "summary": {
                "cancelled_count": summary_stats.get('cancelled_count') or 0,
                "rejected_count": summary_stats.get('rejected_count') or 0,
                "lost_revenue": summary_stats.get('lost_revenue') or 0.0
            }
        })
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/recent-orders', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
def get_admin_recent_orders():
    """Retrieves the most recent orders for the admin dashboard."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT o.id, u.name as user_name, o.total_amount, o.order_status as status, o.created_at
            FROM orders o
            JOIN users u ON o.user_id = u.id
            ORDER BY o.created_at DESC
            LIMIT 10
        """)
        orders = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(orders)
    except Exception as e:
        return error_response(str(e), 500)



@app.route('/api/admin/orders/<string:order_id>', methods=['GET'])
@token_required
@require_admin()
@require_permission("manage_orders")
def admin_get_order_details(order_id):
    """Retrieves full details of a specific order including items."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Get order details
        cursor.execute("""
            SELECT o.*, u.name as customer_name, u.email as customer_email,
                   COALESCE(ds.store_code, w.partner_id) as store_code,
                   COALESCE(ds.name, w.owner_name, w.partner_id, 'Default Store') as store_name,
                   dp.name as partner_name, dp.phone as partner_phone,
                   s.shiprocket_order_id, s.shiprocket_shipment_id, s.awb_code, 
                   s.courier_name, s.status as shipment_status, s.tracking_url
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            LEFT JOIN dark_stores ds ON COALESCE(o.store_id, o.dark_store_id) = ds.id
            LEFT JOIN warehouses w ON COALESCE(o.store_id, o.dark_store_id) = w.id
            LEFT JOIN delivery_partners dp ON o.delivery_partner_id = dp.id
            LEFT JOIN shipments s ON o.id = s.order_id
            WHERE o.id = ?
        """, (order_id,))
        order = cursor.fetchone()
        
        if not order:
            conn.close()
            return error_response("Order not found", 404)
            
        # Get order items
        cursor.execute("""
            SELECT oi.*, p.name as product_name 
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = ?
        """, (order['id'],))
        items = [dict(row) for row in cursor.fetchall()]
        
        # Calculate subtotals for items
        for item in items:
            item['subtotal'] = (item['price'] * item['quantity']) + (item.get('fitting_charge', 0) * item['quantity'])
            
        order_dict = dict(order)
        order_dict['items'] = items
        
        conn.close()
        return jsonify(order_dict)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/delivery-partners', methods=['GET'])
@token_required
@require_admin()
@require_permission("manage_delivery")
def get_delivery_partners():
    """Lists all registered delivery partners."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM delivery_partners ORDER BY created_at DESC")
        partners = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(partners)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/delivery-partner', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_delivery")
def add_delivery_partner():
    """Registers a new delivery partner."""
    data = request.json
    name = data.get('name')
    phone = data.get('phone')
    location = data.get('location', 'Unknown')
    
    if not name or not phone:
        return error_response("Name and phone are required", 400)
        
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO delivery_partners (name, phone, location) VALUES (?, ?, ?)",
            (name, phone, location)
        )
        conn.commit()
        conn.close()
        return success_response(None, "Delivery partner created successfully", 201)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/order/<int:order_id>/assign-delivery', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_delivery")
def assign_delivery_partner(order_id):
    """Assigns an available delivery partner to an order."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("SELECT delivery_partner_id FROM orders WHERE id = ?", (order_id,))
        order = cursor.fetchone()
        if not order:
            return error_response("Order not found", 404)
        if order['delivery_partner_id']:
            return error_response("Order already assigned to a partner", 400)

        cursor.execute("SELECT id, name FROM delivery_partners WHERE status = 'AVAILABLE' LIMIT 1")
        partner = cursor.fetchone()
        
        if not partner:
            return error_response("No available delivery partners", 400)
            
        partner_id = partner['id']
        cursor.execute("UPDATE orders SET delivery_partner_id = ? WHERE id = ?", (partner_id, order_id))
        cursor.execute("UPDATE delivery_partners SET status = 'BUSY', active_order_id = ? WHERE id = ?", (order_id, partner_id))
        
        conn.commit()
        conn.close()
        log_admin_action(request.user.get('user_id'), "order_modified", "order", order_id)
        log_admin_event(
            request.user.get('user_id'),
            "admin_modified_order",
            "order",
            order_id,
            f"Assigned delivery partner {partner_id} to order",
        )
        run_admin_anomaly_check(request.user.get('user_id'), "admin_modified_order")
        return success_response(None, f"Order assigned to {partner['name']}")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/orders/<int:order_id>/status', methods=['PATCH'])
@token_required
@require_admin()
@require_permission("manage_orders")
def update_order_status(order_id):
    """Updates the status of an order."""
    data = request.json
    new_status = data.get('status', '').upper()
    try:
        conn = get_db()
        cursor = conn.cursor()

        # Get current status
        cursor.execute("SELECT order_status FROM orders WHERE id = ?", (order_id,))
        current_status_row = cursor.fetchone()
        old_status = current_status_row['order_status'] if current_status_row else None

        handle_stock_on_status_change(cursor, order_id, old_status, new_status)

        timestamp_col = None
        if new_status == 'CONFIRMED': timestamp_col = "confirmed_at"
        elif new_status == 'PACKED': timestamp_col = "packed_at"
        elif new_status == 'SHIPPED': timestamp_col = "shipped_at"
        elif new_status == 'DELIVERED': timestamp_col = "delivered_at"
        elif new_status == 'CANCELLED': timestamp_col = "cancelled_at"
        
        reason = data.get('reason')
        if not reason and new_status == 'CANCELLED':
            reason = 'Cancelled by Admin'
        elif not reason and new_status == 'REJECTED':
            reason = 'Rejected by Admin'

        if timestamp_col:
            if new_status == 'CANCELLED':
                cursor.execute(f"UPDATE orders SET order_status = ?, {timestamp_col} = CURRENT_TIMESTAMP, cancellation_reason = ? WHERE id = ?", (new_status, reason, order_id))
            else:
                cursor.execute(f"UPDATE orders SET order_status = ?, {timestamp_col} = CURRENT_TIMESTAMP WHERE id = ?", (new_status, order_id))
        else:
            if new_status == 'REJECTED':
                cursor.execute("UPDATE orders SET order_status = ?, cancellation_reason = ?, cancelled_at = CURRENT_TIMESTAMP WHERE id = ?", (new_status, reason, order_id))
            else:
                cursor.execute("UPDATE orders SET order_status = ? WHERE id = ?", (new_status, order_id))
            
        # Notify user about status update
        cursor.execute("SELECT user_id, total_amount FROM orders WHERE id = ?", (order_id,))
        user_row = cursor.fetchone()
        if user_row:
            user_id = user_row['user_id']
            order_amount = user_row['total_amount']
            notification_service.send_order_notification(user_id, order_id, new_status)
            # Check for app review eligibility
            check_and_trigger_review(cursor, user_id)

            if new_status == 'DELIVERED':
                # Referral reward check (additive)
                try:
                    from utils.referral import process_referral_reward
                    process_referral_reward(order_id, user_id, order_amount)
                except Exception:
                    pass  # never break order flow

        conn.commit()
        conn.close()
        log_admin_action(request.user.get('user_id'), "order_modified", "order", order_id)
        log_admin_event(
            request.user.get('user_id'),
            "admin_cancelled_order" if new_status == "CANCELLED" else "admin_modified_order",
            "order",
            order_id,
            f"Updated order status to {new_status}",
        )
        run_admin_anomaly_check(
            request.user.get('user_id'),
            "admin_cancelled_order" if new_status == "CANCELLED" else "admin_modified_order",
        )
        return success_response(None, "Order status updated")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/categories', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_products")
def admin_add_category():
    """Creates a new product category."""
    data = request.json
    name = data.get('name')
    icon = data.get('icon', '')
    important_note = data.get('important_note', '')
    device_customization_enabled = 1 if data.get('device_customization_enabled') else 0

    if not name:
        return error_response("Category name is required", 400)

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO categories (name, icon, important_note, return_policy, device_customization_enabled) VALUES (?, ?, ?, ?, ?)",
            (name, icon, important_note, data.get('return_policy', '7 Days Return Policy'), device_customization_enabled)
        )
        category_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return success_response({"id": category_id}, "Category added", 201)
    except sqlite3.IntegrityError:
        return error_response("Category with this name already exists", 400)
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/admin/categories/<int:category_id>', methods=['PATCH'])
@token_required
@require_admin()
@require_permission("manage_products")
def admin_update_category(category_id):
    """Updates an existing category."""
    data = request.json
    try:
        conn = get_db()
        cursor = conn.cursor()
        updates = []
        params = []
        if 'name' in data:
            updates.append("name = ?")
            params.append(data['name'])
        if 'icon' in data:
            updates.append("icon = ?")
            params.append(data['icon'])
        if 'important_note' in data:
            updates.append("important_note = ?")
            params.append(data['important_note'])
        if 'return_policy' in data:
            updates.append("return_policy = ?")
            params.append(data['return_policy'])
        if 'device_customization_enabled' in data:
            updates.append("device_customization_enabled = ?")
            params.append(1 if data.get('device_customization_enabled') else 0)
        
        if not updates:
            return error_response("No fields to update", 400)
            
        params.append(category_id)
        cursor.execute(f"UPDATE categories SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
        conn.close()
        return success_response(None, "Category updated")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/device-models', methods=['GET'])
@token_required
@require_admin()
@require_permission("manage_products")
def admin_get_device_models():
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM device_models ORDER BY brand ASC, name ASC")
        models = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return success_response(models, "Device models retrieved")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/device-models', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_products")
def admin_add_device_model():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return error_response("Device model name is required", 400)

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO device_models (name, brand, type, status)
            VALUES (?, ?, ?, ?)
        """, (
            name,
            (data.get('brand') or '').strip(),
            (data.get('type') or '').strip(),
            data.get('status') or 'active'
        ))
        model_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return success_response({"id": model_id}, "Device model added", 201)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/device-models/<int:model_id>', methods=['PATCH'])
@token_required
@require_admin()
@require_permission("manage_products")
def admin_update_device_model(model_id):
    data = request.get_json(silent=True) or {}
    allowed_fields = ['name', 'brand', 'type', 'status']
    updates = []
    params = []
    for field in allowed_fields:
        if field in data:
            updates.append(f"{field} = ?")
            params.append((data.get(field) or '').strip())

    if not updates:
        return error_response("No fields to update", 400)

    updates.append("updated_at = CURRENT_TIMESTAMP")
    params.append(model_id)

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(f"UPDATE device_models SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
        conn.close()
        return success_response(None, "Device model updated")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/device-models/<int:model_id>', methods=['DELETE'])
@token_required
@require_admin()
@require_permission("manage_products")
def admin_delete_device_model(model_id):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM device_models WHERE id = ?", (model_id,))
        conn.commit()
        conn.close()
        return success_response(None, "Device model deleted")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/darkstores', methods=['GET'])
def get_public_darkstores():
    """Lists all active dark stores for public use."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, latitude, longitude, address FROM dark_stores WHERE active = 1")
        stores = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(stores)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/darkstores', methods=['GET'])
@app.route('/api/admin/stores', methods=['GET'])
@token_required
@require_admin()
@require_permission("manage_inventory")
def get_admin_darkstores():
    """Lists all dark stores with full management details."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM dark_stores ORDER BY created_at DESC")
        stores = []
        for row in cursor.fetchall():
            s = dict(row)
            s['status'] = 'active' if s['active'] else 'disabled'
            stores.append(s)
        conn.close()
        return jsonify(stores)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/stores/<int:store_id>', methods=['DELETE'])
@token_required
@require_admin()
@require_permission("manage_inventory")
def delete_admin_store(store_id):
    """Permanently removes a dark store from the system."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM dark_stores WHERE id = ?", (store_id,))
        conn.commit()
        conn.close()
        return success_response(None, "Store deleted successfully")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/darkstore', methods=['POST'])
@app.route('/api/admin/stores', methods=['POST'])
@app.route('/api/admin/stores/<int:store_id>', methods=['PUT', 'POST'])
@token_required
@require_admin()
@require_permission("manage_inventory")
def admin_upsert_darkstore(store_id=None):
    """Creates or updates a dark store's configuration."""
    data = request.json
    if not store_id:
        store_id = data.get('id')
    name = data.get('name')
    lat = data.get('latitude')
    lng = data.get('longitude')
    address = data.get('address')
    pincode = data.get('pincode')
    manager_name = data.get('manager_name')
    phone = data.get('phone')
    status = data.get('status', 'active')
    active = 1 if status == 'active' else 0
    if data.get('active') is not None:
        active = 1 if data.get('active') else 0
        
    if not name or lat is None or lng is None or not address:
        return error_response("Missing required fields", 400)
        
    try:
        conn = get_db()
        cursor = conn.cursor()
        if store_id:
            cursor.execute(
                "UPDATE dark_stores SET name=?, latitude=?, longitude=?, address=?, active=?, manager_name=?, phone=?, pincode=? WHERE id=?",
                (name, lat, lng, address, active, manager_name, phone, pincode, store_id)
            )
            message = "Dark store updated"
        else:
            cursor.execute(
                "INSERT INTO dark_stores (name, latitude, longitude, address, active, manager_name, phone, pincode) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (name, lat, lng, address, active, manager_name, phone, pincode)
            )
            store_id = cursor.lastrowid
            message = "Dark store created"
        conn.commit()
        conn.close()
        return success_response({"id": store_id}, message)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/suppliers', methods=['GET'])
@token_required
@require_admin()
@require_permission("manage_inventory")
def admin_list_suppliers():
    """Lists all suppliers (AdminRestocking page)."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM suppliers ORDER BY name")
        suppliers = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(suppliers), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/restock-alerts', methods=['GET'])
@token_required
@require_admin()
@require_permission("manage_inventory")
def get_restock_alerts():
    """Identifies products below their restock threshold and lists pending requests."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM products WHERE stock < restock_threshold')
        alerts = [dict(row) for row in cursor.fetchall()]
        
        cursor.execute('''
            SELECT rr.*, p.name as product_name 
            FROM restock_requests rr
            JOIN products p ON rr.product_id = p.id
            ORDER BY rr.created_at DESC
        ''')
        requests = [dict(row) for row in cursor.fetchall()]
        
        conn.close()
        return jsonify({"alerts": alerts, "requests": requests}), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/restock-request', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_inventory")
def create_restock_request():
    """Creates a new restock request for a product."""
    data = request.json
    product_id = data.get('product_id')
    requested_quantity = data.get('requested_quantity', 50)
    
    if not product_id:
        return error_response("Product ID is required", 400)

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT supplier_id FROM products WHERE id = ?", (product_id,))
        product = cursor.fetchone()
        
        if not product:
            conn.close()
            return error_response("Product not found", 404)
            
        supplier_id = product['supplier_id']
        cursor.execute('''
            INSERT INTO restock_requests (product_id, supplier_id, requested_quantity)
            VALUES (?, ?, ?)
        ''', (product_id, supplier_id, requested_quantity))
        
        request_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return success_response({"id": request_id}, "Restock request created", 201)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/store-inventory/<int:store_id>', methods=['GET'])
@token_required
@require_admin()
@require_permission("manage_inventory")
def get_store_inventory(store_id):
    """Retrieves the inventory levels for all products at a specific store."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                p.id, 
                p.name, 
                p.price, 
                COALESCE(si.stock_quantity, wi.stock_quantity, 0) as stock_quantity 
            FROM products p
            LEFT JOIN store_inventory si ON p.id = si.product_id AND si.store_id = ?
            LEFT JOIN dark_stores ds ON ds.id = ?
            LEFT JOIN warehouses w ON w.warehouse_name = ds.name
            LEFT JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = w.id
        """, (store_id, store_id))
        inventory = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(inventory)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/store-inventory/<int:store_id>', methods=['PATCH'])
@token_required
@require_admin()
@require_permission("manage_inventory")
def update_store_inventory(store_id):
    """Updates the stock level of a specific product at a specific store."""
    data = request.json
    product_id = data.get('product_id')
    stock = data.get('stock')
    
    if product_id is None or stock is None:
        return error_response("Missing product_id or stock", 400)
        
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM store_inventory WHERE store_id = ? AND product_id = ?", (store_id, product_id))
        row = cursor.fetchone()
        
        if row:
            cursor.execute("UPDATE store_inventory SET stock_quantity = ? WHERE id = ?", (stock, row['id']))
        else:
            cursor.execute("INSERT INTO store_inventory (store_id, product_id, stock_quantity) VALUES (?, ?, ?)", (store_id, product_id, stock))
            
        conn.commit()
        conn.close()
        log_admin_action(request.user.get('user_id'), "inventory_changed", "store_inventory", product_id)
        log_admin_event(
            request.user.get('user_id'),
            "admin_changed_inventory",
            "store_inventory",
            product_id,
            f"Updated store {store_id} inventory for product {product_id}",
        )
        run_admin_anomaly_check(request.user.get('user_id'), "admin_changed_inventory")
        return success_response(None, "Store inventory updated")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/categories/<int:category_id>', methods=['DELETE'])
@token_required
@require_admin()
@require_permission("manage_products")
def admin_delete_category(category_id):
    """Deletes a product category and nullifies associations in products."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as cnt FROM products WHERE category_id=?", (category_id,))
        count = cursor.fetchone()['cnt']
        
        if count > 0:
            cursor.execute("UPDATE products SET category_id = NULL, category = NULL WHERE category_id=?", (category_id,))
            
        cursor.execute("DELETE FROM categories WHERE id=?", (category_id,))
        conn.commit()
        conn.close()
        return success_response(None, "Category deleted")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/products', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_products")
def admin_add_product():
    """Adds a new product to the global catalog.
    
    Supports variant linking: when has_variants is true and variants_data is provided,
    each variant becomes a separate product linked via variant_group_id.
    Parent product gets variant_group_id = its own id, variants get variant_group_id = parent_id.
    """
    data = request.json
    name = data.get('name')
    price = data.get('price')
    stock = data.get('stock', 0)
    category = data.get('category')
    delivery_time = data.get('delivery_time', '30-120 mins')
    images = data.get('images')
    offline_price = _normalize_offline_price(data.get('offline_price'))
    
    # Extract additional fields for description generation
    material_type = data.get('material_type')
    color = data.get('color')
    brand = data.get('brand')
    units_per_pack = data.get('units_per_pack')
    weight = data.get('weight')
    dimensions = data.get('dimensions')
    is_fragile = data.get('is_fragile', 0)
    is_temp_sensitive = data.get('is_temp_sensitive', 0)
    is_featured = data.get('is_featured', 0)
    prepaid_only = data.get('prepaid_only', 0)
    return_policy = data.get('return_policy')
    usage_instructions = data.get('usage_instructions')
    description = data.get('description')  # User-provided description (from admin)
    
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
        'is_featured': is_featured,
        'prepaid_only': prepaid_only,
        'return_policy': return_policy,
        'usage_instructions': usage_instructions,
        'name': name,
        'category': category,
    }
    generated_description = generate_product_description(product_data_for_desc)

    if not name or price is None:
        return error_response("Missing required fields", 400)

    if not isinstance(stock, (int, float)) or stock < 0:
        return error_response("Stock must be a non-negative number", 400)

    has_variants = bool(data.get('has_variants'))
    variants_data = data.get('variants') or []
    variant_options_data = data.get('variant_options') or []

    try:
        conn = get_db()
        cursor = conn.cursor()
        # Mandatory Secure URL Generation
        share_token = generate_share_token()
        seo_slug = generate_seo_slug(name)
        
        # Insert parent product with generated description
        cursor.execute(
            """INSERT INTO products 
               (name, price, offline_price, stock, category, delivery_time, images, barcode, global_sku_code, 
                return_policy, prepaid_only, share_token, seo_slug, has_variants, is_parent, variant_group_id, variant_name,
                material_type, color, brand, units_per_pack, weight, dimensions, is_fragile, is_temp_sensitive, description)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (name, price, offline_price, int(stock), category, delivery_time, images, 
             data.get('barcode'), data.get('global_sku_code'), return_policy, 
             prepaid_only, share_token, seo_slug, 
             1 if has_variants else 0, 1 if has_variants else 0, None, None,
             material_type, color, brand, units_per_pack, weight, dimensions, is_fragile, is_temp_sensitive, generated_description)
        )
        product_id = cursor.lastrowid
        
        # Set variant_group_id to its own id for parent
        cursor.execute("UPDATE products SET variant_group_id = ? WHERE id = ?", (product_id, product_id))

        # Create variant option groups (e.g. Size -> [S, M, L], Color -> [Red, Blue])
        if has_variants and variant_options_data:
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
                cursor.execute(
                    "INSERT INTO product_variant_options (product_id, option_name, option_values, sort_order) VALUES (?, ?, ?, ?)",
                    (product_id, opt_name, json.dumps([str(v).strip() for v in opt_values if str(v).strip()]), idx)
                )

        # Create variant products (each variant is a separate product linked via variant_group_id)
        created_variants = []
        if has_variants and variants_data:
            for v in variants_data:
                v_name = (v.get('name') or '').strip() or f"{name} - Variant"
                v_sku = (v.get('sku') or '').strip() or None
                v_barcode = (v.get('barcode') or '').strip() or None
                v_price = v.get('price') if v.get('price') is not None else price
                v_mrp = v.get('mrp')
                v_stock = int(v.get('stock') or v.get('stock_quantity') or 0)
                v_images = v.get('images') or images
                if isinstance(v_images, list):
                    v_images = json.dumps(v_images)
                v_offline_price = _normalize_offline_price(v.get('offline_price'))
                
                # Generate unique share_token and seo_slug for variant
                v_share_token = generate_share_token()
                v_seo_slug = generate_seo_slug(f"{name}-{v_name}")
                
                # Insert variant as separate product
                cursor.execute(
                    """INSERT INTO products 
                       (name, price, offline_price, stock, category, delivery_time, images, barcode, global_sku_code, 
                        return_policy, prepaid_only, share_token, seo_slug, has_variants, is_parent, variant_group_id, variant_name)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)""",
                    (f"{name} - {v_name}", v_price, v_offline_price, v_stock, category, delivery_time, v_images,
                     v_barcode, v_sku, return_policy, prepaid_only,
                     v_share_token, v_seo_slug, product_id, v_name)
                )
                variant_product_id = cursor.lastrowid
                created_variants.append({
                    "id": variant_product_id,
                    "name": v_name,
                    "price": v_price,
                    "stock": v_stock,
                    "images": v_images,
                    "share_token": v_share_token,
                    "seo_slug": v_seo_slug
                })

        conn.commit()
        conn.close()
        log_admin_action(request.user.get('user_id'), "product_updated", "product", product_id)
        log_admin_event(
            request.user.get('user_id'),
            "admin_updated_product",
            "product",
            product_id,
            f"Created product {name}" + (f" with {len(created_variants)} variants" if created_variants else ""),
        )
        run_admin_anomaly_check(request.user.get('user_id'), "admin_updated_product")
        
        # Build success payload with standardized URL
        product_obj = {"id": product_id, "name": name, "share_token": share_token, "seo_slug": seo_slug}
        success_payload = {
            **product_obj,
            "share_url": generate_product_url(product_obj),
            "variants": created_variants
        }
        
        return success_response(success_payload, "Product added", 201)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/products/<int:product_id>', methods=['PUT'])
@token_required
@require_admin()
@require_permission("manage_products")
def admin_update_product(product_id):
    """Updates the details of an existing product."""
    data = request.json
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Fetch current product to ensure stability and repair missing data
        cursor.execute("SELECT name, share_token, seo_slug, has_variants, global_sku_code FROM products WHERE id = ?", (product_id,))
        current = cursor.fetchone()
        if not current:
            conn.close()
            return error_response("Product not found", 404)

        # SKU LOCK: Once a global_sku_code has been assigned, it cannot be changed.
        # This prevents barcode/label mismatches and internal fraud.
        if 'global_sku_code' in data and current.get('global_sku_code') and data['global_sku_code'] != current['global_sku_code']:
            return error_response("SKU code is locked after creation and cannot be changed. Contact super admin to modify.", 403)
            
        updates = []
        params = []
        
        for key in ['name', 'price', 'offline_price', 'stock', 'category', 'delivery_time', 'status', 'images', 'barcode', 'global_sku_code', 'return_policy', 'is_featured', 'prepaid_only', 'lifecycle_state', 'has_variants']:
            if key in data:
                val = data[key]
                if key == 'offline_price':
                    val = _normalize_offline_price(val)
                if key == 'has_variants':
                    val = 1 if val else 0
                updates.append(f"{key}=?")
                params.append(val)
                # Auto-generate fresh slug if name changes
                if key == 'name' and data['name'] != current['name']:
                    updates.append("seo_slug=?")
                    params.append(generate_seo_slug(data['name']))
        
        # Auto-repair share_token if somehow missing
        if not current['share_token']:
            updates.append("share_token=?")
            params.append(generate_share_token())
            
        # Auto-repair seo_slug if somehow missing (and not already being updated by name change)
        if not current['seo_slug'] and 'name' not in data:
            updates.append("seo_slug=?")
            params.append(generate_seo_slug(current['name']))
        
        if not updates:
            conn.close()
            return success_response(None, "No updates provided", 400)
            
        params.append(product_id)
        cursor.execute(f"UPDATE products SET {', '.join(updates)} WHERE id=?", tuple(params))

        # --- Variant & option-group sync (admin panel product editor) ---
        # Full-replace semantics: the client always sends the complete variant
        # set. Rows that still exist keep their id (stable for cart/orders),
        # removed rows are deleted, and new rows are inserted.
        # NEW: Variants are now separate products linked via variant_group_id
        if 'variants' in data or 'has_variants' in data:
            has_variants = bool(data.get('has_variants')) if 'has_variants' in data else bool(current.get('has_variants'))
            if not has_variants:
                # Variants disabled: remove all linked variant products + option groups.
                cursor.execute("DELETE FROM products WHERE variant_group_id = ? AND id != ?", (product_id, product_id))
                cursor.execute("DELETE FROM product_variant_options WHERE product_id = ?", (product_id,))
                cursor.execute("UPDATE products SET has_variants = 0, is_parent = 0, variant_group_id = NULL WHERE id = ?", (product_id,))
            else:
                # Ensure parent has variant_group_id set to itself
                cursor.execute("UPDATE products SET variant_group_id = ?, has_variants = 1, is_parent = 1 WHERE id = ?", (product_id, product_id))
                
                # Sync option groups: delete + re-insert (ids are not referenced elsewhere).
                cursor.execute("DELETE FROM product_variant_options WHERE product_id = ?", (product_id,))
                variant_options_data = data.get('variant_options') or []
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
                    cursor.execute(
                        "INSERT INTO product_variant_options (product_id, option_name, option_values, sort_order) VALUES (?, ?, ?, ?)",
                        (product_id, opt_name, json.dumps([str(v).strip() for v in opt_values if str(v).strip()]), idx)
                    )

                # Sync variant products when a full set is provided.
                if 'variants' in data:
                    variants_data = data.get('variants') or []
                    existing_variant_ids = set()
                    
                    # Fetch current variant products for this group
                    cursor.execute("SELECT id, variant_name FROM products WHERE variant_group_id = ? AND id != ?", (product_id, product_id))
                    current_variants = {row['variant_name']: row['id'] for row in cursor.fetchall()}
                    
                    for v in variants_data:
                        v_id = v.get('id')
                        v_name = (v.get('name') or '').strip() or f"{current['name']} - Variant"
                        v_sku = (v.get('sku') or '').strip() or None
                        v_barcode = (v.get('barcode') or '').strip() or None
                        v_price = v.get('price')
                        v_mrp = v.get('mrp')
                        v_stock = int(v.get('stock') or v.get('stock_quantity') or 0)
                        v_images = v.get('images')
                        if isinstance(v_images, list):
                            v_images = json.dumps(v_images)
                        v_offline_price = _normalize_offline_price(v.get('offline_price'))
                        
                        # Check if this variant already exists (by variant_name or id)
                        variant_product_id = None
                        if v_id and str(v_id).isdigit():
                            # Check if it's an existing variant product ID
                            cursor.execute("SELECT id FROM products WHERE id = ? AND variant_group_id = ?", (int(v_id), product_id))
                            existing = cursor.fetchone()
                            if existing:
                                variant_product_id = existing['id']
                                existing_variant_ids.add(variant_product_id)
                        
                        # If not found by ID, try by variant_name
                        if not variant_product_id and v_name in current_variants:
                            variant_product_id = current_variants[v_name]
                            existing_variant_ids.add(variant_product_id)
                        
                        if variant_product_id:
                            # Update existing variant product
                            set_parts = ["name = ?", "price = ?", "offline_price = ?", "stock = ?", "barcode = ?", "global_sku_code = ?", "images = ?", "mrp = ?"]
                            set_params = [f"{current['name']} - {v_name}", v_price, v_offline_price, v_stock, v_barcode, v_sku, v_images, v_mrp]
                            set_params.append(variant_product_id)
                            cursor.execute(
                                f"UPDATE products SET {', '.join(set_parts)} WHERE id = ?",
                                set_params
                            )
                        else:
                            # Create new variant product
                            v_share_token = generate_share_token()
                            v_seo_slug = generate_seo_slug(f"{current['name']}-{v_name}")
                            cursor.execute(
                                """INSERT INTO products 
                                   (name, price, offline_price, stock, category, delivery_time, images, barcode, global_sku_code, 
                                    return_policy, prepaid_only, share_token, seo_slug, has_variants, is_parent, variant_group_id, variant_name)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)""",
                                (f"{current['name']} - {v_name}", v_price, v_offline_price, v_stock, current['category'], 
                                 data.get('delivery_time', '30-120 mins'), v_images,
                                 v_barcode, v_sku, data.get('return_policy'), data.get('prepaid_only', 0),
                                 v_share_token, v_seo_slug, product_id, v_name)
                            )
                            new_variant_id = cursor.lastrowid
                            existing_variant_ids.add(new_variant_id)
                    
                    # Delete variant products the client no longer sent
                    for v_name, v_pid in current_variants.items():
                        if v_pid not in existing_variant_ids:
                            cursor.execute("DELETE FROM products WHERE id = ?", (v_pid,))

        # Trigger Low Stock Notifications if stock was updated and is <= 2
        if 'stock' in data:
            cursor.execute("SELECT name, stock FROM products WHERE id = ?", (product_id,))
            prod_data = cursor.fetchone()
            if prod_data and prod_data['stock'] <= 2 and prod_data['stock'] > 0:
                trigger_low_stock_notifications(product_id, prod_data['stock'], prod_data['name'])

        conn.commit()
        conn.close()
        # Clear cache to reflect updates immediately
        try:
            cache.clear()
        except:
            pass
        log_admin_action(request.user.get('user_id'), "product_updated", "product", product_id)
        log_admin_event(
            request.user.get('user_id'),
            "admin_updated_product",
            "product",
            product_id,
            "Updated product details",
        )
        run_admin_anomaly_check(request.user.get('user_id'), "admin_updated_product")
        
        # Fetch updated record to return latest slugs/tokens
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, share_token, seo_slug FROM products WHERE id = ?", (product_id,))
        updated_product = dict(cursor.fetchone())
        # Also fetch variant products
        cursor.execute("SELECT id, name, variant_name, share_token, seo_slug, price, stock FROM products WHERE variant_group_id = ? AND id != ?", (product_id, product_id))
        variants = [dict(r) for r in cursor.fetchall()]
        conn.close()
        
        return success_response({
            "seo_slug": updated_product['seo_slug'],
            "share_token": updated_product['share_token'],
            "share_url": generate_product_url(updated_product),
            "variants": variants
        }, "Product updated")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/pincode/check/<string:pincode>', methods=['GET'])
def check_pincode_serviceability(pincode):
    if not pincode or len(pincode) != 6 or not pincode.isdigit():
        return error_response("Invalid pincode format", 400)
        
    try:
        # 1. Verify general pincode validity via Postal API (SSL verify=False for development environment stability)
        is_valid_pincode = True
        city_detected = None
        state_detected = None
        
        try:
            import requests
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
            res_postal = requests.get(f"https://api.postalpincode.in/pincode/{pincode}", headers=headers, verify=False, timeout=5)
            if res_postal.status_code == 200:
                postal_data = res_postal.json()
                if postal_data and postal_data[0]:
                    status = postal_data[0].get('Status')
                    if status == 'Error' or "no records found" in str(postal_data[0].get('Message', '')).lower():
                        is_valid_pincode = False
                    elif postal_data[0].get('PostOffice'):
                        office = postal_data[0]['PostOffice'][0]
                        city_detected = office.get('District')
                        state_detected = office.get('State')
        except Exception as ex:
            print(f"Backend postal api lookup failed: {ex}")
            # Network fallback: assume valid if network is completely offline to avoid blocking
            is_valid_pincode = True
            
        if not is_valid_pincode:
            return success_response({
                "pincode": pincode,
                "serviceable": False,
                "invalid": True,
                "cod_allowed": False,
                "prepaid_only": False,
                "message": "Invalid Pincode! No postal records found."
            })
            
        conn = get_db()
        cursor = conn.cursor()
        
        # Check local rules first
        cursor.execute("SELECT cod_allowed, prepaid_only FROM pincode_rules WHERE pincode = ?", (pincode,))
        rule = cursor.fetchone()
        
        cod_allowed = True
        prepaid_only = False
        
        if rule:
            cod_allowed = bool(rule['cod_allowed'])
            prepaid_only = bool(rule['prepaid_only'])
            
        # Get active dark store's pincode as pickup postcode
        cursor.execute("SELECT pincode FROM dark_stores WHERE active = 1 LIMIT 1")
        store = cursor.fetchone()
        pickup_pincode = store['pincode'] if store and store['pincode'] else '110001'
        
        conn.close()
        
        # Check with Shiprocket Serviceability API
        shiprocket_verified = False
        shiprocket_cod_allowed = True
        shiprocket_serviceable = True
        
        try:
            from shiprocket_client import sr_headers, SHIPROCKET_API
            headers = sr_headers()
            if headers:
                res = requests.get(
                    f"{SHIPROCKET_API}/courier/serviceability/",
                    params={
                        "pickup_postcode": pickup_pincode,
                        "delivery_postcode": pincode,
                        "weight": "0.5",
                        "cod": "1"
                    },
                    headers=headers,
                    timeout=5
                )
                if res.status_code == 200:
                    sr_data = res.json()
                    status_code = sr_data.get('status')
                    
                    if status_code == 200:
                        shiprocket_verified = True
                        data_payload = sr_data.get('data', {})
                        available_couriers = data_payload.get('available_courier_companies', [])
                        
                        if not available_couriers:
                            shiprocket_serviceable = False
                        else:
                            has_cod = any(int(c.get('cod', 0)) == 1 for c in available_couriers)
                            shiprocket_cod_allowed = has_cod
                    elif status_code == 404 or "not serviceable" in str(sr_data.get('message', '')).lower():
                        shiprocket_verified = True
                        shiprocket_serviceable = False
        except Exception as e:
            print(f"Error checking Shiprocket serviceability: {e}")
            
        final_serviceable = shiprocket_serviceable if shiprocket_verified else True
        final_cod = cod_allowed and shiprocket_cod_allowed
        
        return success_response({
            "pincode": pincode,
            "serviceable": final_serviceable,
            "invalid": False,
            "cod_allowed": final_cod,
            "prepaid_only": prepaid_only or not final_cod,
            "city": city_detected,
            "state": state_detected,
            "message": "Serviceable via Standard Express Delivery" if final_serviceable else "Delivery not available to this pincode"
        })
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/pincode-rules', methods=['GET'])
@token_required
@require_admin()
@require_permission("manage_settings")
def get_pincode_rules():
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM pincode_rules ORDER BY created_at DESC")
        rules = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(rules)
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/admin/repair-product-data', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_products")
def admin_repair_products():
    """Trigger internal repair of product slugs and tokens."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        count = repair_product_data(cursor)
        conn.commit()
        conn.close()
        return success_response({"repaired_count": count}, f"Repaired {count} products successfully")
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/admin/pincode-rules', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_settings")
def add_pincode_rule():
    data = request.json
    pincode = data.get('pincode')
    cod_allowed = data.get('cod_allowed', 1)
    prepaid_only = data.get('prepaid_only', 0)
    
    if not pincode:
        return error_response("Pincode is required", 400)
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT OR REPLACE INTO pincode_rules (pincode, cod_allowed, prepaid_only)
            VALUES (?, ?, ?)
        ''', (pincode, cod_allowed, prepaid_only))
        conn.commit()
        conn.close()
        return success_response(None, "Pincode rule saved")
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/admin/pincode-rules/<string:pincode>', methods=['DELETE'])
@token_required
@require_admin()
@require_permission("manage_settings")
def delete_pincode_rule(pincode):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM pincode_rules WHERE pincode = ?", (pincode,))
        conn.commit()
        conn.close()
        return success_response(None, "Pincode rule deleted")
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/admin/inventory', methods=['GET'])
@token_required
@require_admin()
@require_permission("manage_inventory")
def admin_get_inventory():
    """Retrieves a summary of the global product inventory."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        # Admin inventory reflects global catalog stock. For variant products the
        # effective stock is the sum of their active variants (same as storefront).
        cursor.execute(
            """
            SELECT 
                p.id, 
                p.name as product_name, 
                p.price, 
                p.category,
                CAST(p.id AS TEXT) as sku,
                CASE WHEN p.has_variants = 1 THEN (SELECT COALESCE(SUM(stock), 0) FROM product_variants pv3 WHERE pv3.product_id = p.id AND pv3.status = 'active') ELSE p.stock END as stock, 
                COALESCE((SELECT SUM(quantity) FROM cart WHERE product_id = p.id), 0) as reserved_stock,
                COALESCE((SELECT SUM(quantity) FROM cart WHERE product_id = p.id AND user_id IS NOT NULL), 0) as user_reserved,
                COALESCE((SELECT SUM(quantity) FROM cart WHERE product_id = p.id AND session_id IS NOT NULL AND user_id IS NULL), 0) as guest_reserved,
                p.low_stock_threshold,
                p.status,
                p.has_variants,
                'Global Catalog' as store_name,
                'GLOBAL' as store_code,
                ROUND(COALESCE((SELECT AVG(rating) FROM product_reviews WHERE product_id = p.id), 0), 1) as average_rating,
                p.return_policy,
                c.return_policy as category_return_policy
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            ORDER BY p.name ASC
        """)
        inventory = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(inventory)
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/admin/inventory/stats', methods=['GET'])
@token_required
@require_admin()
@require_permission("manage_inventory")
def admin_get_inventory_stats():
    """Returns inventory statistics."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("SELECT COUNT(*) as total FROM products")
        total = cursor.fetchone()['total']

        # Effective stock = summed active variant stock for variant products,
        # otherwise the plain products.stock column. Keeps admin stats consistent
        # with what the storefront and warehouse panels actually see.
        cursor.execute("""
            SELECT COUNT(*) as low_stock FROM products
            WHERE CASE WHEN has_variants = 1
                  THEN (SELECT COALESCE(SUM(stock), 0) FROM product_variants pv3 WHERE pv3.product_id = products.id AND pv3.status = 'active')
                  ELSE stock END <= low_stock_threshold
              AND CASE WHEN has_variants = 1
                  THEN (SELECT COALESCE(SUM(stock), 0) FROM product_variants pv3 WHERE pv3.product_id = products.id AND pv3.status = 'active')
                  ELSE stock END > 0
        """)
        low_stock = cursor.fetchone()['low_stock']

        cursor.execute("""
            SELECT COUNT(*) as out_of_stock FROM products
            WHERE CASE WHEN has_variants = 1
                  THEN (SELECT COALESCE(SUM(stock), 0) FROM product_variants pv3 WHERE pv3.product_id = products.id AND pv3.status = 'active')
                  ELSE stock END <= 0
        """)
        out_of_stock = cursor.fetchone()['out_of_stock']
        
        conn.close()
        return jsonify({
            "total_products": total,
            "low_stock": low_stock,
            "out_of_stock": out_of_stock,
            "restock_suggestions": low_stock + out_of_stock
        })
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/inventory/<int:product_id>', methods=['PATCH'])
@token_required
@require_admin()
@require_permission("manage_inventory")
def admin_update_inventory(product_id):
    """Adjusts stock levels or thresholds for a product globally."""
    data = request.json
    try:
        conn = get_db()
        cursor = conn.cursor()
        updates = []
        params = []
        
        if 'stock' in data or 'stock_quantity' in data:
            stock_value = data.get('stock') if 'stock' in data else data.get('stock_quantity')
            if stock_value is None or not isinstance(stock_value, (int, float)) or stock_value < 0:
                return error_response("Stock must be a non-negative number", 400)
            updates.append("stock=?")
            params.append(int(stock_value))
            
        if 'low_stock_threshold' in data:
            threshold = data.get('low_stock_threshold')
            if threshold is None or not isinstance(threshold, (int, float)) or threshold < 0:
                return error_response("low_stock_threshold must be a non-negative number", 400)
            updates.append("low_stock_threshold=?")
            params.append(int(threshold))
            
        if not updates:
            return success_response(None, "No inventory updates provided", 400)
            
        updates.append("last_updated=CURRENT_TIMESTAMP")
        params.append(product_id)
        cursor.execute(f"UPDATE products SET {', '.join(updates)} WHERE id=?", tuple(params))
        
        # Trigger Low Stock Notifications if stock was updated and is <= 2
        if 'stock' in data or 'stock_quantity' in data:
            cursor.execute("SELECT name, stock FROM products WHERE id = ?", (product_id,))
            prod_data = cursor.fetchone()
            if prod_data and prod_data['stock'] <= 2 and prod_data['stock'] > 0:
                trigger_low_stock_notifications(product_id, prod_data['stock'], prod_data['name'])

        conn.commit()
        conn.close()
        log_admin_action(request.user.get('user_id'), "inventory_changed", "product", product_id)
        log_admin_event(
            request.user.get('user_id'),
            "admin_changed_inventory",
            "product",
            product_id,
            "Updated inventory levels",
        )
        run_admin_anomaly_check(request.user.get('user_id'), "admin_changed_inventory")
        return success_response(None, "Inventory updated successfully")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/low-stock', methods=['GET'])
@token_required
@require_admin()
@require_permission("manage_inventory")
def admin_get_low_stock():
    """Identifies all products currently at or below their low-stock threshold."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM products WHERE stock <= low_stock_threshold")
        low_stock_products = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(low_stock_products)
    except Exception as e:
        return error_response(str(e), 500)




@app.route('/api/admin/products/<int:product_id>', methods=['DELETE'])
@token_required
@require_admin()
@require_permission("manage_products")
def admin_delete_product(product_id):
    """Removes a product from the global catalog."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        # Cascade cleanup: variant rows, option groups and any warehouse
        # inventory lines belong to this product and would otherwise orphan
        # (breaking warehouse panels and leaving stale cart references).
        cursor.execute("DELETE FROM product_variants WHERE product_id=?", (product_id,))
        cursor.execute("DELETE FROM product_variant_options WHERE product_id=?", (product_id,))
        cursor.execute("DELETE FROM warehouse_inventory WHERE product_id=?", (product_id,))
        cursor.execute("DELETE FROM products WHERE id=?", (product_id,))
        conn.commit()
        conn.close()
        log_admin_action(request.user.get('user_id'), "product_updated", "product", product_id)
        log_admin_event(
            request.user.get('user_id'),
            "admin_updated_product",
            "product",
            product_id,
            "Deleted product",
        )
        run_admin_anomaly_check(request.user.get('user_id'), "admin_updated_product")
        return success_response(None, "Product deleted")
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/admin/notification-templates', methods=['GET'])
@token_required
@require_admin()
@require_permission("manage_settings")
def admin_get_notification_templates():
    """Retrieves all notification and email templates."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM notification_templates ORDER BY type ASC, template_key ASC")
        templates = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(templates)
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/admin/notification-templates/<template_key>', methods=['PUT'])
@token_required
@require_admin()
@require_permission("manage_settings")
def admin_update_notification_template(template_key):
    """Updates a specific notification or email template."""
    data = request.json
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        updates = []
        params = []
        for field in ['title', 'subject', 'message', 'is_active']:
            if field in data:
                updates.append(f"{field} = ?")
                params.append(data[field])
        
        if not updates:
            return error_response("No fields to update", 400)
            
        params.append(template_key)
        cursor.execute(f"""
            UPDATE notification_templates 
            SET {', '.join(updates)}, last_updated = CURRENT_TIMESTAMP 
            WHERE template_key = ?
        """, tuple(params))
        
        conn.commit()
        conn.close()
        return success_response(None, "Template updated successfully")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/upload', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_products")
def admin_upload_image():
    """Handles administrative image uploads for products or profiles."""
    if 'file' not in request.files:
        return error_response("No file part", 400)
    file = request.files['file']
    if file.filename == '':
        return error_response("No selected file", 400)
    if file and allowed_file(file.filename):
        is_valid, error = validate_image_file(file)
        if not is_valid:
            return error_response(error, 400)
        # 1. Try uploading to persistent cloud storage first
        try:
            from services.cloud_image_service import upload_file_object_to_cloud
            cloud_url = upload_file_object_to_cloud(file)
            if cloud_url:
                logger.info(f"Successfully uploaded admin image to cloud: {cloud_url}")
                return jsonify({"url": cloud_url}), 201
        except Exception as e:
            logger.error(f"Cloud upload failed inside admin_upload_image: {str(e)}")

        # 2. Fallback to Base64 Data URL to store directly in Turso if cloud upload fails/is blocked
        try:
            import base64
            from utils.image_optimizer import optimize_image_bytes
            # Performance: resize + re-encode before base64-encoding. These URLs
            # live inside the DB and are served to every visitor, so smaller is
            # doubly valuable. Falls back to original bytes on any failure.
            file_data = optimize_image_bytes(file.read(), file.filename)
            file.seek(0)
            encoded = base64.b64encode(file_data).decode('utf-8')
            mime_type = file.mimetype or "image/jpeg"
            base64_url = f"data:{mime_type};base64,{encoded}"
            logger.info("Successfully fell back to Base64 Data URL for persistent storage in Turso.")
            return jsonify({"url": base64_url}), 201
        except Exception as ex:
            logger.error(f"Base64 fallback failed: {str(ex)}")
            return error_response("Cloud upload and Base64 fallback both failed", 500)
    return error_response("File type not allowed", 400)


@app.route('/api/admin/warehouse-analytics', methods=['GET'])
@app.route('/api/admin/analytics', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
def get_warehouse_analytics():
    """Provides comprehensive warehouse and store-level analytics."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                ds.id, ds.name, 
                COUNT(o.id) as total_orders, 
                COALESCE(SUM(o.total_amount), 0) as total_revenue,
                COALESCE(SUM(CASE WHEN o.created_at >= datetime('now', '-1 day') THEN o.total_amount ELSE 0 END), 0) as daily_sales,
                COUNT(CASE WHEN UPPER(o.order_status) NOT IN ('DELIVERED', 'CANCELLED', 'RETURNED', 'REFUNDED') THEN o.id END) as active_orders,
                (SELECT COUNT(*) FROM delivery_partners dp WHERE dp.status = 'AVAILABLE' AND dp.location = ds.name) as assigned_riders
            FROM dark_stores ds
            LEFT JOIN orders o ON ds.id = o.store_id
            GROUP BY ds.id
        """)
        store_stats = [dict(row) for row in cursor.fetchall()]
        
        cursor.execute("""
            SELECT ds.name as store_name, p.name as product_name, si.stock_quantity
            FROM store_inventory si
            JOIN dark_stores ds ON si.store_id = ds.id
            JOIN products p ON si.product_id = p.id
            WHERE si.stock_quantity <= p.low_stock_threshold OR p.stock <= p.low_stock_threshold
        """)
        low_stock_alerts = [dict(row) for row in cursor.fetchall()]
        
        conn.close()
        return jsonify({
            "store_stats": store_stats,
            "low_stock_alerts": low_stock_alerts
        })
    except Exception as e:
        return error_response(str(e), 500)

# ==============================================================================
# SYSTEM: TRACKING & PAYMENTS
# ==============================================================================

@app.route('/api/order/<int:order_id>/route', methods=['GET'])
@token_required
def get_order_route(order_id):
    """Calculates and returns the optimized delivery route for a specific order."""
    user_id = request.user['user_id']
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT o.order_status as status, o.delivery_latitude as cust_lat, o.delivery_longitude as cust_lng, 
                   ds.latitude as store_lat, ds.longitude as store_lng,
                   o.delivery_partner_id
            FROM orders o
            LEFT JOIN dark_stores ds ON o.store_id = ds.id
            WHERE o.id = ? AND o.user_id = ?
        ''', (order_id, user_id))
        order = cursor.fetchone()
        
        if not order:
            conn.close()
            return error_response("Order not found", 404)
            
        if not order['delivery_partner_id']:
            conn.close()
            return error_response("No delivery partner assigned yet", 400)

        rider_loc = get_rider_location(cursor, order_id)
        conn.close()
        
        if not rider_loc:
            return error_response("Rider location not available", 404)

        rider_coords = (rider_loc['latitude'], rider_loc['longitude'])
        store_coords = (order['store_lat'], order['store_lng'])
        customer_coords = (order['cust_lat'], order['cust_lng'])
        
        optimization_result = calculate_shortest_route(
            rider_coords, store_coords, customer_coords, order['status']
        )
        return jsonify(optimization_result), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/delivery/location/update', methods=['POST'])
@token_required
def update_location():
    """Updates the real-time location of a delivery partner."""
    data = request.json
    partner_id = data.get('delivery_partner_id')
    lat = data.get('latitude')
    lng = data.get('longitude')
    
    if not partner_id or lat is None or lng is None:
        return error_response("Missing location data", 400)
        
    try:
        conn = get_db()
        cursor = conn.cursor()
        update_rider_location(cursor, partner_id, lat, lng)
        conn.commit()
        conn.close()
        return success_response(None, "Location updated", 200)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/order/<int:order_id>/rider-location', methods=['GET'])
@token_required
def get_order_rider_location(order_id):
    """Retrieves the current location of the rider assigned to an order."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        location = get_rider_location(cursor, order_id)
        conn.close()
        
        if location:
            return jsonify(location), 200
        return error_response("No rider location found", 404)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/payment/create', methods=['POST'])
@token_required
def create_payment():
    """Initiates a payment order for a specific order."""
    data = request.json
    order_id = data.get('order_id')
    
    if not order_id:
        return error_response("Order ID is required", 400)
        
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT user_id, total_amount, payment_type, cod_advance_paid FROM orders WHERE id = ?", (order_id,))
        order = cursor.fetchone()
        
        if not order:
            conn.close()
            return error_response("Order not found", 404)

        # M2 fix: ownership check - only the order owner can create a payment for it.
        if int(order['user_id']) != int(request.user['user_id']):
            conn.close()
            return error_response("Unauthorized access to this order", 403)
            
        # Determine amount to pay now
        amount_to_pay = order['total_amount']
        if order['payment_type'] == 'COD':
            amount_to_pay = order['cod_advance_paid']

        razorpay_order = payment_service.create_payment_order(amount_to_pay, order_id)
        
        cursor.execute('''
            INSERT INTO payments (order_id, user_id, payment_method, amount, transaction_id, payment_status)
            VALUES (?, ?, ?, ?, ?, 'PENDING')
        ''', (order_id, request.user['user_id'], data.get('payment_method', 'RAZORPAY'), amount_to_pay, razorpay_order['id']))
        
        conn.commit()
        conn.close()
        return jsonify(razorpay_order), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/payment/<int:order_id>', methods=['GET'])
@token_required
def get_payment_status(order_id):
    """Retrieves the payment status for a specific order."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        # M2 fix: ownership check - prevent IDOR payment info disclosure.
        order = cursor.execute("SELECT user_id FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not order:
            conn.close()
            return error_response("Order not found", 404)
        if int(order['user_id']) != int(request.user['user_id']):
            conn.close()
            return error_response("Unauthorized access", 403)

        cursor.execute("SELECT * FROM payments WHERE order_id = ?", (order_id,))
        payment = cursor.fetchone()
        conn.close()
        
        if not payment:
            return error_response("No payment record found", 404)
            
        return jsonify(dict(payment)), 200
    except Exception as e:
        return error_response(str(e), 500)


# ==============================================================================
# USER: ENGAGEMENT & FEEDBACK
# ==============================================================================

@app.route('/api/notifications', methods=['GET'])
@token_required
def get_notifications():
    """Retrieves all notifications for the authenticated user."""
    user_id = request.user['user_id']
    try:
        conn = get_db()
        cursor = conn.cursor()
        has_read_status = table_has_column(cursor, 'notifications', 'read_status')
        read_status_expr = "read_status" if has_read_status else "is_read"
        cursor.execute(f"SELECT *, {read_status_expr} AS read_status FROM notifications WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
        notifs = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return success_response(notifs, "Notifications retrieved")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/notifications/<int:notif_id>/read', methods=['PATCH'])
@token_required
def mark_read(notif_id):
    """Marks a specific notification as read."""
    user_id = request.user['user_id']
    try:
        conn = get_db()
        cursor = conn.cursor()
        read_column = 'read_status' if table_has_column(cursor, 'notifications', 'read_status') else 'is_read'
        cursor.execute(f"UPDATE notifications SET {read_column} = 1 WHERE id = ? AND user_id = ?", (notif_id, user_id))
        conn.commit()
        conn.close()
        return success_response(None, "Marked as read", 200)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/notifications/read-all', methods=['POST'])
@token_required
def read_all_notifications():
    """Marks all notifications for the user as read."""
    user_id = request.user['user_id']
    try:
        conn = get_db()
        cursor = conn.cursor()
        read_column = 'read_status' if table_has_column(cursor, 'notifications', 'read_status') else 'is_read'
        cursor.execute(f"UPDATE notifications SET {read_column} = 1 WHERE user_id = ?", (user_id,))
        conn.commit()
        conn.close()
        return success_response(None, "All marked as read", 200)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/notifications/register-token', methods=['POST'])
@token_required
def register_push_token():
    """
    Registers a push target for notifications.

    Two formats are accepted:
      * Web Push (pure VAPID, no Firebase): pass the full PushSubscription JSON
        as `subscription` = { endpoint, keys: { p256dh, auth } }. Stored in
        web_push_subscriptions and delivered via pywebpush.
      * Legacy FCM token: pass `token` (kept for backwards compatibility).
    """
    data = request.get_json(silent=True) or {}
    user_id = request.user['user_id']
    device_type = data.get('device_type', 'web')
    subscription = data.get('subscription') or {}
    endpoint = (subscription.get('endpoint') or '').strip()
    keys = subscription.get('keys') or {}

    # Web Push subscription path
    if endpoint:
        p256dh = (keys.get('p256dh') or '').strip()
        auth = (keys.get('auth') or '').strip()
        if not p256dh or not auth:
            return error_response("subscription.keys.p256dh and subscription.keys.auth are required", 400)
        try:
            conn = get_db()
            cursor = conn.cursor()
            # Owner-guarded upsert: a subscription can only be (re)claimed by
            # the user who already owns it (prevents hijacking someone's push).
            cursor.execute('''
                INSERT INTO web_push_subscriptions (user_id, endpoint, p256dh, auth)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(endpoint) DO UPDATE SET
                    user_id = excluded.user_id,
                    p256dh = excluded.p256dh,
                    auth = excluded.auth,
                    updated_at = CURRENT_TIMESTAMP
                WHERE web_push_subscriptions.user_id = excluded.user_id
            ''', (user_id, endpoint, p256dh, auth))
            conn.commit()
            conn.close()
            return success_response(None, "Push subscription registered successfully")
        except Exception as e:
            return error_response(str(e), 500)

    # Legacy FCM token path
    token = data.get('token')
    if not token:
        return error_response("subscription or token is required", 400)

    try:
        conn = get_db()
        cursor = conn.cursor()
        # Owner-guarded upsert: a token can only be (re)claimed by the user who
        # already owns it. Without the WHERE clause any authenticated user could
        # register another user's FCM token and hijack their push notifications.
        cursor.execute('''
            INSERT INTO user_push_tokens (user_id, fcm_token, device_type)
            VALUES (?, ?, ?)
            ON CONFLICT(fcm_token) DO UPDATE SET
                user_id = excluded.user_id,
                device_type = excluded.device_type,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_push_tokens.user_id = excluded.user_id
        ''', (user_id, token, device_type))
        conn.commit()
        conn.close()
        return success_response(None, "Push token registered successfully")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/review/add', methods=['POST'])
@token_required
def add_review():
    """Adds a product review (only for verified buyers)."""
    data = request.json
    user_id = request.user['user_id']
    product_id = data.get('product_id')
    raw_rating = data.get('rating')
    review_text = (data.get('review_text') or '').strip()

    if not product_id:
        return error_response("Product ID is required", 400)
    try:
        product_id = int(product_id)
    except (TypeError, ValueError):
        return error_response("Invalid product ID", 400)
    try:
        rating = float(raw_rating)
    except (TypeError, ValueError):
        return error_response("Rating must be a number between 1 and 5", 400)
    if not (1 <= rating <= 5):
        return error_response("Rating must be between 1 and 5", 400)
    rating = int(rating)
    if len(review_text) > 2000:
        return error_response("Review text is too long (max 2000 characters)", 400)

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT o.store_id FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            WHERE o.user_id = ? AND oi.product_id = ? AND o.order_status = 'DELIVERED'
            ORDER BY o.created_at DESC LIMIT 1
        ''', (user_id, product_id))
        order_row = cursor.fetchone()
        is_verified = 1 if order_row else 0
        store_id = order_row['store_id'] if order_row else None

        try:
            cursor.execute('''
                INSERT INTO product_reviews (product_id, user_id, rating, review_text, is_verified, store_id)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (product_id, user_id, rating, review_text, is_verified, store_id))
            conn.commit()
            
            # Fetch details for thank-you email
            cursor.execute("SELECT name, email FROM users WHERE id = ?", (user_id,))
            user_row = cursor.fetchone()
            cursor.execute("SELECT name FROM products WHERE id = ?", (product_id,))
            prod_row = cursor.fetchone()
            
            # Fetch template from DB
            cursor.execute("SELECT * FROM notification_templates WHERE template_key = ?", ('review_thank_you_email',))
            tpl = cursor.fetchone()
            conn.close()

            if user_row and prod_row:
                from threading import Thread
                subject = tpl['subject'] if tpl and tpl['is_active'] else None
                message = tpl['message'] if tpl and tpl['is_active'] else None
                Thread(target=send_review_thank_you_email, args=(user_row['email'], user_row['name'], prod_row['name'], rating, subject, message)).start()

            return success_response(None, "Review submitted successfully", 201)
        except sqlite3.IntegrityError:
            conn.close()
            return error_response("You have already reviewed this product.", 400)
    except Exception as e:
        return error_response(str(e), 500)


# --- Admin Review Management ---

@app.route('/api/admin/reviews', methods=['GET'])
@token_required
@require_admin()
def admin_get_all_reviews():
    """Fetches all reviews for moderation in the admin panel."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT 
                r.*, 
                u.name as user_name, 
                u.email as user_email,
                p.name as product_name,
                p.global_sku_code as product_sku,
                COALESCE(ds.name, w.warehouse_name) as store_name,
                COALESCE(ds.store_code, w.partner_id) as store_id_code
            FROM product_reviews r
            JOIN users u ON r.user_id = u.id
            JOIN products p ON r.product_id = p.id
            LEFT JOIN dark_stores ds ON r.store_id = ds.id
            LEFT JOIN warehouses w ON r.store_id = w.id
            ORDER BY r.created_at DESC
        ''')
        reviews = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return success_response(reviews, "All reviews retrieved for moderation")
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/admin/reviews/<int:review_id>', methods=['DELETE'])
@token_required
@require_admin()
def admin_delete_review(review_id):
    """Allows an admin to delete a review (e.g. for moderation)."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM product_reviews WHERE id = ?", (review_id,))
        if cursor.rowcount == 0:
            conn.close()
            return error_response("Review not found", 404)
        conn.commit()
        conn.close()
        return success_response(None, f"Review #{review_id} deleted successfully")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/review/product/<int:product_id>', methods=['GET'])
def get_product_reviews(product_id):
    """Retrieves all reviews and stats for a specific product."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # 1. Fetch individual reviews
        current_user_id = None
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(" ")[1]
            try:
                from jwt_config import get_jwt_secret
                import jwt
                payload = jwt.decode(token, get_jwt_secret(), algorithms=["HS256"])
                current_user_id = payload.get('user_id')
            except:
                pass

        cursor.execute('''
            SELECT pr.*, u.name as user_name, u.profile_image,
                   (SELECT 1 FROM review_helpful_votes WHERE review_id = pr.id AND user_id = ?) as user_has_liked
            FROM product_reviews pr
            JOIN users u ON pr.user_id = u.id
            WHERE pr.product_id = ?
            ORDER BY pr.created_at DESC
        ''', (current_user_id, product_id))
        reviews = [dict(row) for row in cursor.fetchall()]
        
        # 2. Calculate Stats
        cursor.execute('''
            SELECT 
                COUNT(*) as total_count,
                AVG(rating) as avg_rating
            FROM product_reviews 
            WHERE product_id = ?
        ''', (product_id,))
        stats_row = cursor.fetchone()
        
        # 3. Calculate Distribution
        cursor.execute('''
            SELECT rating, COUNT(*) as count 
            FROM product_reviews 
            WHERE product_id = ? 
            GROUP BY rating
        ''', (product_id,))
        dist_rows = cursor.fetchall()
        distribution = {i: 0 for i in range(1, 6)}
        for row in dist_rows:
            distribution[row['rating']] = row['count']
            
        conn.close()
        
        return jsonify({
            'reviews': reviews,
            'stats': {
                'total': stats_row['total_count'] if stats_row else 0,
                'average': round(stats_row['avg_rating'], 1) if stats_row and stats_row['avg_rating'] else 0,
                'distribution': distribution
            }
        })
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/review/helpful/<int:review_id>', methods=['POST'])
@token_required
def toggle_review_helpful(review_id):
    """Toggles the helpful status for a review (like/unlike)."""
    user_id = request.user['user_id']
    print(f"[HELPFUL] User {user_id} toggling review {review_id}")
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Check if review exists
        cursor.execute("SELECT id, helpful_count FROM product_reviews WHERE id = ?", (review_id,))
        review = cursor.fetchone()
        if not review:
            conn.close()
            return error_response("Review not found", 404)
            
        # Check if already voted
        cursor.execute("SELECT id FROM review_helpful_votes WHERE review_id = ? AND user_id = ?", (int(review_id), int(user_id)))
        vote = cursor.fetchone()
        
        if vote:
            # Unlike: Remove vote and decrement count
            cursor.execute("DELETE FROM review_helpful_votes WHERE id = ?", (vote['id'],))
            new_count = max(0, (review['helpful_count'] or 0) - 1)
            cursor.execute("UPDATE product_reviews SET helpful_count = ? WHERE id = ?", (new_count, review_id))
            message = "Removed helpful vote"
            action = "unliked"
        else:
            # Like: Record vote and increment count
            cursor.execute("INSERT INTO review_helpful_votes (review_id, user_id) VALUES (?, ?)", (review_id, user_id))
            new_count = (review['helpful_count'] or 0) + 1
            cursor.execute("UPDATE product_reviews SET helpful_count = ? WHERE id = ?", (new_count, review_id))
            message = "Marked as helpful"
            action = "liked"
            
        conn.commit()
        conn.close()
        print(f"[HELPFUL] Action: {action}, New Count: {new_count}")
        return success_response({'action': action, 'count': new_count}, message)
    except Exception as e:
        print(f"[HELPFUL] Error: {str(e)}")
        return error_response(str(e), 500)


# ==============================================================================
# SYSTEM: CANCELLATIONS & REFUNDS
# ==============================================================================

@app.route('/api/order/<int:order_id>/cancel', methods=['POST'])
@token_required
def cancel_order(order_id):
    """Allows a user to cancel their order if it hasn't been shipped yet."""
    user_id = request.user['user_id']
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT order_status as status, user_id FROM orders WHERE id = ?", (order_id,))
        order = cursor.fetchone()

        if not order:
            conn.close()
            return error_response("Order not found", 404)

        if order['user_id'] != user_id:
            conn.close()
            return error_response("Unauthorized", 403)

        if order['status'].upper() not in ['PLACED', 'PACKING', 'PACKED', 'PENDING_PAYMENT', 'PENDING']:
            conn.close()
            return error_response(f"Cannot cancel order in {order['status']} status", 400)

        data = request.get_json(silent=True) or {}
        reason = data.get('reason', 'Cancelled by User')
        cursor.execute("UPDATE orders SET order_status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP, cancellation_reason = ? WHERE id = ?", (reason, order_id))
        cursor.execute("UPDATE warehouse_order_assignments SET assignment_status = 'CANCELLED' WHERE order_id = ?", (order_id,))
        notification_service.send_order_notification(user_id, order_id, 'CANCELLED')
        conn.commit()
        conn.close()
        return success_response(None, "Order cancelled successfully", 200)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/order/<int:order_id>/refund-request', methods=['POST'])
@token_required
def request_refund(order_id):
    """Initiates a refund request for a delivered order."""
    user_id = request.user['user_id']
    data = request.json
    reason = data.get('reason')

    if not reason:
        return error_response("Reason is required", 400)

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT order_status as status, user_id FROM orders WHERE id = ?", (order_id,))
        order = cursor.fetchone()

        if not order:
            conn.close()
            return error_response("Order not found", 404)

        if order['user_id'] != user_id:
            conn.close()
            return error_response("Unauthorized", 403)

        if order['status'].upper() != 'DELIVERED':
            conn.close()
            return error_response("Only delivered orders can be refunded", 400)

        cursor.execute('''
            INSERT INTO refund_requests (order_id, user_id, reason)
            VALUES (?, ?, ?)
        ''', (order_id, user_id, reason))
        cursor.execute("UPDATE orders SET order_status = 'REFUND_REQUESTED' WHERE id = ?", (order_id,))

        conn.commit()
        conn.close()

        return success_response(None, "Refund request submitted", 201)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/refund-requests', methods=['GET'])
@token_required
@require_admin()
@require_permission("manage_orders")
def get_admin_refund_requests():
    """Lists all refund requests for administrative review."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT rr.*, u.name as user_name, o.total_amount, o.order_status
            FROM refund_requests rr
            JOIN users u ON rr.user_id = u.id
            JOIN orders o ON rr.order_id = o.id
            ORDER BY rr.created_at DESC
        ''')
        requests = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(requests), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/refund/<int:request_id>', methods=['PATCH'])
@token_required
@require_admin()
@require_permission("manage_orders")
def update_refund_status(request_id):
    """Updates the status of a refund request (APPROVED, REJECTED, etc.)."""
    data = request.json
    new_status = data.get('status')
    
    if new_status not in ['APPROVED', 'REJECTED', 'PROCESSED']:
        return error_response("Invalid status", 400)
        
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT order_id, user_id, status FROM refund_requests WHERE id = ?", (request_id,))
        rr = cursor.fetchone()
        
        if not rr:
            conn.close()
            return error_response("Refund request not found", 404)
            
        cursor.execute("UPDATE refund_requests SET status = ? WHERE id = ?", (new_status, request_id))
        
        if new_status == 'PROCESSED':
            cursor.execute("UPDATE orders SET order_status = 'REFUNDED' WHERE id = ?", (rr['order_id'],))
            notification_service.notify_user_internal(rr['user_id'], "Refund Processed", f"Refund for order #{rr['order_id']} has been processed.", "SYSTEM")
            
            # Wallet refund credit (only on transition to PROCESSED)
            if rr['status'] != 'PROCESSED':
                cursor.execute("SELECT total_amount FROM orders WHERE id = ?", (rr['order_id'],))
                order_row = cursor.fetchone()
                refund_amount = order_row['total_amount'] if order_row else 0
                if refund_amount > 0:
                    cursor.execute("SELECT 1 FROM wallet WHERE user_id = ?", (rr['user_id'],))
                    if cursor.fetchone():
                        cursor.execute("UPDATE wallet SET balance = balance + ? WHERE user_id = ?", (refund_amount, rr['user_id']))
                    else:
                        cursor.execute("INSERT INTO wallet (user_id, balance) VALUES (?, ?)", (rr['user_id'], refund_amount))
                    cursor.execute('''
                        INSERT INTO wallet_transactions (user_id, amount, type, reason, reference_id)
                        VALUES (?, ?, 'credit', ?, ?)
                    ''', (rr['user_id'], refund_amount, f"Refund for order #{rr['order_id']}", str(rr['order_id'])))
        elif new_status == 'APPROVED':
            notification_service.notify_user_internal(rr['user_id'], "Refund Approved", f"Your refund request for order #{rr['order_id']} has been approved.", "SYSTEM")
        elif new_status == 'REJECTED':
            cursor.execute("UPDATE orders SET order_status = 'DELIVERED' WHERE id = ?", (rr['order_id'],))
            notification_service.notify_user_internal(rr['user_id'], "Refund Rejected", f"Your refund request for order #{rr['order_id']} has been rejected.", "SYSTEM")
            
            # Referral reward check (additive). The refund was REJECTED, so the
            # user's return/exchange window is closed for this order — settle
            # the reward immediately instead of waiting for the window sweep.
            try:
                cursor.execute("SELECT total_amount FROM orders WHERE id = ?", (rr['order_id'],))
                order_row = cursor.fetchone()
                order_amount = order_row['total_amount'] if order_row else 0
                from utils.referral import process_referral_reward
                process_referral_reward(rr['order_id'], rr['user_id'], order_amount, settle_now=True)
            except Exception:
                pass  # never break order flow

        conn.commit()
        conn.close()
        return success_response(None, f"Refund request {new_status}", 200)
    except Exception as e:
        return error_response(str(e), 500)

# ==============================================================================
# USER: ADDRESS MANAGEMENT
# ==============================================================================

@app.route('/api/address/add', methods=['POST'])
@token_required
def add_address():
    """Saves a new delivery address for the user."""
    user_id = request.user['user_id']
    data = request.json
    lat = data.get('latitude')
    lng = data.get('longitude')
    address_text = data.get('address_text')
    is_default = data.get('is_default', 0)
    
    if not all([lat, lng, address_text]):
        return error_response("Latitude, Longitude and Address text are required", 400)
        
    try:
        conn = get_db()
        cursor = conn.cursor()
        if is_default:
            cursor.execute("UPDATE user_addresses SET is_default = 0 WHERE user_id = ?", (user_id,))
            
        cursor.execute('''
            INSERT INTO user_addresses (user_id, latitude, longitude, address_text, is_default)
            VALUES (?, ?, ?, ?, ?)
        ''', (user_id, lat, lng, address_text, is_default))
        conn.commit()
        conn.close()
        return success_response(None, "Address saved successfully", 201)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/address/user', methods=['GET'])
@token_required
def get_user_addresses():
    """Retrieves all saved addresses for the authenticated user."""
    user_id = request.user['user_id']
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC", (user_id,))
        addresses = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(addresses), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/address/<int:address_id>', methods=['DELETE'])
@token_required
def delete_address(address_id):
    """Removes a saved address from the user's profile."""
    user_id = request.user['user_id']
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM user_addresses WHERE id = ? AND user_id = ?", (address_id, user_id))
        conn.commit()
        conn.close()
        return success_response(None, "Address deleted", 200)
    except Exception as e:
        return error_response(str(e), 500)


# ==============================================================================
# ADMIN: DATA BACKUP & RECOVERY
# ==============================================================================

@app.route('/api/admin/backup/create', methods=['POST'])
@token_required
@require_super_admin()
def create_admin_backup():
    """Triggers a manual database or system-wide backup."""
    try:
        mode = (request.get_json(silent=True) or {}).get("mode", "full")
        if mode == "database":
            result = {"database_backup": backup_database()}
        else:
            result = create_full_backup()

        admin_id = request.user.get("user_id")
        log_admin_action(admin_id, "create_backup", "backup", None)
        log_admin_event(admin_id, "admin_created_backup", "backup", None, f"Triggered {mode} backup")
        return success_response({"backup": result}, "Backup created successfully", 201)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/backups', methods=['GET'])
@token_required
@require_super_admin()
def get_admin_backups():
    """Lists all available backups with their download metadata."""
    try:
        files = list_backups()
        for item in files:
            item["download_url"] = f"/api/admin/backups/download?path={item['relative_path']}"
        return jsonify({"items": files}), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/backups/download', methods=['GET'])
@token_required
@require_super_admin()
def download_admin_backup():
    """Handles the download of a specific backup file."""
    relative_path = request.args.get("path", "")
    normalized = os.path.normpath(relative_path).replace("\\", "/")
    if normalized.startswith("../") or normalized.startswith("/") or ".." in normalized.split("/"):
        return error_response("Invalid backup path", 400)

    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    target_path = os.path.abspath(os.path.join(project_root, normalized))
    backups_root = os.path.abspath(os.path.join(project_root, "backups"))

    if not target_path.startswith(backups_root):
        return error_response("Path not allowed", 403)
    if not os.path.isfile(target_path):
        return error_response("Backup file not found", 404)

    return send_file(target_path, as_attachment=True)


@app.route('/api/admin/recovery/backups', methods=['GET'])
@token_required
@require_super_admin()
def get_recovery_backups():
    """Retrieves backups specifically for system recovery purposes."""
    try:
        files = list_backups()
        for item in files:
            item["verify_url"] = "/api/admin/recovery/verify"
        return jsonify({"items": files}), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/recovery/verify', methods=['POST'])
@token_required
@require_super_admin()
def verify_recovery_backup():
    """Verifies the integrity of a specific backup before restoration."""
    data = request.get_json(silent=True) or {}
    backup_path = (data.get("path") or "").strip()
    if not backup_path:
        return error_response("Backup path is required", 400)
    try:
        result = verify_backup_integrity(backup_path)
        return jsonify(result), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/recovery/restore/database', methods=['POST'])
@token_required
@require_super_admin()
def restore_recovery_database():
    """Restores the system database from a selected backup."""
    data = request.get_json(silent=True) or {}
    backup_path = (data.get("path") or "").strip()
    if not backup_path:
        return error_response("Backup path is required", 400)
    try:
        result = restore_database(backup_path)
        admin_id = request.user.get("user_id")
        log_admin_action(admin_id, "restore_database", "recovery", None)
        log_admin_event(admin_id, "admin_restored_database", "recovery", None, f"Restored database from {backup_path}")
        return success_response({"result": result}, "Database restored successfully", 200)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/recovery/restore/files', methods=['POST'])
@token_required
@require_super_admin()
def restore_recovery_files():
    """Restores system files from a selected backup."""
    data = request.get_json(silent=True) or {}
    backup_path = (data.get("path") or "").strip()
    if not backup_path:
        return error_response("Backup path is required", 400)
    try:
        result = restore_files(backup_path)
        admin_id = request.user.get("user_id")
        log_admin_action(admin_id, "restore_files", "recovery", None)
        log_admin_event(admin_id, "admin_restored_files", "recovery", None, f"Restored files from {backup_path}")
        return success_response({"result": result}, "Files restored successfully", 200)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/recovery/restore/full', methods=['POST'])
@token_required
@require_super_admin()
def restore_recovery_full_system():
    """Performs a full system restoration (database + files)."""
    data = request.get_json(silent=True) or {}
    db_backup = (data.get("database_path") or "").strip()
    file_backup = (data.get("file_path") or "").strip()
    if not db_backup or not file_backup:
        return error_response("database_path and file_path are required", 400)
    try:
        db_result = restore_database(db_backup)
        file_result = restore_files(file_backup)
        admin_id = request.user.get("user_id")
        log_admin_action(admin_id, "restore_full_system", "recovery", None)
        log_admin_event(admin_id, "admin_restored_full_system", "recovery", None, f"Restored system using {db_backup} and {file_backup}")
        return jsonify({
            "message": "Full system restore completed",
            "database": db_result,
            "files": file_result,
        }), 200
    except Exception as e:
        return error_response(str(e), 500)


# ==============================================================================
# SYSTEM: HEALTH & AVAILABILITY
# ==============================================================================

@app.route('/api/warehouse/availability', methods=['GET'])
def warehouse_availability():
    """Returns current store availability status for the customer-facing frontend."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM dark_stores WHERE active = 1 LIMIT 1")
        store = cursor.fetchone()

        cursor.execute("SELECT key, value FROM system_settings")
        all_settings = cursor.fetchall()
        settings = {row['key']: row['value'] for row in all_settings}

        if not store:
            conn.close()
            return success_response({
                "ordering_enabled": False,
                "can_order": False,
                "weather_status": "clear",
                "message": "No stores are currently available near you.",
                "store_name": None,
                "scheduled_delivery_time": settings.get('scheduled_delivery_time', 'Tomorrow'),
                "scheduled_delivery_note": settings.get('scheduled_delivery_note', 'Reliable fulfillment from our central warehouse.'),
                "cod_enabled_shiprocket": settings.get('cod_enabled_shiprocket', 'false').lower() == 'true',
                "cod_enabled": settings.get('cod_enabled', 'true').lower() == 'true',
                "platform_fee": safe_float(settings.get('platform_fee'), 7),
                "free_delivery_enabled": settings.get('free_delivery_enabled', 'true').lower() == 'true',
                "free_delivery_threshold": safe_float(settings.get('free_delivery_threshold'), 499),
                "delivery_fee": safe_float(settings.get('delivery_fee'), 49),
                "prepaid_delivery_charge": safe_float(settings.get('prepaid_delivery_charge'), 49),
                "cod_delivery_charge": safe_float(settings.get('cod_delivery_charge'), 99),
                "cod_advance_amount": max(0, safe_float(settings.get('cod_advance_amount'), 49)),
                "cod_alert_text": settings.get('cod_alert_text', "Standard COD charges apply."),
                "prepaid_recommendation_enabled": settings.get('prepaid_recommendation_enabled', 'true').lower() == 'true',
                "priority_dispatch_badge_enabled": settings.get('priority_dispatch_badge_enabled', 'true').lower() == 'true'
            }, "Availability checked")

        # Check user-specific COD restriction if logged in
        user_cod_restricted = False
        token = request.headers.get('Authorization')
        if token and token.startswith('Bearer '):
            try:
                from flask import current_app
                import jwt
                payload = jwt.decode(token.split(' ')[1], current_app.config['SECRET_KEY'], algorithms=['HS256'])
                user_id = payload.get('user_id')
                if user_id:
                    cursor.execute("SELECT cod_restricted FROM users WHERE id = ?", (user_id,))
                    u_row = cursor.fetchone()
                    if u_row and u_row['cod_restricted']:
                        user_cod_restricted = True
            except:
                pass

        conn.close()

        return success_response({
            "ordering_enabled": True,
            "can_order": True,
            "weather_status": "clear",
            "message": "Standard delivery available",
            "store_name": store["name"],
            "store_id": store["id"],
            "platform_fee": safe_float(settings.get('platform_fee'), 7),
            "free_delivery_enabled": settings.get('free_delivery_enabled', 'true').lower() == 'true',
            "free_delivery_threshold": safe_float(settings.get('free_delivery_threshold'), 499),
            "delivery_fee": safe_float(settings.get('delivery_fee'), 49),
            "prepaid_delivery_charge": safe_float(settings.get('prepaid_delivery_charge'), 49),
            "cod_delivery_charge": safe_float(settings.get('cod_delivery_charge'), 99),
            "cod_advance_amount": max(0, safe_float(settings.get('cod_advance_amount'), 49)),
            "cod_enabled": settings.get('cod_enabled', 'true').lower() == 'true',
            "cod_enabled_shiprocket": settings.get('cod_enabled_shiprocket', 'false').lower() == 'true',
            "user_cod_restricted": user_cod_restricted,
            "cod_alert_text": settings.get('cod_alert_text', "Standard COD charges apply."),
            "prepaid_recommendation_enabled": settings.get('prepaid_recommendation_enabled', 'true').lower() == 'true',
            "priority_dispatch_badge_enabled": settings.get('priority_dispatch_badge_enabled', 'true').lower() == 'true',
            "scheduled_delivery_time": settings.get('scheduled_delivery_time', 'Tomorrow'),
            "scheduled_delivery_note": settings.get('scheduled_delivery_note', 'Reliable fulfillment from our central warehouse.')
        }, "Availability checked")
    except Exception as e:
        return success_response({
            "ordering_enabled": False,
            "can_order": False,
            "weather_status": "clear",
            "message": "Unable to check availability.",
            "scheduled_delivery_time": "Tomorrow",
            "scheduled_delivery_note": "Reliable fulfillment from our central warehouse."
        }, "Error checking availability")


@app.route('/api/health', methods=['GET'])
def health_check():
    """Basic health check endpoint for monitoring."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        conn.close()
        return jsonify({
            "status": "healthy",
            "database": "connected",
            "db_type": "turso" if USE_TURSO else "local_sqlite",
            "timestamp": datetime.datetime.now().isoformat(),
            "version": "1.0.0"
        }), 200
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return jsonify({
            "status": "unhealthy",
            "database": "error",
            "db_type": "turso" if USE_TURSO else "local_sqlite",
        }), 500


# ==============================================================================
# MAIN EXECUTION
# ==============================================================================

@app.route('/static/uploads/<path:filename>')
def serve_uploads(filename):
    """Serves uploaded files from the static/uploads directory."""
    # Security: Only allow specific extensions
    ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
    if ext not in ALLOWED_EXTENSIONS:
        return error_response("File type not allowed", 403)
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# Ensure database is initialized before any requests
init_db()

if __name__ == '__main__':
    host = os.environ.get('HOST', '0.0.0.0')
    port = int(os.environ.get('PORT', '5000'))
    debug_mode = os.environ.get("FLASK_DEBUG", "").lower() in {"1", "true"}
    app.run(debug=debug_mode, host=host, port=port)

def trigger_low_stock_notifications(product_id, new_stock, product_name):
    """Wrapper for the inventory service trigger."""
    trigger_low_stock_notifications_svc(
        product_id, 
        new_stock, 
        product_name, 
        get_db, 
        notification_service.notify_user_internal
    )
