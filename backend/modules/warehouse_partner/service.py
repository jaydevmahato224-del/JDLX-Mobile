import csv
import datetime
import io
import json
import math
import os
import re
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from urllib.parse import quote

import jwt

from database import get_db_connection
from jwt_config import get_jwt_secret
from .auth import normalize_warehouse_role


SECRET_KEY = get_jwt_secret()
GMAIL_USER = os.environ.get("GMAIL_USER")
GMAIL_PASS = os.environ.get("GMAIL_PASS")
UPLOAD_DIR = os.path.join("backend", "static", "uploads", "warehouse_partner")
STATUS_TO_ORDER_STATUS = {
    "accepted": "confirmed",
    "packing": "confirmed",
    "packed": "packed",
    "ready_for_pickup": "packed",
    "courier_pickup_requested": "packed",
    "dispatched": "out_for_delivery",
    "cancelled": "cancelled",
}
STATUS_TIMESTAMP_COLUMN = {
    "confirmed": "confirmed_at",
    "packed": "packed_at",
    "out_for_delivery": "out_for_delivery_at",
    "cancelled": "cancelled_at",
    "delivered": "delivered_at",
}
WAREHOUSE_STATUS_TITLES = {
    "assigned": "New order assigned",
    "accepted": "Order accepted",
    "packing": "Packing started",
    "packed": "Order packed",
    "ready_for_pickup": "Ready for pickup",
    "courier_pickup_requested": "Courier pickup requested",
    "dispatched": "Order dispatched",
    "cancelled": "Order cancelled",
}
VALID_WAREHOUSE_STATUSES = set(WAREHOUSE_STATUS_TITLES)
VALID_OPERATION_STATUSES = {"open", "closed"}
VALID_WEATHER_STATUSES = {"clear", "bad_weather"}


def _extract_pincode(text):
    match = re.search(r"\b\d{6}\b", text or "")
    return match.group(0) if match else None


