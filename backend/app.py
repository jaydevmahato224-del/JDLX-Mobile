# ==============================================================================
# JDLX Hyperlocal Quick Commerce - Backend API
# ==============================================================================

# --- Standard Library Imports ---
import datetime
import json
import math
import os
import sqlite3
import time
import uuid
from functools import wraps
from urllib.parse import quote

# --- Environment Configuration ---
from dotenv import load_dotenv
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"), override=True)

# --- Third-Party Imports ---
import jwt
from flask import Flask, jsonify, request, send_file, redirect, session, url_for
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

# --- Local Module Imports ---
from database import init_db, get_db as _database_get_db
from notifier import (
    send_order_email, 
    send_user_status_update_email, 
    send_individual_email, 
    send_bulk_notification_email,
    send_low_stock_catchy_email,
    send_review_thank_you_email,
    send_availability_subscription_confirmation,
    send_product_restock_alert
)
from services.inventory_service import trigger_low_stock_notifications as trigger_low_stock_notifications_svc
from auth.role_guard import normalize_role, require_admin, require_super_admin
from auth.permission_guard import require_permission
from warehouse_routes import warehouse_bp, issue_warehouse_token
from delivery_routes import delivery_bp
from admin_db import admin_db_bp
from complaint_routes import complaint_bp
from support_routes import support_bp
from report_routes import report_bp
from refund_routes import refund_bp
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
from utils.response_utils import success_response, error_response
from utils.product_optimizer import optimizer
from services.health_monitor import get_system_health_metrics
from services.auto_healer import trigger_system_scan

# ==============================================================================
# APP INITIALIZATION & CONFIGURATION
# ==============================================================================

from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

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
    r"^https?://.*\.vercel\.app$",
    r"^https?://.*\.onrender\.com$",
]
if cors_origins_env:
    extra_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
    cors_origins.extend(extra_origins)

CORS(
    app,
    resources={r"/api/*": {
        "origins": cors_origins,
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"],
        "expose_headers": ["Content-Type", "Authorization"]
    }},
    supports_credentials=True,
)

# --- Blueprint Registration ---
app.register_blueprint(warehouse_bp)
app.register_blueprint(delivery_bp)
app.register_blueprint(admin_db_bp)
app.register_blueprint(complaint_bp)
app.register_blueprint(support_bp)
app.register_blueprint(report_bp)
app.register_blueprint(refund_bp)


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
    return product


def is_sticker_category(product_row):
    category_name = (product_row.get('category_name') or product_row.get('category') or '').strip().lower()
    customization_enabled = int(product_row.get('device_customization_enabled') or 0) == 1
    return category_name == 'sticker' or customization_enabled


def allowed_file(filename):
    """Checks if a filename has an allowed extension."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


# ==============================================================================
# PRODUCTION SECURITY & PERFORMANCE
# ==============================================================================

# 1. Secure Headers (XSS, CSP, etc.)
# Disable CSP for local development if it breaks frontend, but enabled for production readiness
Talisman(app, content_security_policy=None, force_https=False)

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


should_start_scheduler = os.environ.get("WERKZEUG_RUN_MAIN") == "true" or not app.debug
if should_start_scheduler and not scheduler.running:
    scheduler.add_job(run_daily_database_backup, 'cron', hour=2, minute=0, id='daily_db_backup', replace_existing=True)
    scheduler.add_job(run_weekly_full_backup, 'cron', day_of_week='sun', hour=3, minute=0, id='weekly_full_backup', replace_existing=True)
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
    
    # Whitelist local traffic to prevent 429 errors during development
    if ip_address in ('127.0.0.1', '::1', 'localhost'):
        return None

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
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

SECRET_KEY = os.environ.get("JWT_SECRET")
if not SECRET_KEY:
    SECRET_KEY = "jdlx_secret_keys_123"
    logger.warning("JWT_SECRET not found in environment. Using insecure default fallback secret.")
app.secret_key = SECRET_KEY
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "false").lower() == "true",
)
# Store / Default OAuth Credentials (Port 5173)
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "473832938691-ihanpc4bfrfq57uvvblp76nlc7lgr1ak.apps.googleusercontent.com")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "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")
GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", "http://localhost:5000/google/callback")
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173").rstrip("/")

# Admin Panel OAuth Credentials (Port 5174)
ADMIN_GOOGLE_CLIENT_ID = os.environ.get("ADMIN_GOOGLE_CLIENT_ID", "473832938691-oa46nvu19l6clb7fucu2u562clitbuah.apps.googleusercontent.com")
ADMIN_GOOGLE_CLIENT_SECRET = os.environ.get("ADMIN_GOOGLE_CLIENT_SECRET", "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")
ADMIN_GOOGLE_REDIRECT_URI = os.environ.get("ADMIN_GOOGLE_REDIRECT_URI", "http://localhost:5000/admin/auth/google/callback")
ADMIN_FRONTEND_URL = os.environ.get("ADMIN_FRONTEND_URL", "http://localhost:5174").rstrip("/")
WAREHOUSE_FRONTEND_URL = os.environ.get("WAREHOUSE_FRONTEND_URL", "http://localhost:5175").rstrip("/")

# Partner Portal OAuth Credentials (Warehouse / Delivery)
PARTNER_GOOGLE_CLIENT_ID = os.environ.get("PARTNER_GOOGLE_CLIENT_ID", GOOGLE_CLIENT_ID)
PARTNER_GOOGLE_CLIENT_SECRET = os.environ.get("PARTNER_GOOGLE_CLIENT_SECRET", GOOGLE_CLIENT_SECRET)
PARTNER_GOOGLE_REDIRECT_URI = os.environ.get("PARTNER_GOOGLE_REDIRECT_URI", "http://localhost:5000/partner/auth/google/callback")

DATABASE_PATH = os.environ.get("DATABASE_PATH") or os.path.join(BASE_DIR, "jdlx.db")
INITIAL_SUPER_ADMIN_EMAIL = os.environ.get("INITIAL_SUPER_ADMIN_EMAIL", "").strip().lower()
DEFAULT_ADMIN_PERMISSIONS = [
    "manage_products",
    "manage_orders",
    "manage_inventory",
    "manage_delivery",
    "view_analytics",
]
AVAILABLE_ADMIN_PERMISSIONS = [
    "manage_products",
    "manage_orders",
    "manage_inventory",
    "manage_delivery",
    "view_analytics",
    "manage_admins",
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
    """Decorator to protect routes with JWT authentication."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            return error_response('Token is missing!', 401)
        try:
            token = token.split(" ")[1] # Bearer <token>
            data = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            data['role'] = normalize_role(data.get('role'))
            request.user = data
        except Exception as e:
            return error_response('Token is invalid!', 401)
        return f(*args, **kwargs)
    return decorated


def run_admin_anomaly_check(admin_id, action_type):
    """Runs anomaly detection for admin actions without interrupting business flow."""
    try:
        detect_admin_activity_anomaly(admin_id, action_type, get_client_ip())
    except Exception:
        pass


def ensure_default_admin_permissions(cursor, admin_id, role="admin"):
    """Bootstraps default permissions for new admin accounts."""
    permissions = DEFAULT_ADMIN_PERMISSIONS
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
        "message": "JDLX Hyperlocal Quick Commerce Backend API",
        "version": "v4.2.0",
        "documentation": "/api/docs"
    }), 200


