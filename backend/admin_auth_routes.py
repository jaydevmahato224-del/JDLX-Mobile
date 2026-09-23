"""
Admin credential authentication: password login, security questions,
profile (email/phone) updates and password changes.

Security model
--------------
- Password login: email OR admin_phone + password (werkzeug pbkdf2 hash).
  Enumeration-safe (same error for unknown email / wrong password).
  Brute force feeds the shared login_guard lockout + security alerts.
- Security question: must be SET UP (or answered) before any sensitive change
  (email/phone update, password change). Answers are hashed; verification is
  attempt-limited via login_guard lockout.
- Every sensitive action is written to admin_security_events (audit trail)
  and the admin_audit_logs via log_admin_event.
- All endpoints are rate-limited and CSRF-exempt only where they must be
  (login / pre-auth endpoints); authenticated ones carry the JWT.

Registered in app.py as a Flask blueprint.
"""
import datetime
import re

from flask import Blueprint, jsonify, request
from werkzeug.security import generate_password_hash, check_password_hash

from auth.role_guard import normalize_role
from database import get_db
from utils.logger import logger
from utils.response_utils import success_response, error_response
from security.login_guard import record_login_attempt, is_account_locked
from security.admin_audit_logger import log_admin_event
from security.anomaly_detector import create_security_alert

import jwt as pyjwt
import secrets

# --- constants (mirrored from app.py to avoid circular imports) ---
ADMIN_LOGIN_ROLES = ['admin', 'super_admin', 'manager', 'inventory_admin', 'delivery_admin', 'support_admin']
SECURITY_QUESTIONS = [
    "What was the name of your first school?",
    "What is your mother's maiden name?",
    "What was the make of your first car/bike?",
    "What is the name of the street you grew up on?",
    "What was your childhood nickname?",
]
PASSWORD_MIN_LENGTH = 8
MAX_SETUP_ATTEMPTS = 10  # security-answer attempts per window (login_guard handles lockout)

admin_auth_bp = Blueprint('admin_auth', __name__)


def _issue_admin_token(user_row):
    """Issue the admin JWT exactly like app.admin_verify_otp does (8h)."""
    from jwt_config import get_jwt_secret
    now_utc = datetime.datetime.utcnow()
    payload = {
        'user_id': user_row['id'],
        'email': user_row['email'],
        'role': normalize_role(user_row['role']),
        'iat': now_utc,
        'jti': secrets.token_hex(16),
        'exp': now_utc + datetime.timedelta(hours=8),
    }
    return pyjwt.encode(payload, get_jwt_secret(), algorithm="HS256"), payload


def _get_user_by_login(identifier):
    """Look up an admin user by email OR admin_phone (case-insensitive)."""
    ident = (identifier or '').strip().lower()
    if not ident:
        return None
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(COALESCE(admin_phone, '')) = ?",
            (ident, ident),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _is_admin_user(user):
    if not user:
        return False
    return normalize_role(user.get('role')) in ADMIN_LOGIN_ROLES


def _log_security_event(admin_id, email, event_type, description, ip):
    conn = get_db()
    try:
        conn.execute(
            '''INSERT INTO admin_security_events (admin_id, email, event_type, description, ip_address)
               VALUES (?, ?, ?, ?, ?)''',
            (admin_id, email, event_type, description, ip),
        )
        conn.commit()
    except Exception as e:
        logger.error(f"admin_security_events insert failed: {e}")
    finally:
        conn.close()


def _client_ip():
    return request.headers.get("X-Forwarded-For", request.remote_addr) or "unknown"


