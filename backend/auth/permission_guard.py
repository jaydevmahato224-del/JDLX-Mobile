from functools import wraps
import os
import sqlite3

from flask import jsonify, request

from auth.role_guard import _current_user_claims


DATABASE_PATH = os.environ.get("DATABASE_PATH", "jdlx.db")


def _has_permission(user_id, permission_name):
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        '''
        SELECT 1
        FROM admin_permissions
        WHERE admin_id = ? AND permission = ?
        LIMIT 1
        ''',
        (user_id, permission_name),
    )
    row = cursor.fetchone()
    conn.close()
    return row is not None


def require_permission(permission_name):
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            user_claims, error = _current_user_claims()
            if error:
                message, code = error
                return jsonify({"message": message}), code

            role = user_claims.get("role", "user")
            if role == "super_admin":
                return f(*args, **kwargs)
            if role != "admin":
                return jsonify({"error": "Unauthorized"}), 403

            user_id = user_claims.get("user_id")
            if not user_id or not _has_permission(str(user_id), permission_name):
                return jsonify({"error": f"Missing permission: {permission_name}"}), 403
            return f(*args, **kwargs)

        return wrapped

    return decorator
