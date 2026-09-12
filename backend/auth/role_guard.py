from functools import wraps

import jwt
from flask import current_app, jsonify, request

from jwt_config import get_jwt_secret as _get_env_jwt_secret


ALLOWED_ROLES = {"user", "admin", "super_admin"}

# Full set of roles the admin panel may use. Sub-roles (manager, inventory_admin,
# delivery_admin, support_admin) are persisted in the users/admins tables and are
# accepted by the admin OAuth login, so the JWT claims must preserve them instead of
# collapsing them to "user" (which would silently 403 every admin API call).
ADMIN_ROLES = {"admin", "super_admin", "manager", "inventory_admin", "delivery_admin", "support_admin"}


def get_jwt_secret():
    """Returns the JWT secret: app config first, then the central fail-closed env loader."""
    try:
        if current_app and current_app.config.get("JWT_SECRET"):
            return current_app.config["JWT_SECRET"]
    except Exception:
        pass

    return _get_env_jwt_secret()


def normalize_role(role):
    if not role:
        return "user"
    value = str(role).strip().lower()
    if value in ("superadmin", "super_admin"):
        return "super_admin"
    if value in ("administrator", "admin"):
        return "admin"
    # Preserve admin sub-roles so their JWT claims survive decoding and the
    # per-route role whitelists (frontend + backend) can enforce them.
    if value in ("manager", "inventory_admin", "delivery_admin", "support_admin"):
        return value
    return "user"


def _decode_bearer_token():
    """Resolve the caller's JWT from the Authorization header or the cookie.

    Header-first matches app.token_required: admin/API/mobile clients always
    send a Bearer token and a stray storefront cookie must never shadow it. The
    HttpOnly `token` cookie is the fallback, so cookie-only storefront sessions
    are accepted too. Blueprint routes used to read ONLY the header, which is
    why a cookie-only session got a hard 401 on every `request.user`-based
    endpoint (bug reports, complaints, refunds, offers, support, …).
    """
    header_token = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header:
        parts = auth_header.split(" ", 1)
        if len(parts) == 2 and parts[1].strip():
            header_token = parts[1].strip()
    cookie_token = request.cookies.get("token")

    candidates = [t for t in (header_token, cookie_token) if t]
    if not candidates:
        return None, ("Token is missing!", 401)
    secret = get_jwt_secret()
    for token in candidates:
        try:
            return jwt.decode(token, secret, algorithms=["HS256"]), None
        except Exception:
            continue
    return None, ("Token is invalid!", 401)


def _is_admin_disabled(user_id, role):
    """Returns True when an admin-panel account was disabled by a super admin.

    Checked on every admin-guarded request so disabling an account takes effect
    immediately (existing JWTs are revoked at the enforcement point), not only at
    the next login.
    """
    if role not in ADMIN_ROLES:
        return False
    try:
        from database import get_db
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT status FROM admins WHERE user_id = ?", (user_id,)
            ).fetchone()
            return bool(row) and str(row["status"]).strip().lower() == "disabled"
        finally:
            conn.close()
    except Exception:
        # Never fail closed on a DB hiccup (would lock out every admin); the
        # login-time check still guards new sessions.
        return False


def _current_user_claims():
    claims = getattr(request, "user", None)
    if claims:
        claims["role"] = normalize_role(claims.get("role"))
        if _is_admin_disabled(claims.get("user_id"), claims.get("role")):
            return None, ("Account disabled by administrator", 403)
        # Role ko token se nahi, DB se uthao (role demotion turant effect):
        user_id = claims.get("user_id")
        if user_id:
            try:
                from database import get_db
                conn = get_db()
                try:
                    row = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
                    if row and normalize_role(row["role"]) != claims["role"]:
                        # Role change ho gaya hai — naya token issue karo, purana reject
                        return None, ("Session expired. Please login again.", 401)
                finally:
                    conn.close()
            except Exception:
                # Fail-closed for admin endpoints, fail-open for others
                if claims.get("role") in ADMIN_ROLES:
                    return None, ("Session validation failed. Please login again.", 401)
        return claims, None

    payload, error = _decode_bearer_token()
    if error:
        return None, error

    payload["role"] = normalize_role(payload.get("role"))
    if _is_admin_disabled(payload.get("user_id"), payload.get("role")):
        return None, ("Account disabled by administrator", 403)
    # Role ko token se nahi, DB se uthao (role demotion turant effect):
    user_id = payload.get("user_id")
    if user_id:
        try:
            from database import get_db
            conn = get_db()
            try:
                row = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
                if row and normalize_role(row["role"]) != payload["role"]:
                    # Role change ho gaya hai — naya token issue karo, purana reject
                    return None, ("Session expired. Please login again.", 401)
            finally:
                conn.close()
        except Exception:
            # Fail-closed for admin endpoints, fail-open for others
            if payload.get("role") in ADMIN_ROLES:
                return None, ("Session validation failed. Please login again.", 401)
    request.user = payload
    return payload, None


def require_admin(allowed_roles=None):
    if allowed_roles is None:
        allowed_roles = list(ADMIN_ROLES)
    if isinstance(allowed_roles, str):
        allowed_roles = [allowed_roles]
        
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            user_claims, error = _current_user_claims()
            if error:
                message, code = error
                return jsonify({"message": message}), code

            role = user_claims.get("role", "user")
            if role not in allowed_roles:
                return jsonify({"error": f"Unauthorized. Required roles: {allowed_roles}"}), 403
            return f(*args, **kwargs)

        return wrapped

    return decorator


def require_super_admin():
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            user_claims, error = _current_user_claims()
            if error:
                message, code = error
                return jsonify({"message": message}), code

            if user_claims.get("role") != "super_admin":
                return jsonify({"error": "Unauthorized"}), 403
            return f(*args, **kwargs)

        return wrapped

    return decorator

