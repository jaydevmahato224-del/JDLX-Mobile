from functools import wraps
import os

import jwt
from flask import jsonify, request


ALLOWED_ROLES = {"user", "admin", "super_admin"}
SECRET_KEY = os.environ.get("JWT_SECRET", "jdlx_secret_keys_123")


def normalize_role(role):
    if not role:
        return "user"
    value = str(role).strip().lower()
    if value == "superadmin":
        return "super_admin"
    if value == "administrator":
        return "admin"
    if value == "admin":
        return "admin"
    if value == "super_admin":
        return "super_admin"
    return "user"


def _decode_bearer_token():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header:
        return None, ("Token is missing!", 401)

    parts = auth_header.split(" ", 1)
    if len(parts) != 2:
        return None, ("Token is invalid!", 401)

    token = parts[1].strip()
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except Exception:
        return None, ("Token is invalid!", 401)
    return payload, None


def _current_user_claims():
    claims = getattr(request, "user", None)
    if claims:
        claims["role"] = normalize_role(claims.get("role"))
        return claims, None

    payload, error = _decode_bearer_token()
    if error:
        return None, error

    payload["role"] = normalize_role(payload.get("role"))
    request.user = payload
    return payload, None


def require_admin(allowed_roles=None):
    if allowed_roles is None:
        allowed_roles = ["admin", "super_admin"]
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