def _haversine(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    return 6371 * c


def _table_has_column(cursor, table_name, column_name):
    cursor.execute(f"PRAGMA table_info({table_name})")
    return column_name in [row[1] for row in cursor.fetchall()]


def get_product_snapshot(cursor, product_id):
    has_sku = _table_has_column(cursor, "products", "sku")
    query = "SELECT id, name, price"
    if has_sku:
        query += ", sku"
    query += " FROM products WHERE id = ?"
    cursor.execute(query, (product_id,))
    product = cursor.fetchone()
    if not product:
        return None
    result = dict(product)
    result.setdefault("sku", f"SKU-{str(product_id).zfill(4)}")
    return result


def _send_email(recipient, subject, body_html):
    if not recipient:
        return False

    msg = MIMEMultipart()
    msg["From"] = GMAIL_USER
    msg["To"] = recipient
    msg["Subject"] = subject
    msg.attach(MIMEText(body_html, "html"))

    try:
        server = smtplib.SMTP("smtp.gmail.com", 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASS)
        server.sendmail(GMAIL_USER, recipient, msg.as_string())
        server.quit()
        return True
    except Exception:
        return False


def _notification_recipients(cursor, warehouse_partner_id):
    recipients = {}

    cursor.execute(
        '''
        SELECT owner_user_id, email
        FROM warehouse_partners
        WHERE id = ?
        ''',
        (warehouse_partner_id,),
    )
    partner = cursor.fetchone()
    if partner:
        if partner["owner_user_id"]:
            recipients[("user", partner["owner_user_id"])] = {
                "user_id": partner["owner_user_id"],
                "email": partner["email"],
            }
        elif partner["email"]:
            recipients[("email", partner["email"].lower())] = {
                "user_id": None,
                "email": partner["email"],
            }

    cursor.execute(
        '''
        SELECT user_id, email
        FROM warehouse_staff
        WHERE warehouse_partner_id = ? AND status = 'active'
        ''',
        (warehouse_partner_id,),
    )
    for row in cursor.fetchall():
        email = (row["email"] or "").strip().lower()
        if row["user_id"]:
            recipients[("user", row["user_id"])] = {"user_id": row["user_id"], "email": row["email"]}
        elif email:
            recipients[("email", email)] = {"user_id": None, "email": row["email"]}

    return list(recipients.values())


def notify_warehouse(cursor, warehouse_partner_id, title, message, metadata=None, send_email=False):
    recipients = _notification_recipients(cursor, warehouse_partner_id)
    metadata_json = json.dumps(metadata or {}, separators=(",", ":")) if metadata else None

    for recipient in recipients:
        if recipient["user_id"]:
            cursor.execute(
                '''
                INSERT INTO notifications (user_id, title, message, type, metadata)
                VALUES (?, ?, ?, 'WAREHOUSE', ?)
                ''',
                (recipient["user_id"], title, message, metadata_json),
            )
        if send_email and recipient["email"]:
            _send_email(recipient["email"], f"JDLX Warehouse: {title}", f"<p>{message}</p>")


def ensure_owner_staff_link(cursor, warehouse_partner_id, user_id, fallback_name, fallback_email, fallback_phone):
    cursor.execute(
        '''
        INSERT INTO warehouse_staff (warehouse_partner_id, user_id, name, email, phone, role, status, invited_by)
        VALUES (?, ?, ?, ?, ?, 'owner', 'active', ?)
        ON CONFLICT(warehouse_partner_id, email) DO UPDATE SET
            user_id = excluded.user_id,
            name = excluded.name,
            phone = COALESCE(excluded.phone, warehouse_staff.phone),
            role = 'owner',
            status = 'active',
            updated_at = CURRENT_TIMESTAMP
        ''',
        (warehouse_partner_id, user_id, fallback_name, fallback_email, fallback_phone, user_id),
    )


def resolve_warehouse_membership(cursor, user_id, email):
    lowered_email = (email or "").strip().lower()

    cursor.execute(
        '''
        SELECT id, warehouse_name, owner_name, email, phone, owner_user_id
        FROM warehouse_partners
        WHERE verification_status = 'approved'
          AND active = 1
          AND (owner_user_id = ? OR LOWER(email) = ?)
        ORDER BY id ASC
        LIMIT 1
        ''',
        (user_id, lowered_email),
    )
    partner = cursor.fetchone()
    if partner:
        partner_dict = dict(partner)
        if not partner_dict.get("owner_user_id"):
            cursor.execute(
                "UPDATE warehouse_partners SET owner_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (user_id, partner_dict["id"]),
            )
        ensure_owner_staff_link(
            cursor,
            partner_dict["id"],
            user_id,
            partner_dict.get("owner_name") or "Warehouse Owner",
            partner_dict.get("email"),
            partner_dict.get("phone"),
        )
        partner_dict["warehouse_role"] = "owner"
        return partner_dict

    cursor.execute(
        '''
        SELECT wp.id, wp.warehouse_name, ws.name, ws.email, ws.phone, ws.role
        FROM warehouse_staff ws
        JOIN warehouse_partners wp ON wp.id = ws.warehouse_partner_id
        WHERE wp.verification_status = 'approved'
          AND wp.active = 1
          AND ws.status = 'active'
          AND (ws.user_id = ? OR LOWER(ws.email) = ?)
        ORDER BY wp.id ASC
        LIMIT 1
        ''',
        (user_id, lowered_email),
    )
    staff = cursor.fetchone()
    if staff:
        staff_dict = dict(staff)
        cursor.execute(
            '''
            UPDATE warehouse_staff
            SET user_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE warehouse_partner_id = ? AND LOWER(email) = ?
            ''',
            (user_id, staff_dict["id"], lowered_email),
        )
        staff_dict["warehouse_role"] = normalize_warehouse_role(staff_dict.get("role"))
        return staff_dict

    return None


def build_warehouse_oauth_redirect(user_data, frontend_base_url):
    conn = get_db_connection()
    cursor = conn.cursor()
    membership = resolve_warehouse_membership(cursor, user_data["id"], user_data["email"])
    conn.commit()
    conn.close()

    if not membership:
        return f"{frontend_base_url}/warehouse/login?error=not_authorized"

    warehouse_user = {
        "id": user_data["id"],
        "name": user_data["name"],
        "email": user_data["email"],
        "profile_image": user_data.get("profile_image"),
        "warehouse_partner_id": membership["id"],
        "warehouse_name": membership["warehouse_name"],
        "warehouse_role": normalize_warehouse_role(
            membership.get("warehouse_role") or membership.get("role") or "owner"
        ),
    }
    token = jwt.encode(
        {
            "scope": "warehouse",
            "user_id": warehouse_user["id"],
            "email": warehouse_user["email"],
            "warehouse_partner_id": warehouse_user["warehouse_partner_id"],
            "warehouse_role": warehouse_user["warehouse_role"],
            "exp": datetime.datetime.utcnow() + datetime.timedelta(days=7),
        },
        SECRET_KEY,
        algorithm="HS256",
    )
    encoded_user = quote(json.dumps(warehouse_user, separators=(",", ":")))
    return f"{frontend_base_url}/warehouse/login?oauth_token={token}&oauth_user={encoded_user}"


def current_warehouse_partner(cursor, claims):
    warehouse_partner_id = claims.get("warehouse_partner_id")
    user_id = claims.get("user_id")
    cursor.execute(
        '''
        SELECT wp.*
        FROM warehouse_partners wp
        WHERE wp.id = ?
          AND wp.verification_status = 'approved'
          AND wp.active = 1
        ''',
        (warehouse_partner_id,),
    )
    partner = cursor.fetchone()
    if not partner:
        return None

    if claims.get("warehouse_role") == "owner":
        return dict(partner)

    cursor.execute(
        '''
        SELECT 1
        FROM warehouse_staff
        WHERE warehouse_partner_id = ? AND user_id = ? AND status = 'active'
        ''',
        (warehouse_partner_id, user_id),
    )
    if cursor.fetchone():
        return dict(partner)
    return None


def evaluate_warehouse_serviceability(partner, *, user_lat=None, user_lng=None, user_pincode=None):
    radius_km = float(partner.get("service_radius_km") or 4)
    distance_km = None
    within_service_area = False

    if all(
        value is not None for value in (
            user_lat,
            user_lng,
            partner.get("latitude"),
            partner.get("longitude"),
        )
    ):
        distance_km = round(
            _haversine(
                float(user_lat),
                float(user_lng),
                float(partner["latitude"]),
                float(partner["longitude"]),
            ),
            2,
        )
        within_service_area = distance_km <= radius_km
    elif user_pincode and partner.get("pincode"):
        within_service_area = str(user_pincode).strip() == str(partner.get("pincode")).strip()

    operations_status = (partner.get("operations_status") or "open").strip().lower()
    weather_status = (partner.get("weather_status") or "clear").strip().lower()

    ordering_enabled = (
        partner.get("active")
        and partner.get("verification_status") == "approved"
        and operations_status == "open"
        and weather_status == "clear"
        and within_service_area
    )

    if ordering_enabled:
        message = (
            f"Orders available within {radius_km:g} km radius."
            if distance_km is not None
            else "Store is open for orders."
        )
    elif not within_service_area:
        message = f"This store currently serves only within {radius_km:g} km radius."
    elif operations_status != "open":
        message = "Store is currently closed."
    elif weather_status != "clear":
        message = "Service paused due to bad weather."
    else:
        message = "Store is currently unavailable."

    return {
        "ordering_enabled": ordering_enabled,
        "within_service_area": within_service_area,
        "distance_km": distance_km,
        "service_radius_km": radius_km,
        "operations_status": operations_status,
        "weather_status": weather_status,
        "message": message,
    }


def get_nearest_serviceable_warehouse(cursor, *, user_lat=None, user_lng=None, user_pincode=None):
    cursor.execute(
        '''
        SELECT *
        FROM warehouse_partners
        WHERE verification_status = 'approved' AND active = 1
        ORDER BY warehouse_name ASC
        '''
    )
    partners = [dict(row) for row in cursor.fetchall()]
    if not partners:
        return None

    ranked = []
    for partner in partners:
        evaluation = evaluate_warehouse_serviceability(
            partner,
            user_lat=user_lat,
            user_lng=user_lng,
            user_pincode=user_pincode,
        )
        sort_distance = evaluation["distance_km"] if evaluation["distance_km"] is not None else (0 if evaluation["within_service_area"] else 9999)
        ranked.append((partner, evaluation, sort_distance))

    in_area = [item for item in ranked if item[1]["within_service_area"]]
    open_in_area = [item for item in in_area if item[1]["ordering_enabled"]]

    if open_in_area:
        partner, evaluation, _ = min(open_in_area, key=lambda item: item[2])
    elif in_area:
        partner, evaluation, _ = min(in_area, key=lambda item: item[2])
    else:
        partner, evaluation, _ = min(ranked, key=lambda item: item[2])

    return {"partner": partner, "evaluation": evaluation}


def order_items_for_warehouse(cursor, order_id):
    cursor.execute(
        '''
        SELECT product_id, quantity, COALESCE(product_name, '') AS product_name, price, subtotal
        FROM order_items
        WHERE order_id = ?
        ''',
        (order_id,),
    )
    items = [dict(row) for row in cursor.fetchall()]
    for item in items:
        product = get_product_snapshot(cursor, item["product_id"])
        if product:
            item["product_name"] = product["name"]
            item["sku"] = product["sku"]
        else:
            item["sku"] = f"SKU-{str(item['product_id']).zfill(4)}"
    return items


def _warehouse_stock_available(cursor, warehouse_partner_id, items):
    for item in items:
        cursor.execute(
            '''
            SELECT stock_quantity
            FROM warehouse_inventory
            WHERE warehouse_partner_id = ? AND product_id = ?
            ''',
            (warehouse_partner_id, item["product_id"]),
        )
        inventory_row = cursor.fetchone()
        if not inventory_row:
            return False
        available = inventory_row["stock_quantity"] or 0
        if available < item["quantity"]:
            return False
    return True


def _candidate_score(order, candidate):
    order_pincode = _extract_pincode(order.get("delivery_address"))
    candidate_pincode = candidate.get("pincode")
    exact_pincode_match = 0 if order_pincode and candidate_pincode == order_pincode else 1
    if all(
        candidate.get(key) is not None for key in ("latitude", "longitude")
    ) and all(order.get(key) is not None for key in ("delivery_latitude", "delivery_longitude")):
        distance = _haversine(
            order["delivery_latitude"],
            order["delivery_longitude"],
            candidate["latitude"],
            candidate["longitude"],
        )
    else:
        distance = 9999 if exact_pincode_match else 5000
    return exact_pincode_match, distance, candidate["id"]


def assign_order_to_warehouse_partner(order_id, conn=None):
    owns_connection = conn is None
    connection = conn or get_db_connection()
    cursor = connection.cursor()

    cursor.execute(
        '''
        SELECT id, delivery_address, delivery_latitude, delivery_longitude
        FROM orders
        WHERE id = ?
        ''',
        (order_id,),
    )
    order = cursor.fetchone()
    if not order:
        if owns_connection:
            connection.close()
        return None
    order = dict(order)

    cursor.execute(
        "SELECT id, warehouse_partner_id, assignment_status FROM warehouse_orders WHERE order_id = ?",
        (order_id,),
    )
    existing = cursor.fetchone()
    if existing and existing["assignment_status"] != "cancelled":
        if owns_connection:
            connection.close()
        return dict(existing)

    items = order_items_for_warehouse(cursor, order_id)
    if not items:
        if owns_connection:
            connection.close()
        return None

    cursor.execute(
        '''
        SELECT id, warehouse_name, pincode, latitude, longitude
        FROM warehouse_partners
        WHERE verification_status = 'approved' AND active = 1
        '''
    )
    candidates = [dict(row) for row in cursor.fetchall()]

    ranked = []
    for candidate in candidates:
        if _warehouse_stock_available(cursor, candidate["id"], items):
            ranked.append((candidate, _candidate_score(order, candidate)))

    if not ranked:
        if owns_connection:
            connection.close()
        return None

    ranked.sort(key=lambda item: item[1])
    selected, score = ranked[0]

    cursor.execute(
        '''
        INSERT INTO warehouse_orders (order_id, warehouse_partner_id, assignment_status, assignment_source, assigned_distance_km)
        VALUES (?, ?, 'assigned', 'auto', ?)
        ON CONFLICT(order_id) DO UPDATE SET
            warehouse_partner_id = excluded.warehouse_partner_id,
            assignment_status = 'assigned',
            assignment_source = excluded.assignment_source,
            assigned_distance_km = excluded.assigned_distance_km,
            updated_at = CURRENT_TIMESTAMP
        ''',
        (order_id, selected["id"], score[1] if score[1] < 9999 else None),
    )

    notify_warehouse(
        cursor,
        selected["id"],
        "New order assigned",
        f"Order #{order_id} has been assigned to your warehouse.",
        metadata={"order_id": order_id},
        send_email=True,
    )

    if owns_connection:
        connection.commit()
        connection.close()

    return {"warehouse_partner_id": selected["id"], "order_id": order_id, "assignment_status": "assigned"}


def _release_reserved_inventory(cursor, warehouse_partner_id, order_id):
    for item in order_items_for_warehouse(cursor, order_id):
        cursor.execute(
            '''
            UPDATE warehouse_inventory
            SET reserved_stock = MAX(0, reserved_stock - ?), updated_at = CURRENT_TIMESTAMP
            WHERE warehouse_partner_id = ? AND product_id = ?
            ''',
            (item["quantity"], warehouse_partner_id, item["product_id"]),
        )


def _consume_reserved_inventory(cursor, warehouse_partner_id, order_id):
    for item in order_items_for_warehouse(cursor, order_id):
        cursor.execute(
            '''
            UPDATE warehouse_inventory
            SET reserved_stock = MAX(0, reserved_stock - ?),
                stock_quantity = MAX(0, stock_quantity - ?),
                updated_at = CURRENT_TIMESTAMP
            WHERE warehouse_partner_id = ? AND product_id = ?
            ''',
            (item["quantity"], item["quantity"], warehouse_partner_id, item["product_id"]),
        )


def sync_root_order_status_from_warehouse(cursor, order_id, warehouse_status):
    target_status = STATUS_TO_ORDER_STATUS.get(warehouse_status)
    if not target_status:
        return

    timestamp_column = STATUS_TIMESTAMP_COLUMN.get(target_status)
    if timestamp_column:
        # Whitelist validation for dynamic column name
        allowed_columns = {"confirmed_at", "packed_at", "out_for_delivery_at", "cancelled_at", "delivered_at"}
        if timestamp_column not in allowed_columns:
            raise ValueError(f"Invalid timestamp column: {timestamp_column}")

        cursor.execute(
            f'''
            UPDATE orders
            SET order_status = ?, updated_at = CURRENT_TIMESTAMP,
                {timestamp_column} = COALESCE({timestamp_column}, CURRENT_TIMESTAMP)
            WHERE id = ?
            ''',
            (target_status, order_id),
        )
    else:
        cursor.execute(
            '''
            UPDATE orders
            SET order_status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            ''',
            (target_status, order_id),
        )


def sync_warehouse_order_with_root_status(order_id, root_status, conn=None):
    owns_connection = conn is None
    connection = conn or get_db_connection()
    cursor = connection.cursor()
    cursor.execute(
        '''
        SELECT id, warehouse_partner_id, assignment_status
        FROM warehouse_orders
        WHERE order_id = ?
        ''',
        (order_id,),
    )
    warehouse_order = cursor.fetchone()
    if not warehouse_order:
        if owns_connection:
            connection.close()
        return False

    if root_status == "cancelled":
        if warehouse_order["assignment_status"] != "cancelled":
            _release_reserved_inventory(cursor, warehouse_order["warehouse_partner_id"], order_id)
            cursor.execute(
                '''
                UPDATE warehouse_orders
                SET assignment_status = 'cancelled',
                    cancelled_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE order_id = ?
                ''',
                (order_id,),
            )
            notify_warehouse(
                cursor,
                warehouse_order["warehouse_partner_id"],
                "Order cancelled",
                f"Order #{order_id} was cancelled and warehouse reservations were released.",
                metadata={"order_id": order_id},
            )
    elif root_status == "delivered":
        cursor.execute(
            '''
            UPDATE warehouse_orders
            SET delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP),
                updated_at = CURRENT_TIMESTAMP
            WHERE order_id = ?
            ''',
            (order_id,),
        )

    if owns_connection:
        connection.commit()
        connection.close()
    return True


def _warehouse_status_allowed(current_status, new_status):
    transitions = {
        "assigned": {"accepted", "packing", "cancelled"},
        "accepted": {"packing", "cancelled"},
        "packing": {"packed", "cancelled"},
        "packed": {"ready_for_pickup", "cancelled"},
        "ready_for_pickup": {"courier_pickup_requested", "dispatched", "cancelled"},
        "courier_pickup_requested": {"dispatched", "cancelled"},
        "dispatched": set(),
        "cancelled": set(),
    }
    return new_status in transitions.get(current_status, set())


def update_warehouse_order_status(cursor, warehouse_order_id, warehouse_partner_id, new_status):
    if new_status not in VALID_WAREHOUSE_STATUSES:
        raise ValueError("Invalid warehouse status")

    cursor.execute(
        '''
        SELECT id, order_id, warehouse_partner_id, assignment_status
        FROM warehouse_orders
        WHERE id = ? AND warehouse_partner_id = ?
        ''',
        (warehouse_order_id, warehouse_partner_id),
    )
    warehouse_order = cursor.fetchone()
    if not warehouse_order:
        raise LookupError("Warehouse order not found")

    current_status = warehouse_order["assignment_status"]
    if current_status == new_status:
        return dict(warehouse_order)
    if not _warehouse_status_allowed(current_status, new_status):
        raise ValueError("Unsupported warehouse status transition")

    timestamp_field = {
        "accepted": "accepted_at",
        "packing": "packing_started_at",
        "packed": "packed_at",
        "ready_for_pickup": "ready_for_pickup_at",
        "courier_pickup_requested": "courier_pickup_requested_at",
        "dispatched": "dispatched_at",
        "cancelled": "cancelled_at",
    }.get(new_status)

    if timestamp_field:
        # Whitelist validation for dynamic column name
        allowed_fields = {
            "accepted_at", "packing_started_at", "packed_at", 
            "ready_for_pickup_at", "courier_pickup_requested_at", 
            "dispatched_at", "cancelled_at"
        }
        if timestamp_field not in allowed_fields:
            raise ValueError(f"Invalid timestamp field: {timestamp_field}")

        cursor.execute(
            f'''
            UPDATE warehouse_orders
            SET assignment_status = ?, updated_at = CURRENT_TIMESTAMP,
                {timestamp_field} = COALESCE({timestamp_field}, CURRENT_TIMESTAMP)
            WHERE id = ?
            ''',
            (new_status, warehouse_order_id),
        )
    else:
        cursor.execute(
            '''
            UPDATE warehouse_orders
            SET assignment_status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            ''',
            (new_status, warehouse_order_id),
        )

    if new_status == "cancelled":
        _release_reserved_inventory(cursor, warehouse_partner_id, warehouse_order["order_id"])
    if new_status == "dispatched":
        _consume_reserved_inventory(cursor, warehouse_partner_id, warehouse_order["order_id"])

    sync_root_order_status_from_warehouse(cursor, warehouse_order["order_id"], new_status)
    notify_warehouse(
        cursor,
        warehouse_partner_id,
        WAREHOUSE_STATUS_TITLES[new_status],
        f"Order #{warehouse_order['order_id']} moved to {new_status.replace('_', ' ')}.",
        metadata={"order_id": warehouse_order["order_id"], "status": new_status},
    )

    return {"id": warehouse_order_id, "order_id": warehouse_order["order_id"], "assignment_status": new_status}


def save_uploaded_asset(file_storage, prefix):
    if not file_storage or not getattr(file_storage, "filename", ""):
        return None
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = file_storage.filename
    ext = os.path.splitext(filename)[1] or ".bin"
    safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "_", os.path.splitext(filename)[0]).strip("_") or prefix
    final_name = f"{prefix}_{safe_name}_{int(datetime.datetime.utcnow().timestamp())}{ext}"
    target_path = os.path.join(UPLOAD_DIR, final_name)
    file_storage.save(target_path)
    return f"/static/uploads/warehouse_partner/{final_name}"