# ---------------------------------------------------------------------------
# 1. PASSWORD LOGIN
# ---------------------------------------------------------------------------
@admin_auth_bp.route('/api/admin/login-password', methods=['POST'])
def admin_login_password():
    """Password login with email (or admin mobile) + password.

    Enumeration-safe: unknown identifier and wrong password return the same
    generic error. Failures feed the shared login_guard lockout.
    """
    from app import get_cookie_settings  # local import avoids circulars

    data = request.get_json(silent=True) or {}
    identifier = (data.get('identifier') or data.get('email') or '').strip()
    password = (data.get('password') or '').strip()

    if not identifier or not password:
        return error_response("Email/mobile and password are required", 400)

    ip = _client_ip()
    ident_key = identifier.lower()

    if is_account_locked(ident_key):
        return error_response("Account temporarily locked due to too many failed attempts. Try again later.", 423)

    user = _get_user_by_login(identifier)

    # Generic failure message for EVERY path (no enumeration, no oracle)
    generic_error = error_response("Invalid credentials", 401)

    if not user or not _is_admin_user(user) or not user.get('password_hash'):
        record_login_attempt(ident_key, ip, "failed")
        return generic_error

    if not check_password_hash(user['password_hash'], password):
        record_login_attempt(ident_key, ip, "failed")
        try:
            create_security_alert(
                "admin_password_login_failed",
                f"Failed admin password login for {user['email']} from {ip}.",
                severity="medium",
                ip_address=ip,
            )
        except Exception:
            pass
        return generic_error

    # Success — record and clear failure history by recording success
    record_login_attempt(ident_key, ip, "success")

    token, _payload = _issue_admin_token(user)

    user_data = {
        "id": user['id'],
        "name": user.get('name'),
        "email": user['email'],
        "profile_image": user.get('profile_image'),
        "role": normalize_role(user['role']),
    }

    log_admin_event(user['id'], "admin_login_password", "auth", user['id'],
                    "Admin logged in via password")
    _log_security_event(user['id'], user['email'], "login_password", "Password login success", ip)

    resp = jsonify({"success": True, "user": user_data})
    cookie_settings = get_cookie_settings()
    resp.set_cookie('token', token, **cookie_settings)
    return resp


# ---------------------------------------------------------------------------
# 2. SECURITY QUESTION — status, setup, challenge
# ---------------------------------------------------------------------------
@admin_auth_bp.route('/api/admin/security/status', methods=['GET'])
def admin_security_status():
    """Returns whether the logged-in admin has a password + security question set.

    Requires a valid admin JWT (token_required is enforced by the caller
    blueprint registration — implemented here via the shared decode helper).
    """
    from app import token_required

    @token_required
    def _inner():
        # Defense-in-depth: require an admin role (token_required accepts any
        # valid user JWT). request.user['role'] is role-normalized upstream.
        if normalize_role((request.user or {}).get('role')) not in ADMIN_LOGIN_ROLES:
            return error_response("Admin access required", 403)

        user = request.user
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT email, name, admin_phone, password_hash, security_question, security_answer_hash "
                "FROM users WHERE id = ?", (user.get('user_id'),)
            ).fetchone()
            if not row:
                return error_response("User not found", 404)
            row = dict(row)
            return success_response({
                "email": row['email'],
                "name": row.get('name'),
                "admin_phone": row.get('admin_phone'),
                "has_password": bool(row.get('password_hash')),
                "security_question": row.get('security_question'),
                "has_security_question": bool(row.get('security_answer_hash')),
                "questions": SECURITY_QUESTIONS,
            }, "Security status retrieved")
        finally:
            conn.close()

    return _inner()


