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
    auth_header = request.headers.get("Authorization", "")
    if not auth_header:
        return None, ("Token is missing!", 401)

    parts = auth_header.split(" ", 1)
    if len(parts) != 2:
        return None, ("Token is invalid!", 401)

    token = parts[1].strip()
    secret = get_jwt_secret()
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except Exception:
        return None, ("Token is invalid!", 401)
    return payload, None


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
        return claims, None

    payload, error = _decode_bearer_token()
    if error:
        return None, error

    payload["role"] = normalize_role(payload.get("role"))
    if _is_admin_disabled(payload.get("user_id"), payload.get("role")):
        return None, ("Account disabled by administrator", 403)
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

