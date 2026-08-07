from functools import wraps

import jwt
from flask import jsonify, request

from jwt_config import get_jwt_secret


SECRET_KEY = get_jwt_secret()
WAREHOUSE_ROLES = {
    "owner",
    "warehouse_manager",
    "packing_staff",
    "inventory_staff",
    "dispatch_staff",
}


def normalize_warehouse_role(role):
    value = str(role or "").strip().lower().replace(" ", "_")
    aliases = {
        "warehouse_owner": "owner",
        "warehousemanager": "warehouse_manager",
        "manager": "warehouse_manager",
        "packingstaff": "packing_staff",
        "inventorystaff": "inventory_staff",
        "dispatchstaff": "dispatch_staff",
    }
    return aliases.get(value, value if value in WAREHOUSE_ROLES else "packing_staff")


def warehouse_token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header:
            return jsonify({"message": "Warehouse token is missing"}), 401

        parts = auth_header.split(" ", 1)
        if len(parts) != 2:
            return jsonify({"message": "Warehouse token is invalid"}), 401

        try:
            claims = jwt.decode(parts[1].strip(), SECRET_KEY, algorithms=["HS256"])
        except Exception:
            return jsonify({"message": "Warehouse token is invalid"}), 401

        if claims.get("scope") != "warehouse":
            return jsonify({"message": "Unauthorized scope"}), 403

        claims["warehouse_role"] = normalize_warehouse_role(claims.get("warehouse_role"))
        request.warehouse_user = claims
        return f(*args, **kwargs)

    return decorated


def require_warehouse_roles(allowed_roles=None):
    allowed = {normalize_warehouse_role(role) for role in (allowed_roles or WAREHOUSE_ROLES)}

    def decorator(f):
        @warehouse_token_required
        @wraps(f)
        def wrapped(*args, **kwargs):
            role = request.warehouse_user.get("warehouse_role", "packing_staff")
            if role not in allowed:
                return jsonify({"error": "Unauthorized warehouse role"}), 403
            return f(*args, **kwargs)

        return wrapped

    return decorator