@admin_auth_bp.route('/api/admin/security/setup', methods=['POST'])
def admin_security_setup():
    """Set/replace the security question + answer (authenticated admin only).

    If a security question already exists, the CURRENT answer must be provided
    (answer_security_question flow) — this endpoint alone never lets a session
    hijacker overwrite the existing question without answering it.
    """
    from app import token_required

    @token_required
    def _inner():
        # Defense-in-depth: token_required accepts ANY valid user JWT; these
        # are admin-panel endpoints, so require an admin role explicitly.
        if normalize_role((request.user or {}).get('role')) not in ADMIN_LOGIN_ROLES:
            return error_response("Admin access required", 403)

        data = request.get_json(silent=True) or {}
        question = (data.get('security_question') or '').strip()
        answer = (data.get('security_answer') or '').strip()
        current_answer = (data.get('current_answer') or '').strip()

        if not question or not answer:
            return error_response("Security question and answer are required", 400)
        if question not in SECURITY_QUESTIONS:
            return error_response("Please choose one of the provided security questions", 400)
        if len(answer) < 2:
            return error_response("Security answer is too short", 400)

        conn = get_db()
        try:
            row = conn.execute(
                "SELECT id, email, security_answer_hash FROM users WHERE id = ?",
                (request.user.get('user_id'),),
            ).fetchone()
            if not row:
                return error_response("User not found", 404)
            row = dict(row)

            # Re-authorization: existing question must be answered first
            if row.get('security_answer_hash'):
                if not current_answer or not check_password_hash(row['security_answer_hash'], current_answer):
                    record_login_attempt(row['email'], _client_ip(), "failed")
                    return error_response("Current security answer is incorrect", 401)

            answer_hash = generate_password_hash(answer.lower())
            conn.execute(
                "UPDATE users SET security_question = ?, security_answer_hash = ? WHERE id = ?",
                (question, answer_hash, row['id']),
            )
            conn.commit()

            log_admin_event(row['id'], "admin_security_question_update", "auth", row['id'],
                            "Security question updated")
            _log_security_event(row['id'], row['email'], "security_question_update",
                                "Security question set/updated", _client_ip())
            return success_response(None, "Security question updated successfully")
        finally:
            conn.close()

    return _inner()


@admin_auth_bp.route('/api/admin/security/status-lookup', methods=['POST'])
def admin_security_status_lookup():
    """Forgot-password step 1: return the security question for an identifier.

    Enumeration-safe: for unknown / non-admin / no-question accounts we return
    a RANDOM question from the list with success=true — identical shape to the
    real response. The subsequent reset attempt fails generically (and feeds
    the lockout), so an attacker can never learn which identifiers are admins.
    """
    data = request.get_json(silent=True) or {}
    identifier = (data.get('identifier') or '').strip()
    if not identifier:
        return error_response("Email or mobile is required", 400)

    ident_key = identifier.lower()
    if is_account_locked(ident_key):
        return error_response("Account temporarily locked. Try again later.", 423)

    user = _get_user_by_login(identifier)
    if user and _is_admin_user(user) and user.get('security_question'):
        return success_response({"security_question": user['security_question']})

    # Decoy question for unknown accounts (same response shape — no oracle)
    import random
    return success_response({"security_question": random.choice(SECURITY_QUESTIONS)})


@admin_auth_bp.route('/api/admin/security/verify', methods=['POST'])
def admin_security_verify():
    """Verify the security answer; issues a short-lived signed challenge token.

    The challenge token (10 min, single purpose claim) must accompany any
    sensitive change (profile email/phone update or password change) when the
    admin has no valid session — and is ALSO required from authenticated
    sessions so a hijacked cookie cannot silently change credentials.
    """
    data = request.get_json(silent=True) or {}
    identifier = (data.get('identifier') or '').strip()
    answer = (data.get('security_answer') or '').strip()

    if not identifier or not answer:
        return error_response("Email/mobile and security answer are required", 400)

    ident_key = identifier.lower()
    if is_account_locked(ident_key):
        return error_response("Account temporarily locked. Try again later.", 423)

    user = _get_user_by_login(identifier)
    generic_error = error_response("Verification failed", 401)

    if not user or not _is_admin_user(user) or not user.get('security_answer_hash'):
        record_login_attempt(ident_key, _client_ip(), "failed")
        return generic_error

    if not check_password_hash(user['security_answer_hash'], answer.lower()):
        record_login_attempt(ident_key, _client_ip(), "failed")
        return generic_error

    record_login_attempt(ident_key, _client_ip(), "success")

    from jwt_config import get_jwt_secret
    now_utc = datetime.datetime.utcnow()
    challenge = pyjwt.encode({
        'purpose': 'admin_security_challenge',
        'user_id': user['id'],
        'iat': now_utc,
        'jti': secrets.token_hex(16),
        'exp': now_utc + datetime.timedelta(minutes=10),
    }, get_jwt_secret(), algorithm="HS256")

    _log_security_event(user['id'], user['email'], "security_challenge_passed",
                        "Security answer verified (challenge token issued)", _client_ip())

    return success_response({
        "challenge_token": challenge,
        "security_question": user.get('security_question'),
    }, "Security verification successful")