# --- Routes ---

def process_google_user_login(google_id, email, name, picture, ip_address):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM users WHERE google_id = ?", (google_id,))
    user = cursor.fetchone()

    if not user and email:
        cursor.execute("SELECT * FROM users WHERE LOWER(email) = ?", (email.lower(),))
        user = cursor.fetchone()
        if user:
            cursor.execute(
                "UPDATE users SET google_id = ?, profile_image = COALESCE(?, profile_image), name = COALESCE(?, name) WHERE id = ?",
                (google_id, picture or None, name or None, user['id'])
            )
            conn.commit()
            cursor.execute("SELECT * FROM users WHERE id = ?", (user['id'],))
            user = cursor.fetchone()

    if not user:
        cursor.execute(
            "INSERT INTO users (google_id, name, email, profile_image) VALUES (?, ?, ?, ?)",
            (google_id, name, email, picture)
        )
        conn.commit()
        cursor.execute("SELECT * FROM users WHERE google_id = ?", (google_id,))
        user = cursor.fetchone()

    maybe_bootstrap_super_admin(cursor, user['id'], user['email'])
    conn.commit()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user['id'],))
    user = cursor.fetchone()
    user_dict = dict(user)
    user_role = normalize_role(user_dict.get('role'))
    if user_role in {'admin', 'super_admin'}:
        ensure_default_admin_permissions(cursor, user['id'], role=user_role)
        upsert_admin_record(cursor, user['id'], user_role)
    else:
        remove_admin_record(cursor, user['id'])
    conn.commit()
    conn.close()

    record_login_attempt(email, ip_address, "success")
    if user_role in {'admin', 'super_admin'}:
        log_admin_event(
            user_dict['id'],
            "admin_login",
            "auth",
            user_dict['id'],
            "Admin login successful",
        )
        run_admin_anomaly_check(user_dict['id'], "admin_login")

    payload = {
        'user_id': user_dict['id'],
        'email': user_dict['email'],
        'role': user_role,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(days=7)
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
        "email_verified": user_dict.get('email_verified'),
        "phone_verified": user_dict.get('phone_verified'),
        "role": user_role
    }
    return user_data, jwt_token


# ==============================================================================
# AUTHENTICATION ROUTES
# ==============================================================================

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

        return jsonify({
            "token": jwt_token,
            "user": user_data
        })

    except ValueError:
        record_login_attempt(email_hint, ip_address, "failed")
        detect_failed_login_anomaly(email_hint, ip_address)
        return error_response("Invalid Google token", 401)


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
    state_payload = f"{flow}|{frontend_url}"
    
    from urllib.parse import urlencode
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
    params = {
        'client_id': ADMIN_GOOGLE_CLIENT_ID,
        'redirect_uri': ADMIN_GOOGLE_REDIRECT_URI,
        'response_type': 'code',
        'scope': 'openid email profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
        'prompt': 'select_account',
        'state': frontend_url
    }
    auth_url = f"https://accounts.google.com/o/oauth2/auth?{urlencode(params)}"
    return redirect(auth_url)