def parse_csv_inventory_upload(file_storage):
    content = file_storage.read().decode("utf-8-sig")
    file_storage.stream.seek(0)
    return list(csv.DictReader(io.StringIO(content)))


def ensure_inventory_row(cursor, warehouse_partner_id, product_id, quantity, low_stock_threshold=5, bin_location=None):
    cursor.execute(
        '''
        INSERT INTO warehouse_inventory (warehouse_partner_id, product_id, stock_quantity, low_stock_threshold, bin_location)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(warehouse_partner_id, product_id) DO UPDATE SET
            stock_quantity = warehouse_inventory.stock_quantity + excluded.stock_quantity,
            low_stock_threshold = COALESCE(excluded.low_stock_threshold, warehouse_inventory.low_stock_threshold),
            bin_location = COALESCE(excluded.bin_location, warehouse_inventory.bin_location),
            updated_at = CURRENT_TIMESTAMP
        ''',
        (warehouse_partner_id, product_id, quantity, low_stock_threshold, bin_location),
    )


def create_shipping_label(warehouse_order_id, order_id, warehouse_name):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    label_name = f"shipping_label_{warehouse_order_id}.txt"
    label_path = os.path.join(UPLOAD_DIR, label_name)
    with open(label_path, "w", encoding="utf-8") as label_file:
        label_file.write(
            "JDLX WAREHOUSE SHIPPING LABEL\n"
            f"Warehouse: {warehouse_name}\n"
            f"Order: {order_id}\n"
            f"Generated: {datetime.datetime.utcnow().isoformat()}Z\n"
        )
    return f"/static/uploads/warehouse_partner/{label_name}"