# ---------------------------------------------------------------------------
# 3. PASSWORD CHANGE (session or challenge-token authorized)
# ---------------------------------------------------------------------------
@admin_auth_bp.route('/api/admin/security/change-password', methods=['POST'])
def admin_change_password():
    """Change the admin password.

    Two authorization paths:
      a) Valid admin session (JWT) + current password + security answer, OR
      b) Valid challenge token (from /security/verify) + security answer.
    The security answer is ALWAYS required — it is the recovery/anti-hijack key.
    """
    from app import get_cookie_settings

    data = request.get_json(silent=True) or {}
    current_password = (data.get('current_password') or '').strip()
    new_password = (data.get('new_password') or '').strip()
    security_answer = (data.get('security_answer') or '').strip()
    challenge_token = (data.get('challenge_token') or '').strip()

    if not new_password:
        return error_response("New password is required", 400)
    if len(new_password) < PASSWORD_MIN_LENGTH:
        return error_response(f"Password must be at least {PASSWORD_MIN_LENGTH} characters", 400)
    if not re.search(r'[A-Za-z]', new_password) or not re.search(r'\d', new_password):
        return error_response("Password must contain both letters and numbers", 400)
    if not security_answer:
        return error_response("Security answer is required to change the password", 400)

    from jwt_config import get_jwt_secret

    # Resolve the acting admin either from the session JWT or the challenge token
    user_row = None
    via_session = False
    claims, _err = None, None
    try:
        from app import _decode_candidate_tokens
        claims, _err = _decode_candidate_tokens()
    except Exception:
        claims = None

    if claims and claims.get('user_id') and (claims.get('purpose') != 'admin_security_challenge'):
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (claims.get('user_id'),)).fetchone()
            user_row = dict(row) if row else None
            via_session = bool(user_row and _is_admin_user(user_row))
        finally:
            conn.close()

    if not via_session:
        # Fall back to the single-purpose challenge token
        if not challenge_token:
            return error_response("Authentication required. Please verify your security answer first.", 401)
        try:
            decoded = pyjwt.decode(challenge_token, get_jwt_secret(), algorithms=["HS256"])
            if decoded.get('purpose') != 'admin_security_challenge':
                raise pyjwt.InvalidTokenError()
        except Exception:
            return error_response("Verification expired. Please verify your security answer again.", 401)
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (decoded.get('user_id'),)).fetchone()
            user_row = dict(row) if row else None
        finally:
            conn.close()

    if not user_row or not _is_admin_user(user_row):
        return error_response("Invalid credentials", 401)

    ident_key = user_row['email'].lower()
    if is_account_locked(ident_key):
        return error_response("Account temporarily locked. Try again later.", 423)

    # The security answer is mandatory in BOTH paths
    if not user_row.get('security_answer_hash') or not check_password_hash(user_row['security_answer_hash'], security_answer.lower()):
        record_login_attempt(ident_key, _client_ip(), "failed")
        return error_response("Security answer is incorrect", 401)

    # If acting via a live session, the CURRENT password must also match
    if via_session:
        if not current_password or not user_row.get('password_hash') or not check_password_hash(user_row['password_hash'], current_password):
            record_login_attempt(ident_key, _client_ip(), "failed")
            return error_response("Current password is incorrect", 401)

    new_hash = generate_password_hash(new_password)
    conn = get_db()
    try:
        conn.execute(
            "UPDATE users SET password_hash = ?, password_set_at = datetime('now'), "
            "min_token_iat = ? WHERE id = ?",
            (new_hash, int(datetime.datetime.utcnow().timestamp()), user_row['id']),
        )
        conn.commit()
    finally:
        conn.close()

    log_admin_event(user_row['id'], "admin_password_change", "auth", user_row['id'],
                    "Admin password changed")
    _log_security_event(user_row['id'], user_row['email'], "password_change",
                        "Password changed" + (" (via session)" if via_session else " (via challenge)"), _client_ip())
    try:
        from notifier import send_individual_email
        subject = "Your JDLX Admin password was changed"
        message = ("The password for your JDLX Admin Panel account was just changed. "
                   "If this was not you, contact support immediately.")
        from threading import Thread
        Thread(target=send_individual_email, args=(user_row['email'], user_row.get('name') or 'Admin', subject, message)).start()
    except Exception:
        pass

    resp = success_response(None, "Password changed successfully")
    return resp