@app.route('/admin/auth/google/callback', methods=['GET'])
def admin_google_callback():
    """Callback for admin authentication; enforces admin role requirements."""
    # Retrieve the dynamic frontend URL passed through the state parameter
    state = request.args.get('state')
    frontend_url = state if state and state.startswith('http') else ADMIN_FRONTEND_URL
    
    try:
        # Bypassing Authlib's strict session state validation which often fails on localhost
        # due to cross-site cookie dropping (SameSite/Secure restrictions).
        code = request.args.get('code')
        if not code:
            return redirect(f"{frontend_url}/admin/login?error=oauth_failed&details=Missing authorization code")

        # 1. Exchange code for token directly
        import requests
        token_resp = requests.post(
            'https://oauth2.googleapis.com/token',
            data={
                'client_id': ADMIN_GOOGLE_CLIENT_ID,
                'client_secret': ADMIN_GOOGLE_CLIENT_SECRET,
                'code': code,
                'grant_type': 'authorization_code',
                'redirect_uri': ADMIN_GOOGLE_REDIRECT_URI
            }
        ).json()

        if 'error' in token_resp:
            logger.error(f"Token exchange error: {token_resp}")
            return redirect(f"{frontend_url}/admin/login?error=oauth_failed&details={token_resp.get('error_description', token_resp['error'])}")

        access_token = token_resp.get('access_token')
        
        # 2. Fetch userinfo
        userinfo = requests.get(
            'https://www.googleapis.com/oauth2/v3/userinfo',
            headers={'Authorization': f'Bearer {access_token}'}
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

        user_data, jwt_token = process_google_user_login(google_id, email, name, picture, ip_address)
        user_role = (user_data.get('role') or '').lower()

        admin_roles = {'admin', 'super_admin', 'manager', 'inventory_admin', 'delivery_admin', 'support_admin'}
        if user_role not in admin_roles:
            logger.warning(f"Non-admin login attempt via admin OAuth: {email} (role={user_role})")
            return redirect(f"{frontend_url}/admin/login?error=unauthorized")

        encoded_user = quote(json.dumps(user_data, separators=(',', ':')))
        return redirect(f"{frontend_url}/oauth/callback?oauth_token={jwt_token}&oauth_user={encoded_user}")
            
    except Exception as exc:
        logger.error(f"Admin Google OAuth callback failed: {str(exc)}", exc_info=True)
        # We use a broader try-except to ensure any DB or logic errors redirect back to the login page 
        # with the error details instead of crashing into a JSON response.
        return redirect(f"{frontend_url}/admin/login?error=auth_error&details={quote(str(exc))}")


@app.route('/google/callback', methods=['GET'])
def google_callback():
    """General Google OAuth callback; dispatches based on state-encoded flow."""
    state_payload = request.args.get('state', '')
    if '|' in state_payload:
        flow, frontend_url = state_payload.split('|', 1)
    else:
        flow = 'user'
        frontend_url = state_payload if state_payload.startswith('http') else FRONTEND_BASE_URL

    code = request.args.get('code')
    if not code:
        logger.error("Missing code in Google OAuth callback")
        return error_response("Missing authorization code", 400)

    try:
        # 1. Exchange code for token directly (Stateless)
        import requests
        token_resp = requests.post(
            'https://oauth2.googleapis.com/token',
            data={
                'client_id': GOOGLE_CLIENT_ID,
                'client_secret': GOOGLE_CLIENT_SECRET,
                'code': code,
                'grant_type': 'authorization_code',
                'redirect_uri': GOOGLE_REDIRECT_URI
            }
        ).json()

        if 'error' in token_resp:
            logger.error(f"Token exchange error: {token_resp}")
            return error_response(f"Token exchange failed: {token_resp.get('error_description', token_resp['error'])}", 400)

        access_token = token_resp.get('access_token')
        
        # 2. Fetch userinfo
        userinfo = requests.get(
            'https://www.googleapis.com/oauth2/v3/userinfo',
            headers={'Authorization': f'Bearer {access_token}'}
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
        user_data, jwt_token = process_google_user_login(google_id, email, name, picture, ip_address)
        
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
            encoded_wh_user = quote(json.dumps(wh_user, separators=(',', ':')))
            return redirect(f"{frontend_url}/oauth/callback?oauth_token={wh_token}&oauth_user={encoded_wh_user}")

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
            encoded_dp_user = quote(json.dumps(dp_user, separators=(',', ':')))
            return redirect(f"{frontend_url}/oauth/callback?oauth_token={dp_token}&oauth_user={encoded_dp_user}")

        if flow in ('warehouse_request', 'warehouse_partner_request'):
            req_payload = {
                'email': email,
                'name': name,
                'type': 'warehouse_request',
                'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=2),
            }
            req_token = jwt.encode(req_payload, SECRET_KEY, algorithm='HS256')
            req_user = {'email': email, 'name': name}
            encoded_req_user = quote(json.dumps(req_user, separators=(',', ':')))
            return redirect(f"{frontend_url}/warehouse/request?oauth_token={req_token}&oauth_user={encoded_req_user}")

        if flow == 'delivery_request':
            req_payload = {
                'email': email,
                'name': name,
                'type': 'delivery_request',
                'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=2),
            }
            req_token = jwt.encode(req_payload, SECRET_KEY, algorithm='HS256')
            req_user = {'email': email, 'name': name}
            encoded_req_user = quote(json.dumps(req_user, separators=(',', ':')))
            return redirect(f"{frontend_url}/warehouse/request-delivery?oauth_token={req_token}&oauth_user={encoded_req_user}")

        if flow == 'admin':
            return redirect(f"{frontend_url}/oauth/callback?oauth_token={jwt_token}&oauth_user={encoded_user}")

        # Default: User Flow
        return redirect(f"{frontend_url}/?oauth_token={jwt_token}&oauth_user={encoded_user}")

    except Exception as exc:
        logger.error(f"Google OAuth callback failed: {str(exc)}", exc_info=True)
        return redirect(f"{frontend_url}/?error=auth_error&details={quote(str(exc))}")


# ==============================================================================
# ADMIN: GENERAL MANAGEMENT
# ==============================================================================

@app.route('/api/settings', methods=['GET'])
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
    data = request.json or {}
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


# --- Banner Management ---

@app.route('/api/banners', methods=['GET'])
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
    data = request.json or {}
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
    data = request.json or {}
    email = (data.get('email') or '').strip().lower()
    role = normalize_role(data.get('role'))

    if not email:
        return error_response("email is required", 400)
    if role not in {'admin', 'super_admin'}:
        return error_response("role must be admin or super_admin", 400)

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
    data = request.json or {}
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


@app.route('/api/admin/activity-logs', methods=['GET'])
@token_required
@require_admin()
@require_permission("view_analytics")
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
@require_admin()
@require_permission("view_analytics")
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
@require_admin()
@require_permission("view_analytics")
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
    data = request.json or {}
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
        if not user or normalize_role(user['role']) not in {'admin', 'super_admin'}:
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
    data = request.json or {}
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
@cache.cached(timeout=300, key_prefix='all_categories')
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



@app.route('/api/cart', methods=['GET'])
def get_cart():
    """Retrieves the user's server-side cart, supporting both token and session_id."""
    try:
        user_id = None
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
            try:
                from app import SECRET_KEY
                import jwt
                decoded = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
                user_id = decoded.get('user_id')
            except:
                pass
        
        session_id = request.args.get('session_id')
        
        if not user_id and not session_id:
            return success_response([], "Empty cart (no user or session)")

        conn = get_db()
        cursor = conn.cursor()
        
        if user_id:
            cursor.execute("""
                SELECT c.*, p.name, p.price, p.images, p.category 
                FROM cart c 
                JOIN products p ON c.product_id = p.id 
                WHERE c.user_id = ?
            """, (user_id,))
        else:
            cursor.execute("""
                SELECT c.*, p.name, p.price, p.images, p.category 
                FROM cart c 
                JOIN products p ON c.product_id = p.id 
                WHERE c.session_id = ?
            """, (session_id,))
            
        items = [dict(row) for row in cursor.fetchall()]
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
            from app import SECRET_KEY
            import jwt
            decoded = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
            user_id = decoded.get('user_id')
        except:
            pass

    session_id = data.get('session_id')
    product_id = data.get('product_id')
    quantity = data.get('quantity', 1)
    action = data.get('action', 'add')

    if not user_id and not session_id:
        return error_response("User ID or Session ID required", 400)

    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # 1. AUTO-RELEASE: Clear cart items older than 30 mins
        cursor.execute("DELETE FROM cart WHERE updated_at < datetime('now', '-30 minutes')")
        
        # Build where clause based on what we have
        where_clause = "user_id = ?" if user_id else "session_id = ?"
        id_val = user_id if user_id else session_id

        # Stock Validation (Requirement 1: SOFT RESERVATION)
        # We check against products.stock (which is SQ - HR). 
        # We DO NOT subtract other people's carts (in_others) from displayed stock.
        cursor.execute("SELECT name, stock FROM products WHERE id = ?", (product_id,))
        product = cursor.fetchone()
        if not product:
            return error_response("Product not found", 404)
        
        # Requirement 1 & 4: available_stock (product['stock']) remains unchanged by other carts
        available = max(0, product['stock'])

        if action == 'remove':
            # Release SOFT RESERVATION by simply deleting from cart. 
            # Note: Stock visibility (available_stock) is calculated dynamically as (SQ - HR).
            # If there's a specific 'soft_reserved' field in warehouse_inventory, it should be decremented.
            # However, looking at get_products, 'cart_reserved' is calculated via SUM(cart.quantity).
            # So deleting from cart table IS the release mechanism for soft reservation.
            cursor.execute(f"DELETE FROM cart WHERE {where_clause} AND product_id = ?", (id_val, product_id))
        elif action == 'clear_cart':
            cursor.execute(f"DELETE FROM cart WHERE {where_clause}")
        elif action == 'add':
            cursor.execute(f"SELECT id, quantity FROM cart WHERE {where_clause} AND product_id = ?", (id_val, product_id))
            existing = cursor.fetchone()
            new_qty = (existing['quantity'] if existing else 0) + quantity
            
            if new_qty > available:
                return error_response(f"Only {available} items available in total", 400)
                
            if existing:
                cursor.execute("UPDATE cart SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", (new_qty, existing['id']))
            else:
                if user_id:
                    cursor.execute("INSERT INTO cart (user_id, product_id, quantity, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)", (user_id, product_id, new_qty))
                else:
                    cursor.execute("INSERT INTO cart (session_id, product_id, quantity, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)", (session_id, product_id, new_qty))
        elif action == 'update':
            if quantity > available:
                return error_response(f"Only {available} items available in total", 400)
            cursor.execute(f"UPDATE cart SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE {where_clause} AND product_id = ?", (quantity, id_val, product_id))
            
        conn.commit()
        conn.close()
        return success_response(None, "Cart updated")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/products/<int:product_id>/notify', methods=['POST'])
def register_product_notification(product_id):
    data = request.json
    email = data.get('email')
    user_id = data.get('user_id') # Optional
    
    if not email:
        return error_response("Email is required", 400)
        
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # Get product name
        cursor.execute("SELECT name FROM products WHERE id = ?", (product_id,))
        product = cursor.fetchone()
        if not product:
            return error_response("Product not found", 404)
            
        # Register notification
        cursor.execute("""
            INSERT INTO product_notifications (user_id, email, product_id)
            VALUES (?, ?, ?)
        """, (user_id, email, product_id))
        
        # Send confirmation email
        send_availability_subscription_confirmation(email, product['name'])
        
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
            SELECT w.added_at, p.id, p.name, p.price, p.images, p.category, p.stock
            FROM wishlist w 
            JOIN products p ON w.product_id = p.id 
            WHERE w.user_id = ?
            ORDER BY w.added_at DESC
        """, (user_id,))
        items = [normalize_product_row(row) for row in cursor.fetchall()]
        conn.close()
        return success_response(items, "Wishlist retrieved")
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/wishlist', methods=['POST'])
@token_required
def add_to_wishlist():
    """Adds a product to the user's wishlist."""
    data = request.json
    product_id = data.get('product_id')
    if not product_id:
        return error_response("Product ID required", 400)
    
    try:
        user_id = request.user.get('user_id')
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("INSERT OR IGNORE INTO wishlist (user_id, product_id) VALUES (?, ?)", (user_id, product_id))
        conn.commit()
        conn.close()
        return success_response(None, "Product added to wishlist")
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/wishlist/<int:product_id>', methods=['DELETE'])
@token_required
def remove_from_wishlist(product_id):
    """Removes a product from the user's wishlist."""
    try:
        user_id = request.user.get('user_id')
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM wishlist WHERE user_id = ? AND product_id = ?", (user_id, product_id))
        conn.commit()
        conn.close()
        return success_response(None, "Product removed from wishlist")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/brands', methods=['GET'])
@cache.cached(timeout=300, key_prefix='all_brands')
def get_brands():
    """Retrieves all product brands."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM brands ORDER BY name ASC")
    brands = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return success_response(brands, "Brands retrieved")


@app.route('/api/brands', methods=['POST'])
def create_brand():
    """Creates a new brand."""
    data = request.json or {}
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
def get_category_products(category_id):
    """Retrieves all available products within a specific category."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM products WHERE status='available' AND category_id=?", (category_id,))
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
            WHERE p.status = 'available'
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
                SELECT p.id, p.name, p.price, p.images, p.category_id, p.category, 
                       p.delivery_time, p.return_policy, p.is_featured, p.prepaid_only,
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
                WHERE p.status = 'available' AND wi.warehouse_id = ?
            '''
            params = [store_id]
        else:
            query = '''
                SELECT p.id, p.name, p.price, p.images, p.category_id, p.category, 
                       p.delivery_time, p.stock, p.return_policy, p.is_featured, p.prepaid_only,
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
                WHERE p.status = 'available'
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
                count_query = 'SELECT COUNT(DISTINCT p.id) as total FROM products p INNER JOIN warehouse_inventory wi ON p.id = wi.product_id WHERE p.status = "available" AND wi.warehouse_id = ?'
                count_params = [store_id]
            else:
                count_query = 'SELECT COUNT(DISTINCT p.id) as total FROM products p WHERE p.status = "available"'
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
@cache.cached(timeout=3600, query_string=True)
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
        logger.error(f"Error fetching recommendations: {str(e)}")
        return error_response("Failed to fetch recommendations", 500)


@app.route('/api/products/<int:product_id>', methods=['GET'])
def get_product(product_id):
    """Retrieves detailed information for a single product."""
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
    total_amount = data.get('total_amount')

    user_lat = data.get('latitude', 28.6139)  # Default to Delhi
    user_lng = data.get('longitude', 77.2090)
    delivery_type = data.get('delivery_type', 'quick') # New delivery type


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
            SELECT p.id, p.name, p.category, c.name as category_name,
                   COALESCE(c.device_customization_enabled, 0) as device_customization_enabled
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.id IN ({placeholders})
        """, product_ids)
        product_meta = {row['id']: dict(row) for row in cursor.fetchall()}

        for item in items:
            item['id'] = int(item.get('id'))
            product = product_meta.get(item['id'])
            if not product:
                return error_response(f"Product {item.get('id')} not found", 404)
            device_model = (item.get('device_model') or '').strip()
            item['device_model'] = device_model or None
            if is_sticker_category(product) and not item['device_model']:
                return error_response(f"Select Your Device Model is required for {product['name']}", 400)

        # 1. Select Best Warehouse (Hyperlocal Selection Logic)
        if delivery_type == 'quick':
            # Use warehouses table (source of truth for partners) and check operations_status
            cursor.execute("""
                SELECT w.id, w.warehouse_name as name, ds.latitude, ds.longitude 
                FROM warehouses w
                JOIN dark_stores ds ON w.warehouse_name = ds.name
                WHERE w.account_status = 'active' AND w.operations_status = 'open'
                AND ds.active = 1 AND ds.quick_mode_enabled = 1
            """)
        else:
            cursor.execute("""
                SELECT w.id, w.warehouse_name as name, ds.latitude, ds.longitude 
                FROM warehouses w
                JOIN dark_stores ds ON w.warehouse_name = ds.name
                WHERE w.account_status = 'active' AND w.operations_status = 'open'
            """)
        stores = [dict(row) for row in cursor.fetchall()]
        
        if not stores:
            return error_response("No delivery stores available", 503)
            
        best_store, error_msg = select_best_warehouse(user_lat, user_lng, stores, items, cursor)
        
        if error_msg:
            return error_response(error_msg, 400)
            
        store_id = best_store['id']
        est_time = best_store['estimated_time']

        # 2. Check store-specific inventory (REAL-TIME PHYSICAL STOCK CHECK)
        for item in items:
            cursor.execute("""
                SELECT 
                    wi.stock_quantity,
                    wi.reserved_stock as hard_reserved,
                    p.name
                FROM warehouse_inventory wi
                JOIN products p ON p.id = wi.product_id
                WHERE wi.warehouse_id = ? AND wi.product_id = ?
            """, (store_id, item['id']))
            inventory = cursor.fetchone()
            
            if not inventory:
                return error_response(f"Product {item['id']} not available in selected warehouse", 404)
            
            physical_available = inventory['stock_quantity']
            
            if physical_available < item['qty']:
                return error_response(
                    f"Insufficient physical stock for {inventory['name']}. Available: {max(0, physical_available)}", 
                    400
                )
            
            # Check if any product is prepaid-only
            cursor.execute("SELECT prepaid_only FROM products WHERE id = ?", (item['id'],))
            product_data = cursor.fetchone()
            if product_data and product_data['prepaid_only']:
                is_prepaid_only_order = True

        # Get dynamic fees from settings
        cursor.execute("SELECT key, value FROM system_settings WHERE key IN ('platform_fee', 'free_delivery_threshold', 'delivery_fee', 'prepaid_delivery_charge', 'cod_delivery_charge', 'cod_advance_amount', 'cod_enabled')")
        settings_rows = cursor.fetchall()
        settings = {row['key']: row['value'] for row in settings_rows}
        
        platform_fee = float(settings.get('platform_fee', 7))
        free_thresh = float(settings.get('free_delivery_threshold', 499))
        prepaid_fee = float(settings.get('prepaid_delivery_charge', 49))
        cod_fee = float(settings.get('cod_delivery_charge', 99))
        cod_advance = float(settings.get('cod_advance_amount', 49))
        cod_enabled = settings.get('cod_enabled', 'true').lower() == 'true'

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
            # Check orders from last 30 days
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
        
        if payment_type == 'PREPAID':
            if total_amount >= free_thresh:
                actual_delivery_fee = 0
                free_delivery_applied = 1
            else:
                actual_delivery_fee = prepaid_fee
        else: # COD
            actual_delivery_fee = cod_fee
            free_delivery_applied = 0

        fitting_charge = float(data.get('fitting_charge', 0))
        final_total = total_amount + platform_fee + actual_delivery_fee + fitting_charge
        
        # Calculate Pay Now and COD amounts
        pay_now_amount = final_total
        cod_remaining_amount = 0
        cod_advance_paid = 0
        
        if payment_type == 'COD':
            cod_advance_paid = cod_advance
            pay_now_amount = cod_advance_paid
            cod_remaining_amount = final_total - cod_advance_paid

        # 3. Insert Order with correct column names and delivery_type
        order_number = f"ORD-{uuid.uuid4().hex[:8].upper()}"
        cursor.execute('''
            INSERT INTO orders (
                order_number, user_id, customer_name, customer_phone, delivery_address, 
                order_status, total_amount, dark_store_id, estimated_delivery, 
                delivery_latitude, delivery_longitude, payment_status, delivery_type,
                platform_fee, delivery_fee, fitting_charge, payment_type,
                cod_advance_paid, cod_remaining_amount, free_delivery_applied
            )
            VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            order_number, user_id, data.get('customer_name', 'Valued Customer'), 
            phone, address, final_total, store_id, f"{est_time} mins", 
            user_lat, user_lng, delivery_type, platform_fee, actual_delivery_fee, fitting_charge,
            payment_type, cod_advance_paid, cod_remaining_amount, free_delivery_applied
        ))

        
        order_id = cursor.lastrowid

        # 4. Insert Order Items and Update both store and global stock (Requirement 2: HARD RESERVATION)
        for item in items:
            cursor.execute(
                "INSERT INTO order_items (order_id, product_id, quantity, price, device_model, fitting_charge) VALUES (?, ?, ?, ?, ?, ?)",
                (order_id, item['id'], item['qty'], item['price'], item.get('device_model'), item.get('fitting_charge', 0))
            )
            
            # Requirement 2: Reduce stock_quantity immediately on order confirmation.
            # This counts as "ORDER CONFIRMED". Triggers sync available_stock and products.stock.
            cursor.execute("""
                UPDATE warehouse_inventory 
                SET stock_quantity = MAX(0, stock_quantity - ?),
                    updated_at = CURRENT_TIMESTAMP
                WHERE warehouse_id = ? AND product_id = ?
            """, (item['qty'], store_id, item['id']))

            # Trigger Low Stock Notifications if stock drops to <= 5 (matching UI default)
            cursor.execute("SELECT name, stock, low_stock_threshold FROM products WHERE id = ?", (item['id'],))
            prod_data = cursor.fetchone()
            if prod_data and 0 < prod_data['stock'] <= (prod_data['low_stock_threshold'] or 5):
                # We do this in the background or after commit to not block checkout
                trigger_low_stock_notifications_svc(
                    item['id'], 
                    prod_data['stock'], 
                    prod_data['name'],
                    get_db,
                    notification_service.notify_user_internal
                )

        conn.commit()

        # 5. Sync with Shiprocket for Standard Delivery
        if delivery_type != 'quick':
            try:
                order_payload = {
                    "order_number": order_number,
                    "customer_name": data.get('customer_name', 'Valued Customer'),
                    "customer_phone": phone,
                    "delivery_address": address,
                    "total_amount": final_total,
                    "items": items,
                    "payment_status": "PENDING"
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

        # Trigger Gmail Notification
        enriched_items = []
        for item in items:
            cursor.execute("SELECT name FROM products WHERE id = ?", (item['id'],))
            p = cursor.fetchone()
            enriched_items.append({
                "name": p['name'] if p else "Unknown Product",
                "qty": item['qty'],
                "price": item['price']
            })
        
        conn.close()

        order_details = {
            "order_id": order_id,
            "customer_name": user_info['name'],
            "total_amount": total_amount,
            "items": enriched_items,
            "address": address
        }
        send_order_email(user_info['email'], order_details)
        
        return jsonify({
            "message": "Order placed successfully", 
            "order_id": order_id,
            "estimated_delivery_time": f"{est_time} mins",
            "assigned_store": best_store['name'],
            "summary": {
                "subtotal": total_amount,
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
            SELECT o.*, 
                   dp.name as partner_name, dp.phone as partner_phone,
                   ds.store_code, ds.name as store_name
            FROM orders o 
            LEFT JOIN delivery_partners dp ON o.delivery_partner_id = dp.id 
            LEFT JOIN dark_stores ds ON o.store_id = ds.id
            WHERE o.id = ? AND o.user_id = ?
        ''', (order_id, user_id))
        order = cursor.fetchone()
        conn.close()
        
        if order:
            return jsonify(dict(order))
        return error_response("Order not found", 404)
    except Exception as e:
        return error_response(str(e), 500)

@app.route('/api/user/orders', methods=['GET'])
@token_required
def get_user_orders():
    user_id = request.user['user_id']
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT id, order_number, created_at, order_status as status, total_amount, delivery_type FROM orders WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
        orders = [dict(row) for row in cursor.fetchall()]
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
        conn.close()
        
        if tracking_data:
            return jsonify({
                "order_status": tracking_data['order_status'],
                "assigned_rider": {
                    "name": tracking_data['rider_name'],
                    "phone": tracking_data['rider_phone']
                } if tracking_data['rider_name'] else None,
                "estimated_delivery_time": tracking_data['estimated_delivery']
            })
        return error_response("Order not found", 404)
    except Exception as e:
        return error_response(str(e), 500)

def handle_stock_on_status_change(cursor, order_id, old_status, new_status):
    """Adjusts inventory based on order status transitions."""
    if old_status == new_status:
        return

    # Transitions to DELIVERED: Stock is already reduced at checkout. 
    # No action needed for stock_quantity.
    if new_status == 'DELIVERED' and old_status != 'DELIVERED':
        pass

    # Transitions to CANCELLED/REFUNDED/REJECTED: Add stock_quantity back.
    elif new_status in ['CANCELLED', 'REFUNDED', 'REJECTED'] and old_status not in ['CANCELLED', 'REFUNDED', 'REJECTED', 'DELIVERED']:
        cursor.execute("SELECT product_id, quantity FROM order_items WHERE order_id = ?", (order_id,))
        items = cursor.fetchall()
        cursor.execute("SELECT dark_store_id as store_id FROM orders WHERE id = ?", (order_id,))
        order = cursor.fetchone()
        if order and order['store_id']:
            for item in items:
                cursor.execute("""
                    UPDATE warehouse_inventory 
                    SET stock_quantity = stock_quantity + ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE warehouse_id = ? AND product_id = ?
                """, (item['quantity'], order['store_id'], item['product_id']))

@app.route('/api/admin/order/<int:order_id>/status', methods=['PATCH'])
@token_required
@require_admin()
@require_permission("manage_orders")
def admin_update_order_status(order_id):
    data = request.json
    new_status = data.get('status')
    
    # Valid stages: PLACED, PACKING, OUT_FOR_DELIVERY, DELIVERED
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Get current status
        cursor.execute("SELECT status FROM orders WHERE id = ?", (order_id,))
        current_status_row = cursor.fetchone()
        old_status = current_status_row['status'] if current_status_row else None

        handle_stock_on_status_change(cursor, order_id, old_status, new_status)

        timestamp_col = None
        if new_status == 'PACKING': timestamp_col = "status_packing_at"
        elif new_status == 'READY_FOR_PICKUP': timestamp_col = "status_ready_at"
        elif new_status == 'OUT_FOR_DELIVERY': timestamp_col = "status_out_at"
        elif new_status == 'DELIVERED': timestamp_col = "status_delivered_at"
        
        if timestamp_col:
            cursor.execute(f"UPDATE orders SET status = ?, {timestamp_col} = CURRENT_TIMESTAMP WHERE id = ?", (new_status, order_id))
        else:
            cursor.execute("UPDATE orders SET status = ? WHERE id = ?", (new_status, order_id))

        # Notify user about status update
        cursor.execute("SELECT user_id FROM orders WHERE id = ?", (order_id,))
        user_row = cursor.fetchone()
        if user_row:
            notification_service.send_order_notification(user_row['user_id'], order_id, new_status)

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
            cursor.execute("SELECT id, name, email, profile_image, phone, gender, date_of_birth, about, terms_accepted_version, terms_accepted_at, email_verified, phone_verified FROM users WHERE id = ?", (user_id,))
            user = cursor.fetchone()
            conn.close()
            if not user:
                return error_response("User not found", 404)
            return jsonify(dict(user))
        except Exception as e:
            return error_response(str(e), 500)
    else:
        data = request.form.to_dict() if request.form else request.json or {}
        name = data.get('name')
        phone = data.get('phone')
        gender = data.get('gender')
        dob = data.get('date_of_birth')
        about = data.get('about')
        
        image_url = None
        if 'file' in request.files:
            file = request.files['file']
            if file and allowed_file(file.filename):
                filename = secure_filename(file.filename)
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                file.save(filepath)
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
                
            cursor.execute("SELECT id, name, email, profile_image, phone, gender, date_of_birth, about, terms_accepted_version, terms_accepted_at, email_verified, phone_verified FROM users WHERE id = ?", (user_id,))
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
    data = request.json or {}
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
    data = request.json or {}
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


@app.route('/api/user/wallet', methods=['GET', 'POST'])
@token_required
def user_wallet():
    """Retrieves wallet balance and transaction history, or records new transactions."""
    user_id = request.user['user_id']
    data = request.json or {}
    try:
        conn = get_db()
        cursor = conn.cursor()
        if request.method == 'GET':
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
        else:
            amount = float(data.get('amount', 0))
            ttype = data.get('type', 'credit')
            ref = data.get('reference')
            cursor.execute("INSERT INTO wallet_transactions (user_id, amount, type, reference) VALUES (?,?,?,?)", (user_id, amount, ttype, ref))
            cursor.execute("UPDATE wallet SET balance = balance + ? WHERE user_id = ?", (amount, user_id))
            conn.commit()
            conn.close()
            return success_response(None, "transaction recorded", 201)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/user/notifications', methods=['GET', 'PUT'])
@token_required
def user_notifications():
    """Retrieves or marks notifications as read for the user."""
    user_id = request.user['user_id']
    data = request.json or {}
    try:
        conn = get_db()
        cursor = conn.cursor()
        if request.method == 'GET':
            cursor.execute("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
            notes = [dict(r) for r in cursor.fetchall()]
            conn.close()
            return jsonify(notes)
        else:
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
    data = request.json or {}
    try:
        conn = get_db()
        cursor = conn.cursor()
        if request.method == 'GET':
            cursor.execute("SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
            tickets = [dict(r) for r in cursor.fetchall()]
            conn.close()
            return jsonify(tickets)
        else:
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
    data = request.json or {}
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
                   (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.order_status = 'cancelled') as cancelled_orders 
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
@require_permission("manage_admins")
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


@app.route('/api/admin/users/<int:user_id>/send-email', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_admins")
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

        from threading import Thread
        Thread(target=send_individual_email, args=(user_row['email'], user_row['name'], subject, message)).start()
        
        return success_response(None, f"Email sent to {user_row['email']}")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/notifications/bulk', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_admins")
def send_bulk_notices():
    """Sends a bulk email notification to all registered users."""
    subject = request.json.get('subject')
    message = request.json.get('message')
    
    if not subject or not message:
        return error_response("Subject and message are required", 400)
        
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT email FROM users WHERE email IS NOT NULL")
        user_emails = [row['email'] for row in cursor.fetchall()]
        conn.close()
        
        if not user_emails:
            return error_response("No users found", 404)
            
        try:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO mail_history (admin_id, recipient_type, recipient_count, subject, message)
                VALUES (?, ?, ?, ?, ?)
            ''', (request.user.get('user_id'), 'bulk', len(user_emails), subject, message))
            conn.commit()
            conn.close()
        except Exception as db_err:
            logger.error(f"Failed to record bulk mail history: {str(db_err)}")

        from threading import Thread
        Thread(target=send_bulk_notification_email, args=(user_emails, subject, message)).start()
        
        return success_response(None, f"Bulk notification process started for {len(user_emails)} users")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/notifications/in-app-broadcast', methods=['POST'])
@token_required
@require_admin()
@require_permission("manage_admins")
def admin_in_app_broadcast():
    """Creates an in-app notification for all users (admin broadcast)."""
    data = request.json or {}
    title = (data.get('title') or '').strip()
    message = (data.get('message') or '').strip()
    ntype = (data.get('type') or 'SYSTEM').strip() or 'SYSTEM'

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
        Thread(target=send_individual_email, args=(recipient_email, subject, message)).start()
        
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
        cursor.execute("SELECT COUNT(*) as total_orders, SUM(total_amount) as total_revenue FROM orders")
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
@require_admin()
def admin_system_health_detail():
    """Retrieves detailed health metrics for system components."""
    try:
        metrics = get_system_health_metrics()
        return jsonify(metrics), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/system/logs', methods=['GET'])
@token_required
@require_admin()
def get_admin_system_logs():
    """Retrieves security alerts, blocked IPs, and failed login logs."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM security_alerts ORDER BY created_at DESC LIMIT 20")
        suspicious = [dict(row) for row in cursor.fetchall()]
        
        cursor.execute("SELECT * FROM blocked_ips WHERE blocked_until > ?", (time.time(),))
        blocked = [dict(row) for row in cursor.fetchall()]
        
        cursor.execute("SELECT * FROM login_attempts WHERE success = 0 ORDER BY timestamp DESC LIMIT 20")
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
@require_admin()
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
@require_admin()
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
        cursor.execute("""
            SELECT o.*, u.name as customer_name, u.email as customer_email,
                   ds.store_code, ds.name as store_name 
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            LEFT JOIN dark_stores ds ON o.store_id = ds.id
            ORDER BY o.created_at DESC
        """)
        orders = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(orders)
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
                   ds.store_code, ds.name as store_name,
                   dp.name as partner_name, dp.phone as partner_phone
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            LEFT JOIN dark_stores ds ON o.store_id = ds.id
            LEFT JOIN delivery_partners dp ON o.delivery_partner_id = dp.id
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
    new_status = data.get('status')
    try:
        conn = get_db()
        cursor = conn.cursor()

        # Get current status
        cursor.execute("SELECT status FROM orders WHERE id = ?", (order_id,))
        current_status_row = cursor.fetchone()
        old_status = current_status_row['status'] if current_status_row else None

        handle_stock_on_status_change(cursor, order_id, old_status, new_status)

        cursor.execute("UPDATE orders SET order_status=? WHERE id=?", (new_status, order_id))
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
    data = request.json or {}
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
    data = request.json or {}
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
    """Adds a new product to the global catalog."""
    data = request.json
    name = data.get('name')
    price = data.get('price')
    stock = data.get('stock', 0)
    category = data.get('category')
    delivery_time = data.get('delivery_time', '30-120 mins')
    images = data.get('images')

    if not name or price is None:
        return error_response("Missing required fields", 400)

    if not isinstance(stock, (int, float)) or stock < 0:
        return error_response("Stock must be a non-negative number", 400)

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO products (name, price, stock, category, delivery_time, images, barcode, global_sku_code, return_policy, prepaid_only) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (name, price, int(stock), category, delivery_time, images, data.get('barcode'), data.get('global_sku_code'), data.get('return_policy'), data.get('prepaid_only', 0))
        )
        product_id = cursor.lastrowid
        conn.commit()
        conn.close()
        log_admin_action(request.user.get('user_id'), "product_updated", "product", product_id)
        log_admin_event(
            request.user.get('user_id'),
            "admin_updated_product",
            "product",
            product_id,
            f"Created product {name}",
        )
        run_admin_anomaly_check(request.user.get('user_id'), "admin_updated_product")
        return success_response({"id": product_id}, "Product added", 201)
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
        updates = []
        params = []
        for key in ['name', 'price', 'stock', 'category', 'delivery_time', 'status', 'images', 'barcode', 'global_sku_code', 'return_policy', 'is_featured', 'prepaid_only']:
            if key in data:
                updates.append(f"{key}=?")
                params.append(data[key])
        
        if not updates:
            return success_response(None, "No updates provided", 400)
            
        params.append(product_id)
        cursor.execute(f"UPDATE products SET {', '.join(updates)} WHERE id=?", tuple(params))
        
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
        return success_response(None, "Product updated")
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/admin/pincode-rules', methods=['GET'])
@token_required
@require_admin()
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
        # Fetch inventory across all warehouses with store codes
        cursor.execute("""
            SELECT 
                p.id, 
                p.name as product_name, 
                p.price, 
                p.category,
                wi.sku as sku,
                wi.stock_quantity as stock, 
                (wi.reserved_stock + COALESCE((SELECT SUM(quantity) FROM cart WHERE product_id = p.id), 0)) as reserved_stock,
                COALESCE((SELECT SUM(quantity) FROM cart WHERE product_id = p.id AND user_id IS NOT NULL), 0) as user_reserved,
                COALESCE((SELECT SUM(quantity) FROM cart WHERE product_id = p.id AND session_id IS NOT NULL AND user_id IS NULL), 0) as guest_reserved,
                wi.low_stock_threshold,
                wi.status,
                w.warehouse_name as store_name,
                w.partner_id as store_code,
                ROUND(COALESCE((SELECT AVG(rating) FROM product_reviews WHERE product_id = p.id), 0), 1) as average_rating,
                p.return_policy,
                c.return_policy as category_return_policy
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN warehouse_inventory wi ON p.id = wi.product_id
            LEFT JOIN warehouses w ON wi.warehouse_id = w.id
            ORDER BY w.warehouse_name ASC, p.name ASC
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
        
        cursor.execute("SELECT COUNT(*) as low_stock FROM warehouse_inventory WHERE stock_quantity <= low_stock_threshold AND stock_quantity > 0")
        low_stock = cursor.fetchone()['low_stock']
        
        cursor.execute("SELECT COUNT(*) as out_of_stock FROM warehouse_inventory WHERE stock_quantity <= 0")
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
        filename = secure_filename(f"{datetime.datetime.now().timestamp()}_{file.filename}")
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        file_url = f"/static/uploads/{filename}"
        return jsonify({"url": file_url}), 201
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
                COUNT(CASE WHEN o.order_status NOT IN ('delivered', 'cancelled', 'returned', 'refunded') THEN o.id END) as active_orders,
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
            SELECT o.order_status as status, o.latitude as cust_lat, o.longitude as cust_lng, 
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
        cursor.execute("SELECT total_amount, payment_type, cod_advance_paid FROM orders WHERE id = ?", (order_id,))
        order = cursor.fetchone()
        
        if not order:
            conn.close()
            return error_response("Order not found", 404)
            
        # Determine amount to pay now
        amount_to_pay = order['total_amount']
        if order['payment_type'] == 'COD':
            amount_to_pay = order['cod_advance_paid']

        razorpay_order = payment_service.create_payment_order(amount_to_pay, order_id)
        
        cursor.execute('''
            INSERT INTO payments (order_id, payment_method, amount, transaction_id, payment_status)
            VALUES (?, ?, ?, ?, 'PENDING')
        ''', (order_id, data.get('payment_method', 'RAZORPAY'), amount_to_pay, razorpay_order['id']))
        
        conn.commit()
        conn.close()
        return jsonify(razorpay_order), 200
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/payment/verify', methods=['POST'])
@token_required
def verify_payment():
    """Verifies a payment transaction and updates the order status."""
    data = request.json
    order_id = data.get('order_id')
    razorpay_payment_id = data.get('razorpay_payment_id')
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT user_id, payment_type, cod_advance_paid FROM orders WHERE id = ?", (order_id,))
        user_row = cursor.fetchone()
        user_id = user_row['user_id'] if user_row else None
        payment_type = user_row['payment_type'] if user_row else 'PREPAID'

        # If it's a COD order, we expect a Razorpay payment for the advance amount
        # unless COD advance is 0 (which is not our case here)
        if data.get('payment_method') == 'COD' and payment_type != 'COD':
             # Trying to use COD on a PREPAID order - not allowed
             return error_response("Payment method mismatch", 400)
        
        if data.get('payment_method') == 'COD' and payment_type == 'COD' and user_row['cod_advance_paid'] <= 0:
            # Pure COD with no advance (if we ever support it)
            cursor.execute("UPDATE orders SET status = 'PLACED', payment_status = 'PENDING' WHERE id = ?", (order_id,))
            cursor.execute("UPDATE payments SET payment_status = 'SUCCESS' WHERE order_id = ?", (order_id,))
            if user_id:
                notification_service.send_order_notification(user_id, order_id, 'PLACED')
            conn.commit()
            conn.close()
            return success_response(None, "COD order confirmed", 200)

        # In mock mode, we assume signature is valid if provided
        is_valid = True 
        
        if is_valid:
            new_payment_status = 'PAID' if payment_type == 'PREPAID' else 'ADVANCE_PAID'
            cursor.execute("UPDATE orders SET status = 'PLACED', payment_status = ? WHERE id = ?", (new_payment_status, order_id))
            cursor.execute('UPDATE payments SET payment_status = "SUCCESS", transaction_id = ? WHERE order_id = ?', (razorpay_payment_id, order_id))
            if user_id:
                notification_service.send_order_notification(user_id, order_id, 'PLACED')
            conn.commit()
            conn.close()
            return success_response(None, "Payment verified and order placed", 200)
        else:
            conn.close()
            return error_response("Invalid payment signature", 400)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/payment/<int:order_id>', methods=['GET'])
@token_required
def get_payment_status(order_id):
    """Retrieves the payment status for a specific order."""
    try:
        conn = get_db()
        cursor = conn.cursor()
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
        cursor.execute("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
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
        cursor.execute("UPDATE notifications SET read_status = 1 WHERE id = ? AND user_id = ?", (notif_id, user_id))
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
        cursor.execute("UPDATE notifications SET read_status = 1 WHERE user_id = ?", (user_id,))
        conn.commit()
        conn.close()
        return success_response(None, "All marked as read", 200)
    except Exception as e:
        return error_response(str(e), 500)


@app.route('/api/review/add', methods=['POST'])
@token_required
def add_review():
    """Adds a product review (only for verified buyers)."""
    data = request.json
    user_id = request.user['user_id']
    product_id = data.get('product_id')
    rating = data.get('rating')
    review_text = data.get('review_text', '')

    if not product_id or not rating:
        return error_response("Product ID and rating are required", 400)

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
                from config import SECRET_KEY
                import jwt
                payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
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
        cursor.execute("SELECT status, user_id FROM orders WHERE id = ?", (order_id,))
        order = cursor.fetchone()
        
        if not order:
            conn.close()
            return error_response("Order not found", 404)
            
        if order['user_id'] != user_id:
            conn.close()
            return error_response("Unauthorized", 403)
            
        if order['status'] not in ['PLACED', 'PACKING', 'PENDING_PAYMENT']:
            conn.close()
            return error_response(f"Cannot cancel order in {order['status']} status", 400)
            
        cursor.execute("UPDATE orders SET status = 'CANCELLED' WHERE id = ?", (order_id,))
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
        cursor.execute("SELECT status, user_id FROM orders WHERE id = ?", (order_id,))
        order = cursor.fetchone()
        
        if not order:
            conn.close()
            return error_response("Order not found", 404)
            
        if order['user_id'] != user_id:
            conn.close()
            return error_response("Unauthorized", 403)
            
        if order['status'] != 'DELIVERED':
            conn.close()
            return error_response("Only delivered orders can be refunded", 400)
            
        cursor.execute('''
            INSERT INTO refund_requests (order_id, user_id, reason)
            VALUES (?, ?, ?)
        ''', (order_id, user_id, reason))
        cursor.execute("UPDATE orders SET status = 'REFUND_REQUESTED' WHERE id = ?", (order_id,))
        
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
            SELECT rr.*, u.name as user_name, o.total_amount, o.order_order_status
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
        cursor.execute("SELECT order_id, user_id FROM refund_requests WHERE id = ?", (request_id,))
        rr = cursor.fetchone()
        
        if not rr:
            conn.close()
            return error_response("Refund request not found", 404)
            
        cursor.execute("UPDATE refund_requests SET status = ? WHERE id = ?", (new_status, request_id))
        
        if new_status == 'PROCESSED':
            cursor.execute("UPDATE orders SET status = 'REFUNDED' WHERE id = ?", (rr['order_id'],))
            notification_service.notify_user_internal(rr['user_id'], "Refund Processed", f"Refund for order #{rr['order_id']} has been processed.", "SYSTEM")
        elif new_status == 'APPROVED':
            notification_service.notify_user_internal(rr['user_id'], "Refund Approved", f"Your refund request for order #{rr['order_id']} has been approved.", "SYSTEM")
        elif new_status == 'REJECTED':
            cursor.execute("UPDATE orders SET status = 'DELIVERED' WHERE id = ?", (rr['order_id'],))
            notification_service.notify_user_internal(rr['user_id'], "Refund Rejected", f"Your refund request for order #{rr['order_id']} has been rejected.", "SYSTEM")

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
        mode = (request.json or {}).get("mode", "full")
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
    data = request.json or {}
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
    data = request.json or {}
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
    data = request.json or {}
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
    data = request.json or {}
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

        conn.close()

        if not store:
            return success_response({
                "ordering_enabled": False,
                "can_order": False,
                "weather_status": "clear",
                "message": "No stores are currently available near you.",
                "store_name": None,
                "scheduled_delivery_time": settings.get('scheduled_delivery_time', 'Tomorrow'),
                "scheduled_delivery_note": settings.get('scheduled_delivery_note', 'Reliable fulfillment from our central warehouse.')
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

        return success_response({
            "ordering_enabled": True,
            "can_order": True,
            "weather_status": "clear",
            "message": "Delivering in 10–20 mins",
            "store_name": store["name"],
            "store_id": store["id"],
            "quick_mode_enabled": bool(store.get("quick_mode_enabled", 0)),
            "platform_fee": float(settings.get('platform_fee', 7)),
            "free_delivery_threshold": float(settings.get('free_delivery_threshold', 499)),
            "delivery_fee": float(settings.get('delivery_fee', 49)),
            "prepaid_delivery_charge": float(settings.get('prepaid_delivery_charge', 49)),
            "cod_delivery_charge": float(settings.get('cod_delivery_charge', 99)),
            "cod_advance_amount": float(settings.get('cod_advance_amount', 49)),
            "cod_enabled": settings.get('cod_enabled', 'true').lower() == 'true',
            "user_cod_restricted": user_cod_restricted,
            "cod_alert_text": settings.get('cod_alert_text', "Standard COD charges apply."),
            "prepaid_recommendation_enabled": settings.get('prepaid_recommendation_enabled', 'true').lower() == 'true',
            "priority_dispatch_badge_enabled": settings.get('priority_dispatch_badge_enabled', 'true').lower() == 'true',
            "scheduled_delivery_time": settings.get('scheduled_delivery_time', 'Tomorrow'),
            "scheduled_delivery_note": settings.get('scheduled_delivery_note', 'Reliable fulfillment from our central warehouse.'),
            "quick_delivery_max_distance": float(settings.get('quick_delivery_max_distance', 5)),
            "quick_delivery_note": settings.get('quick_delivery_note', 'Hyperlocal dispatch from the active dark store.')
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
        return jsonify({
            "status": "healthy",
            "database": "connected",
            "allowed_origins": cors_origins,
            "timestamp": datetime.datetime.now().isoformat(),
            "version": "1.0.0"
        }), 200
    except Exception as e:
        return jsonify({
            "status": "unhealthy",
            "database": "error",
            "error": str(e),
            "allowed_origins": cors_origins
        }), 500


# ==============================================================================
# MAIN EXECUTION
# ==============================================================================

# Ensure database is initialized before any requests
init_db()

if __name__ == '__main__':
    host = os.environ.get('HOST', '0.0.0.0')
    port = int(os.environ.get('PORT', '5000'))
    app.run(debug=True, host=host, port=port)

def trigger_low_stock_notifications(product_id, new_stock, product_name):
    """Wrapper for the inventory service trigger."""
    trigger_low_stock_notifications_svc(
        product_id, 
        new_stock, 
        product_name, 
        get_db, 
        notification_service.notify_user_internal
    )