# ---------------------------------------------------------------------------
# 4. PROFILE UPDATE — email / mobile (security-answer authorized)
# ---------------------------------------------------------------------------
@admin_auth_bp.route('/api/admin/security/update-profile', methods=['POST'])
def admin_update_profile():
    """Update the admin's login email and/or mobile number.

    Authorization: valid session (JWT) + security answer. The security answer
    is always required so a stolen session cannot lock the real admin out.
    Changing email also re-issues the session token with the new email claim.
    """
    from app import token_required, get_cookie_settings

    @token_required
    def _inner():
        # Defense-in-depth: token_required accepts ANY valid user JWT; these
        # are admin-panel endpoints, so require an admin role explicitly.
        if normalize_role((request.user or {}).get('role')) not in ADMIN_LOGIN_ROLES:
            return error_response("Admin access required", 403)

        data = request.get_json(silent=True) or {}
        new_email = (data.get('email') or '').strip().lower()
        new_phone = (data.get('admin_phone') or '').strip()
        security_answer = (data.get('security_answer') or '').strip()

        if not security_answer:
            return error_response("Security answer is required to update login details", 400)

        email_changed = bool(new_email)
        phone_changed = bool(new_phone)
        if not email_changed and not phone_changed:
            return error_response("Nothing to update", 400)

        email_regex = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
        phone_regex = re.compile(r'^\+?[0-9]{10,15}$')

        conn = get_db()
        try:
            row = conn.execute(
                "SELECT id, email, admin_phone, security_answer_hash, password_hash FROM users WHERE id = ?",
                (request.user.get('user_id'),),
            ).fetchone()
            if not row:
                return error_response("User not found", 404)
            row = dict(row)

            if not row.get('security_answer_hash') or not check_password_hash(row['security_answer_hash'], security_answer.lower()):
                record_login_attempt(row['email'], _client_ip(), "failed")
                return error_response("Security answer is incorrect", 401)

            updates, params = [], []

            if email_changed:
                if not email_regex.match(new_email):
                    return error_response("Please provide a valid email address", 400)
                existing = conn.execute(
                    "SELECT id FROM users WHERE LOWER(email) = ? AND id != ?",
                    (new_email, row['id']),
                ).fetchone()
                if existing:
                    return error_response("This email is already registered to another account", 409)
                updates.append("email = ?")
                params.append(new_email)

            if phone_changed:
                if not phone_regex.match(new_phone):
                    return error_response("Please provide a valid mobile number (10-15 digits)", 400)
                existing = conn.execute(
                    "SELECT id FROM users WHERE LOWER(COALESCE(admin_phone, '')) = ? AND id != ?",
                    (new_phone.lower(), row['id']),
                ).fetchone()
                if existing:
                    return error_response("This mobile number is already registered to another account", 409)
                updates.append("admin_phone = ?")
                params.append(new_phone)

            if not updates:
                return error_response("Nothing to update", 400)

            params.append(row['id'])
            conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
            conn.commit()

            # Re-fetch and re-issue the session token (email claim changed)
            fresh = conn.execute("SELECT * FROM users WHERE id = ?", (row['id'],)).fetchone()
            fresh = dict(fresh)
            token, _payload = _issue_admin_token(fresh)

            log_admin_event(row['id'], "admin_profile_update", "auth", row['id'],
                            f"Login details updated (email={email_changed}, phone={phone_changed})")
            _log_security_event(row['id'], fresh['email'], "profile_update",
                                f"Email changed: {email_changed}, Phone changed: {phone_changed}", _client_ip())
            try:
                from notifier import send_individual_email
                from threading import Thread
                subject = "Your JDLX Admin login details were updated"
                message = ("The login email/mobile for your JDLX Admin Panel account was just updated. "
                           "If this was not you, contact support immediately.")
                Thread(target=send_individual_email, args=(fresh['email'], fresh.get('name') or 'Admin', subject, message)).start()
            except Exception:
                pass

            user_data = {
                "id": fresh['id'],
                "name": fresh.get('name'),
                "email": fresh['email'],
                "admin_phone": fresh.get('admin_phone'),
                "profile_image": fresh.get('profile_image'),
                "role": normalize_role(fresh['role']),
            }
            # NOTE: success_response() returns a (jsonify, code) tuple — we need a
            # real Response object here to attach the refreshed session cookie.
            resp = jsonify({
                "success": True,
                "data": {"user": user_data},
                "message": "Login details updated successfully"
            })
            cookie_settings = get_cookie_settings()
            resp.set_cookie('token', token, **cookie_settings)
            return resp
        finally:
            conn.close()

    return _inner()


# ---------------------------------------------------------------------------
# 5. FORGOT PASSWORD — security answer -> set new password (no session)
# ---------------------------------------------------------------------------
@admin_auth_bp.route('/api/admin/security/reset-password', methods=['POST'])
def admin_reset_password():
    """Self-service password reset using ONLY the security answer.

    Intended for the login page ("Forgot password" → answer question → reset).
    Requires: identifier (email/mobile) + security answer + new password.
    Same protections as change-password: lockout, generic errors, audit trail.
    """
    data = request.get_json(silent=True) or {}
    identifier = (data.get('identifier') or '').strip()
    security_answer = (data.get('security_answer') or '').strip()
    new_password = (data.get('new_password') or '').strip()

    if not identifier or not security_answer or not new_password:
        return error_response("All fields are required", 400)
    if len(new_password) < PASSWORD_MIN_LENGTH:
        return error_response(f"Password must be at least {PASSWORD_MIN_LENGTH} characters", 400)
    if not re.search(r'[A-Za-z]', new_password) or not re.search(r'\d', new_password):
        return error_response("Password must contain both letters and numbers", 400)

    ident_key = identifier.lower()
    if is_account_locked(ident_key):
        return error_response("Account temporarily locked. Try again later.", 423)

    user = _get_user_by_login(identifier)
    generic_error = error_response("Verification failed", 401)

    if not user or not _is_admin_user(user) or not user.get('security_answer_hash'):
        record_login_attempt(ident_key, _client_ip(), "failed")
        return generic_error

    if not check_password_hash(user['security_answer_hash'], security_answer.lower()):
        record_login_attempt(ident_key, _client_ip(), "failed")
        try:
            create_security_alert(
                "admin_reset_password_failed",
                f"Failed password reset (bad security answer) for {user['email']} from {_client_ip()}.",
                severity="high",
                ip_address=_client_ip(),
            )
        except Exception:
            pass
        return generic_error

    record_login_attempt(ident_key, _client_ip(), "success")

    conn = get_db()
    try:
        conn.execute(
            "UPDATE users SET password_hash = ?, password_set_at = datetime('now'), "
            "min_token_iat = ? WHERE id = ?",
            (generate_password_hash(new_password), int(datetime.datetime.utcnow().timestamp()), user['id']),
        )
        conn.commit()
    finally:
        conn.close()

    log_admin_event(user['id'], "admin_password_reset", "auth", user['id'],
                    "Admin password reset via security question")
    _log_security_event(user['id'], user['email'], "password_reset",
                        "Password reset via security answer", _client_ip())
    try:
        from notifier import send_individual_email
        from threading import Thread
        subject = "Your JDLX Admin password was reset"
        message = ("The password for your JDLX Admin Panel account was just reset using your "
                   "security answer. If this was not you, contact support immediately.")
        Thread(target=send_individual_email, args=(user['email'], user.get('name') or 'Admin', subject, message)).start()
    except Exception:
        pass

    return success_response(None, "Password reset successfully. You can now log in.")
