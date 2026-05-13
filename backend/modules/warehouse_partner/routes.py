import json

from flask import jsonify, request, session

from auth.role_guard import require_admin
from database import get_db_connection
from .auth import require_warehouse_roles, warehouse_token_required
from .service import (
    VALID_OPERATION_STATUSES,
    VALID_WAREHOUSE_STATUSES,
    VALID_WEATHER_STATUSES,
    build_warehouse_oauth_redirect,
    create_shipping_label,
    current_warehouse_partner,
    ensure_inventory_row,
    ensure_owner_staff_link,
    evaluate_warehouse_serviceability,
    get_nearest_serviceable_warehouse,
    get_product_snapshot,
    notify_warehouse,
    parse_csv_inventory_upload,
    save_uploaded_asset,
    sync_warehouse_order_with_root_status,
    update_warehouse_order_status,
)


WAREHOUSE_MANAGER_ROLES = ["owner", "warehouse_manager"]
WAREHOUSE_INVENTORY_ROLES = ["owner", "warehouse_manager", "inventory_staff"]
WAREHOUSE_DISPATCH_ROLES = ["owner", "warehouse_manager", "dispatch_staff"]
WAREHOUSE_FULFILLMENT_ROLES = ["owner", "warehouse_manager", "packing_staff", "dispatch_staff"]


def register_warehouse_partner_module(
    app,
    *,
    oauth=None,
    google_redirect_uri=None,
    frontend_base_url_warehouse=None,
):
    @app.route("/warehouse/login/google", methods=["GET"])
    def warehouse_login_google():
        if oauth is None or google_redirect_uri is None:
            return jsonify({"error": "Warehouse OAuth is not configured"}), 503
        session["oauth_flow"] = "warehouse_login"
        return oauth.google.authorize_redirect(google_redirect_uri)

    @app.route("/warehouse/request/google", methods=["GET"])
    def warehouse_request_google():
        if oauth is None or google_redirect_uri is None:
            return jsonify({"error": "Warehouse OAuth is not configured"}), 503
        session["oauth_flow"] = "warehouse_request"
        return oauth.google.authorize_redirect(google_redirect_uri)

    @app.route("/api/warehouse/register", methods=["POST"])
    def warehouse_register():
        form = request.form or {}
        data = request.get_json(silent=True) or {}
        payload = {
            "warehouse_name": form.get("warehouse_name") or data.get("warehouse_name"),
            "owner_name": form.get("owner_name") or data.get("owner_name"),
            "email": (form.get("email") or data.get("email") or "").strip().lower(),
            "phone": form.get("phone") or data.get("phone"),
            "address": form.get("address") or data.get("address"),
            "pincode": form.get("pincode") or data.get("pincode"),
            "warehouse_capacity": form.get("warehouse_capacity") or data.get("warehouse_capacity") or 0,
            "warehouse_type": form.get("warehouse_type") or data.get("warehouse_type"),
        }

        required = ["warehouse_name", "owner_name", "email", "phone", "address", "pincode", "warehouse_type"]
        missing = [field for field in required if not payload.get(field)]
        if missing:
            return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

        document_upload = save_uploaded_asset(request.files.get("document_upload"), "document")
        warehouse_photos = [
            path
            for path in [
                save_uploaded_asset(photo, "warehouse_photo")
                for photo in request.files.getlist("warehouse_photos")
            ]
            if path
        ]

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            SELECT id, verification_status
            FROM warehouse_partners
            WHERE LOWER(email) = ?
            ORDER BY id DESC
            LIMIT 1
            ''',
            (payload["email"],),
        )
        existing = cursor.fetchone()

        if existing and existing["verification_status"] == "approved":
            conn.close()
            return jsonify({"error": "A warehouse partner account with this email is already approved."}), 409

        photo_json = json.dumps(warehouse_photos)
        if existing:
            cursor.execute(
                '''
                UPDATE warehouse_partners
                SET warehouse_name = ?, owner_name = ?, phone = ?, address = ?, pincode = ?,
                    warehouse_capacity = ?, warehouse_type = ?, document_upload = COALESCE(?, document_upload),
                    warehouse_photos = CASE WHEN ? != '[]' THEN ? ELSE warehouse_photos END,
                    verification_status = 'pending', onboarding_status = 'application_submitted',
                    active = 0, admin_notes = NULL, rejected_at = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                ''',
                (
                    payload["warehouse_name"],
                    payload["owner_name"],
                    payload["phone"],
                    payload["address"],
                    payload["pincode"],
                    int(payload["warehouse_capacity"] or 0),
                    payload["warehouse_type"],
                    document_upload,
                    photo_json,
                    photo_json,
                    existing["id"],
                ),
            )
            application_id = existing["id"]
        else:
            cursor.execute(
                '''
                INSERT INTO warehouse_partners (
                    warehouse_name, owner_name, email, phone, address, pincode,
                    warehouse_capacity, warehouse_type, document_upload, warehouse_photos
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''',
                (
                    payload["warehouse_name"],
                    payload["owner_name"],
                    payload["email"],
                    payload["phone"],
                    payload["address"],
                    payload["pincode"],
                    int(payload["warehouse_capacity"] or 0),
                    payload["warehouse_type"],
                    document_upload,
                    photo_json,
                ),
            )
            application_id = cursor.lastrowid

        conn.commit()
        conn.close()
        return jsonify({"message": "Warehouse application submitted successfully.", "application_id": application_id}), 201

    @app.route("/api/warehouse/request-status", methods=["GET"])
    def warehouse_request_status():
        email = (request.args.get("email") or "").strip().lower()
        if not email:
            return jsonify({"error": "Email is required"}), 400

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            SELECT id, warehouse_name, owner_name, email, phone, address, pincode,
                   warehouse_capacity, warehouse_type, verification_status,
                   onboarding_status, admin_notes, active, approved_at,
                   rejected_at, created_at, updated_at
            FROM warehouse_partners
            WHERE LOWER(email) = ?
            ORDER BY id DESC
            LIMIT 1
            ''',
            (email,),
        )
        application = cursor.fetchone()
        conn.close()

        if not application:
            return jsonify({"exists": False, "verification_status": None, "application": None}), 200

        return jsonify(
            {
                "exists": True,
                "verification_status": application["verification_status"],
                "application": dict(application),
            }
        ), 200

    @app.route("/api/admin/warehouse/applications", methods=["GET"])
    @require_admin(["super_admin", "admin", "manager"])
    def admin_warehouse_applications():
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            SELECT wp.*, u.name AS approved_by_name
            FROM warehouse_partners wp
            LEFT JOIN users u ON u.id = wp.approved_by
            ORDER BY
                CASE wp.verification_status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
                wp.created_at DESC
            '''
        )
        applications = [dict(row) for row in cursor.fetchall()]
        for application in applications:
            application["warehouse_photos"] = json.loads(application.get("warehouse_photos") or "[]")
        conn.close()
        return jsonify(applications), 200

    @app.route("/api/admin/warehouse/applications/<int:application_id>", methods=["PATCH"])
    @require_admin(["super_admin", "admin", "manager"])
    def admin_review_warehouse_application(application_id):
        payload = request.get_json(silent=True) or {}
        action = (payload.get("action") or "").strip().lower()
        notes = (payload.get("notes") or "").strip()
        if action not in {"approve", "reject"}:
            return jsonify({"error": "Action must be approve or reject"}), 400

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM warehouse_partners WHERE id = ?", (application_id,))
        application = cursor.fetchone()
        if not application:
            conn.close()
            return jsonify({"error": "Warehouse application not found"}), 404

        application = dict(application)
        if action == "approve":
            cursor.execute(
                '''
                UPDATE warehouse_partners
                SET verification_status = 'approved',
                    onboarding_status = 'dashboard_enabled',
                    active = 1,
                    admin_notes = ?,
                    approved_by = ?,
                    approved_at = CURRENT_TIMESTAMP,
                    rejected_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                ''',
                (notes or None, request.user["user_id"], application_id),
            )

            cursor.execute("SELECT id, name, phone, email FROM users WHERE LOWER(email) = ?", (application["email"],))
            owner_user = cursor.fetchone()
            if owner_user:
                cursor.execute(
                    "UPDATE warehouse_partners SET owner_user_id = ? WHERE id = ?",
                    (owner_user["id"], application_id),
                )
                ensure_owner_staff_link(
                    cursor,
                    application_id,
                    owner_user["id"],
                    owner_user["name"],
                    owner_user["email"],
                    owner_user["phone"],
                )

            notify_warehouse(
                cursor,
                application_id,
                "Warehouse application approved",
                f"Your warehouse {application['warehouse_name']} has been approved. You can now access the warehouse dashboard.",
                metadata={"application_id": application_id},
                send_email=True,
            )
        else:
            cursor.execute(
                '''
                UPDATE warehouse_partners
                SET verification_status = 'rejected',
                    onboarding_status = 'rejected',
                    active = 0,
                    admin_notes = ?,
                    rejected_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                ''',
                (notes or None, application_id),
            )

        conn.commit()
        conn.close()
        return jsonify({"message": f"Warehouse application {action}d successfully."}), 200

    @app.route("/api/admin/warehouse/partners", methods=["GET"])
    @require_admin(["super_admin", "admin", "manager"])
    def admin_warehouse_partners():
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            SELECT wp.*,
                   (SELECT COUNT(*) FROM warehouse_staff ws WHERE ws.warehouse_partner_id = wp.id AND ws.status = 'active') AS staff_count,
                   (SELECT COUNT(*) FROM warehouse_orders wo WHERE wo.warehouse_partner_id = wp.id AND wo.assignment_status != 'cancelled') AS assigned_orders
            FROM warehouse_partners wp
            WHERE wp.verification_status = 'approved' AND wp.active = 1
            ORDER BY wp.warehouse_name ASC
            '''
        )
        partners = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(partners), 200

    @app.route("/api/warehouse/session", methods=["GET"])
    @warehouse_token_required
    def warehouse_session():
        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        conn.close()
        if not partner:
            return jsonify({"error": "Warehouse access revoked"}), 403
        return jsonify(
            {
                "user": request.warehouse_user,
                "warehouse": {
                    "id": partner["id"],
                    "warehouse_name": partner["warehouse_name"],
                    "owner_name": partner["owner_name"],
                    "email": partner["email"],
                    "phone": partner["phone"],
                    "address": partner["address"],
                    "pincode": partner["pincode"],
                    "warehouse_capacity": partner["warehouse_capacity"],
                    "warehouse_type": partner["warehouse_type"],
                    "operations_status": partner.get("operations_status") or "open",
                    "weather_status": partner.get("weather_status") or "clear",
                    "service_radius_km": partner.get("service_radius_km") or 4,
                },
            }
        ), 200

    @app.route("/api/warehouse/dashboard", methods=["GET"])
    @warehouse_token_required
    def warehouse_dashboard():
        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        warehouse_partner_id = partner["id"]
        cursor.execute(
            '''
            SELECT
                COUNT(*) AS total_orders,
                SUM(CASE WHEN assignment_status IN ('assigned', 'accepted', 'packing') THEN 1 ELSE 0 END) AS pending_orders,
                SUM(CASE WHEN assignment_status = 'packed' THEN 1 ELSE 0 END) AS packed_orders,
                SUM(CASE WHEN assignment_status = 'dispatched' THEN 1 ELSE 0 END) AS dispatched_orders
            FROM warehouse_orders
            WHERE warehouse_partner_id = ?
            ''',
            (warehouse_partner_id,),
        )
        order_stats = dict(cursor.fetchone())

        cursor.execute(
            '''
            SELECT
                COUNT(*) AS total_inventory_lines,
                SUM(CASE WHEN stock_quantity <= low_stock_threshold THEN 1 ELSE 0 END) AS low_stock_alerts,
                SUM(stock_quantity) AS total_inventory_units
            FROM warehouse_inventory
            WHERE warehouse_partner_id = ?
            ''',
            (warehouse_partner_id,),
        )
        inventory_stats = dict(cursor.fetchone())

        cursor.execute(
            '''
            SELECT wo.id, wo.order_id, wo.assignment_status, wo.created_at,
                   o.delivery_address, o.total_amount,
                   GROUP_CONCAT(COALESCE(oi.product_name, 'Item'), ', ') AS product_names,
                   SUM(oi.quantity) AS total_quantity
            FROM warehouse_orders wo
            JOIN orders o ON o.id = wo.order_id
            JOIN order_items oi ON oi.order_id = wo.order_id
            WHERE wo.warehouse_partner_id = ?
            GROUP BY wo.id, wo.order_id, wo.assignment_status, wo.created_at, o.delivery_address, o.total_amount
            ORDER BY wo.created_at DESC
            LIMIT 6
            ''',
            (warehouse_partner_id,),
        )
        recent_orders = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            '''
            SELECT wi.id, wi.product_id, wi.stock_quantity, wi.reserved_stock, wi.low_stock_threshold, wi.bin_location,
                   p.name AS product_name,
                   'SKU-' || printf('%04d', p.id) AS sku,
                   MAX(wi.stock_quantity - wi.reserved_stock, 0) AS available_stock
            FROM warehouse_inventory wi
            JOIN products p ON p.id = wi.product_id
            WHERE wi.warehouse_partner_id = ?
            ORDER BY available_stock ASC, p.name ASC
            LIMIT 8
            ''',
            (warehouse_partner_id,),
        )
        inventory_summary = [dict(row) for row in cursor.fetchall()]

        cursor.execute(
            '''
            SELECT
                SUM(CASE WHEN assignment_status IN ('accepted', 'packing', 'packed', 'ready_for_pickup', 'courier_pickup_requested', 'dispatched') THEN 1 ELSE 0 END) AS accepted_orders,
                SUM(CASE WHEN assignment_status = 'dispatched' THEN 1 ELSE 0 END) AS completed_dispatches
            FROM warehouse_orders
            WHERE warehouse_partner_id = ?
            ''',
            (warehouse_partner_id,),
        )
        metrics = dict(cursor.fetchone())
        total_orders = order_stats.get("total_orders") or 0
        accepted_orders = metrics.get("accepted_orders") or 0
        metrics["acceptance_rate"] = round((accepted_orders / total_orders) * 100, 2) if total_orders else 0

        conn.close()
        return jsonify(
            {
                "cards": {
                    "total_orders_assigned": order_stats.get("total_orders") or 0,
                    "pending_orders": order_stats.get("pending_orders") or 0,
                    "packed_orders": order_stats.get("packed_orders") or 0,
                    "dispatched_orders": order_stats.get("dispatched_orders") or 0,
                    "total_inventory": inventory_stats.get("total_inventory_units") or 0,
                    "low_stock_alerts": inventory_stats.get("low_stock_alerts") or 0,
                },
                "recent_orders": recent_orders,
                "inventory_summary": inventory_summary,
                "performance_metrics": metrics,
                "availability": {
                    "operations_status": partner.get("operations_status") or "open",
                    "weather_status": partner.get("weather_status") or "clear",
                    "service_radius_km": partner.get("service_radius_km") or 4,
                },
            }
        ), 200

    @app.route("/api/warehouse/availability", methods=["GET"])
    def warehouse_public_availability():
        user_lat = request.args.get("latitude", type=float)
        user_lng = request.args.get("longitude", type=float)
        user_pincode = (request.args.get("pincode") or "").strip()

        conn = get_db_connection()
        cursor = conn.cursor()
        result = get_nearest_serviceable_warehouse(
            cursor,
            user_lat=user_lat,
            user_lng=user_lng,
            user_pincode=user_pincode or None,
        )
        conn.close()

        if not result:
            return jsonify({
                "ordering_enabled": False,
                "message": "No approved store is available right now.",
            }), 200

        partner = result["partner"]
        evaluation = result["evaluation"]
        return jsonify({
            "ordering_enabled": evaluation["ordering_enabled"],
            "message": evaluation["message"],
            "store": {
                "id": partner["id"],
                "warehouse_name": partner["warehouse_name"],
                "address": partner["address"],
                "operations_status": evaluation["operations_status"],
                "weather_status": evaluation["weather_status"],
                "service_radius_km": evaluation["service_radius_km"],
                "distance_km": evaluation["distance_km"],
            },
        }), 200

    @app.route("/api/warehouse/inventory", methods=["GET"])
    @require_warehouse_roles(WAREHOUSE_INVENTORY_ROLES)
    def warehouse_inventory():
        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        cursor.execute(
            '''
            SELECT wi.id, wi.product_id, wi.stock_quantity, wi.reserved_stock, wi.low_stock_threshold, wi.bin_location,
                   p.name AS product_name,
                   COALESCE(p.sku, 'SKU-' || printf('%04d', p.id)) AS sku,
                   MAX(wi.stock_quantity - wi.reserved_stock, 0) AS available_stock
            FROM warehouse_inventory wi
            JOIN products p ON p.id = wi.product_id
            WHERE wi.warehouse_partner_id = ?
            ORDER BY p.name ASC
            ''',
            (partner["id"],),
        )
        inventory = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(inventory), 200

    @app.route("/api/warehouse/inventory", methods=["POST"])
    @require_warehouse_roles(WAREHOUSE_INVENTORY_ROLES)
    def add_warehouse_inventory():
        payload = request.get_json(silent=True) or {}
        product_id = payload.get("product_id")
        quantity = int(payload.get("quantity") or 0)
        if not product_id or quantity <= 0:
            return jsonify({"error": "product_id and positive quantity are required"}), 400

        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        product = get_product_snapshot(cursor, int(product_id))
        if not product:
            conn.close()
            return jsonify({"error": "Product not found"}), 404

        ensure_inventory_row(
            cursor,
            partner["id"],
            int(product_id),
            quantity,
            int(payload.get("low_stock_threshold") or 5),
            payload.get("bin_location"),
        )
        conn.commit()
        conn.close()
        return jsonify({"message": "Stock added successfully"}), 201

    @app.route("/api/warehouse/inventory/<int:inventory_id>", methods=["PATCH"])
    @require_warehouse_roles(WAREHOUSE_INVENTORY_ROLES)
    def update_inventory_item(inventory_id):
        payload = request.get_json(silent=True) or {}
        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        cursor.execute(
            '''
            SELECT id, stock_quantity, reserved_stock
            FROM warehouse_inventory
            WHERE id = ? AND warehouse_partner_id = ?
            ''',
            (inventory_id, partner["id"]),
        )
        inventory_row = cursor.fetchone()
        if not inventory_row:
            conn.close()
            return jsonify({"error": "Inventory row not found"}), 404

        stock_quantity = payload.get("stock_quantity", inventory_row["stock_quantity"])
        if int(stock_quantity) < int(inventory_row["reserved_stock"]):
            conn.close()
            return jsonify({"error": "Stock quantity cannot be lower than reserved stock"}), 400

        cursor.execute(
            '''
            UPDATE warehouse_inventory
            SET stock_quantity = ?, low_stock_threshold = ?, bin_location = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            ''',
            (
                int(stock_quantity),
                int(payload.get("low_stock_threshold") or 5),
                payload.get("bin_location"),
                inventory_id,
            ),
        )
        conn.commit()
        conn.close()
        return jsonify({"message": "Inventory updated successfully"}), 200

    @app.route("/api/warehouse/inventory/<int:inventory_id>", methods=["DELETE"])
    @require_warehouse_roles(WAREHOUSE_MANAGER_ROLES)
    def delete_inventory_item(inventory_id):
        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        cursor.execute(
            '''
            SELECT reserved_stock
            FROM warehouse_inventory
            WHERE id = ? AND warehouse_partner_id = ?
            ''',
            (inventory_id, partner["id"]),
        )
        inventory_row = cursor.fetchone()
        if not inventory_row:
            conn.close()
            return jsonify({"error": "Inventory row not found"}), 404
        if inventory_row["reserved_stock"] > 0:
            conn.close()
            return jsonify({"error": "Cannot delete inventory with reserved stock"}), 400

        cursor.execute("DELETE FROM warehouse_inventory WHERE id = ?", (inventory_id,))
        conn.commit()
        conn.close()
        return jsonify({"message": "Inventory deleted successfully"}), 200

    @app.route("/api/warehouse/inventory/bulk-upload", methods=["POST"])
    @require_warehouse_roles(WAREHOUSE_INVENTORY_ROLES)
    def warehouse_inventory_bulk_upload():
        upload = request.files.get("file")
        if not upload:
            return jsonify({"error": "CSV file is required"}), 400

        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        rows = parse_csv_inventory_upload(upload)
        imported = 0
        skipped = []
        for index, row in enumerate(rows, start=2):
            product_id = row.get("product_id")
            sku = (row.get("sku") or "").strip()
            quantity = int(row.get("quantity") or 0)
            if quantity <= 0:
                skipped.append({"row": index, "reason": "Quantity must be positive"})
                continue

            if product_id:
                product = get_product_snapshot(cursor, int(product_id))
            elif sku:
                cursor.execute("SELECT id FROM products WHERE sku = ?", (sku,))
                product_row = cursor.fetchone()
                product = get_product_snapshot(cursor, product_row["id"]) if product_row else None
            else:
                product = None

            if not product:
                skipped.append({"row": index, "reason": "Product not found"})
                continue

            ensure_inventory_row(
                cursor,
                partner["id"],
                product["id"],
                quantity,
                int(row.get("low_stock_threshold") or 5),
                row.get("bin_location"),
            )
            imported += 1

        conn.commit()
        conn.close()
        return jsonify({"message": "Bulk upload processed", "imported": imported, "skipped": skipped}), 200

    @app.route("/api/warehouse/inventory/transfer", methods=["POST"])
    @require_warehouse_roles(WAREHOUSE_MANAGER_ROLES)
    def transfer_inventory():
        payload = request.get_json(silent=True) or {}
        target_warehouse_id = int(payload.get("target_warehouse_id") or 0)
        product_id = int(payload.get("product_id") or 0)
        quantity = int(payload.get("quantity") or 0)
        if not target_warehouse_id or not product_id or quantity <= 0:
            return jsonify({"error": "target_warehouse_id, product_id and positive quantity are required"}), 400

        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        cursor.execute(
            '''
            SELECT stock_quantity, reserved_stock
            FROM warehouse_inventory
            WHERE warehouse_partner_id = ? AND product_id = ?
            ''',
            (partner["id"], product_id),
        )
        source = cursor.fetchone()
        if not source:
            conn.close()
            return jsonify({"error": "Source inventory not found"}), 404
        if (source["stock_quantity"] - source["reserved_stock"]) < quantity:
            conn.close()
            return jsonify({"error": "Insufficient available stock for transfer"}), 400

        cursor.execute(
            '''
            SELECT id
            FROM warehouse_partners
            WHERE id = ? AND verification_status = 'approved' AND active = 1
            ''',
            (target_warehouse_id,),
        )
        if not cursor.fetchone():
            conn.close()
            return jsonify({"error": "Target warehouse not found"}), 404

        cursor.execute(
            '''
            UPDATE warehouse_inventory
            SET stock_quantity = stock_quantity - ?, updated_at = CURRENT_TIMESTAMP
            WHERE warehouse_partner_id = ? AND product_id = ?
            ''',
            (quantity, partner["id"], product_id),
        )
        ensure_inventory_row(cursor, target_warehouse_id, product_id, quantity)
        conn.commit()
        conn.close()
        return jsonify({"message": "Stock transferred successfully"}), 200

    @app.route("/api/warehouse/orders", methods=["GET"])
    @require_warehouse_roles(WAREHOUSE_FULFILLMENT_ROLES)
    def warehouse_orders():
        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        status = request.args.get("status")
        params = [partner["id"]]
        query = '''
            SELECT wo.id, wo.order_id, wo.assignment_status, wo.courier_name, wo.courier_tracking_number, wo.created_at,
                   o.delivery_address, o.total_amount,
                   GROUP_CONCAT(COALESCE(oi.product_name, 'Item'), ', ') AS products,
                   SUM(oi.quantity) AS quantity
            FROM warehouse_orders wo
            JOIN orders o ON o.id = wo.order_id
            JOIN order_items oi ON oi.order_id = wo.order_id
            WHERE wo.warehouse_partner_id = ?
        '''
        if status:
            query += " AND wo.assignment_status = ?"
            params.append(status)
        query += '''
            GROUP BY wo.id, wo.order_id, wo.assignment_status, wo.courier_name, wo.courier_tracking_number, wo.created_at, o.delivery_address, o.total_amount
            ORDER BY wo.created_at DESC
        '''
        cursor.execute(query, params)
        orders = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(orders), 200

    @app.route("/api/warehouse/orders/<int:warehouse_order_id>/status", methods=["PATCH"])
    @require_warehouse_roles(WAREHOUSE_FULFILLMENT_ROLES)
    def warehouse_order_status(warehouse_order_id):
        payload = request.get_json(silent=True) or {}
        new_status = (payload.get("status") or "").strip().lower()
        if new_status not in VALID_WAREHOUSE_STATUSES:
            return jsonify({"error": "Invalid warehouse status"}), 400

        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        try:
            result = update_warehouse_order_status(cursor, warehouse_order_id, partner["id"], new_status)
            conn.commit()
            conn.close()
            return jsonify({"message": "Warehouse order updated successfully", "warehouse_order": result}), 200
        except LookupError as exc:
            conn.close()
            return jsonify({"error": str(exc)}), 404
        except ValueError as exc:
            conn.close()
            return jsonify({"error": str(exc)}), 400

    @app.route("/api/warehouse/dispatch", methods=["GET"])
    @require_warehouse_roles(WAREHOUSE_DISPATCH_ROLES)
    def warehouse_dispatch():
        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        cursor.execute(
            '''
            SELECT wo.id, wo.order_id, wo.assignment_status, wo.courier_name, wo.courier_tracking_number,
                   wo.shipping_label_url, wo.dispatched_at, wo.ready_for_pickup_at, wo.courier_pickup_requested_at,
                   o.delivery_address, o.total_amount
            FROM warehouse_orders wo
            JOIN orders o ON o.id = wo.order_id
            WHERE wo.warehouse_partner_id = ?
              AND wo.assignment_status IN ('packed', 'ready_for_pickup', 'courier_pickup_requested', 'dispatched')
            ORDER BY wo.updated_at DESC
            ''',
            (partner["id"],),
        )
        dispatch_orders = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(dispatch_orders), 200

    @app.route("/api/warehouse/dispatch/<int:warehouse_order_id>/label", methods=["POST"])
    @require_warehouse_roles(WAREHOUSE_DISPATCH_ROLES)
    def generate_shipping_label(warehouse_order_id):
        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        cursor.execute(
            '''
            SELECT id, order_id
            FROM warehouse_orders
            WHERE id = ? AND warehouse_partner_id = ?
            ''',
            (warehouse_order_id, partner["id"]),
        )
        warehouse_order = cursor.fetchone()
        if not warehouse_order:
            conn.close()
            return jsonify({"error": "Warehouse order not found"}), 404

        label_url = create_shipping_label(warehouse_order_id, warehouse_order["order_id"], partner["warehouse_name"])
        cursor.execute(
            '''
            UPDATE warehouse_orders
            SET shipping_label_url = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            ''',
            (label_url, warehouse_order_id),
        )
        conn.commit()
        conn.close()
        return jsonify({"message": "Shipping label generated", "shipping_label_url": label_url}), 200

    @app.route("/api/warehouse/dispatch/<int:warehouse_order_id>/pickup-request", methods=["POST"])
    @require_warehouse_roles(WAREHOUSE_DISPATCH_ROLES)
    def request_courier_pickup(warehouse_order_id):
        payload = request.get_json(silent=True) or {}
        courier_name = payload.get("courier_name") or "JDLX Courier"

        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        cursor.execute(
            '''
            SELECT id
            FROM warehouse_orders
            WHERE id = ? AND warehouse_partner_id = ?
            ''',
            (warehouse_order_id, partner["id"]),
        )
        warehouse_order = cursor.fetchone()
        if not warehouse_order:
            conn.close()
            return jsonify({"error": "Warehouse order not found"}), 404

        cursor.execute(
            '''
            UPDATE warehouse_orders
            SET courier_name = ?, assignment_status = 'courier_pickup_requested',
                courier_pickup_requested_at = COALESCE(courier_pickup_requested_at, CURRENT_TIMESTAMP),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            ''',
            (courier_name, warehouse_order_id),
        )
        conn.commit()
        conn.close()
        return jsonify({"message": "Courier pickup requested successfully"}), 200

    @app.route("/api/warehouse/dispatch/<int:warehouse_order_id>/dispatch", methods=["PATCH"])
    @require_warehouse_roles(WAREHOUSE_DISPATCH_ROLES)
    def mark_dispatch(warehouse_order_id):
        payload = request.get_json(silent=True) or {}
        tracking_number = (payload.get("tracking_number") or "").strip()
        courier_name = payload.get("courier_name") or "JDLX Courier"
        if not tracking_number:
            return jsonify({"error": "tracking_number is required"}), 400

        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        cursor.execute(
            '''
            UPDATE warehouse_orders
            SET courier_name = ?, courier_tracking_number = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND warehouse_partner_id = ?
            ''',
            (courier_name, tracking_number, warehouse_order_id, partner["id"]),
        )
        if cursor.rowcount == 0:
            conn.close()
            return jsonify({"error": "Warehouse order not found"}), 404

        try:
            update_warehouse_order_status(cursor, warehouse_order_id, partner["id"], "dispatched")
        except Exception as exc:
            conn.close()
            return jsonify({"error": str(exc)}), 400

        conn.commit()
        conn.close()
        return jsonify({"message": "Order dispatched successfully"}), 200

    @app.route("/api/warehouse/staff", methods=["GET"])
    @require_warehouse_roles(WAREHOUSE_MANAGER_ROLES)
    def warehouse_staff():
        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        cursor.execute(
            '''
            SELECT id, user_id, name, email, phone, role, status, created_at
            FROM warehouse_staff
            WHERE warehouse_partner_id = ?
            ORDER BY
                CASE role WHEN 'owner' THEN 0 ELSE 1 END,
                name ASC
            ''',
            (partner["id"],),
        )
        staff = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(staff), 200

    @app.route("/api/warehouse/staff", methods=["POST"])
    @require_warehouse_roles(WAREHOUSE_MANAGER_ROLES)
    def add_warehouse_staff():
        payload = request.get_json(silent=True) or {}
        required = ["name", "email", "role"]
        missing = [field for field in required if not payload.get(field)]
        if missing:
            return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        email = payload["email"].strip().lower()
        cursor.execute("SELECT id, name, email, phone FROM users WHERE LOWER(email) = ?", (email,))
        user_row = cursor.fetchone()
        user_id = user_row["id"] if user_row else None

        cursor.execute(
            '''
            INSERT INTO warehouse_staff (warehouse_partner_id, user_id, name, email, phone, role, invited_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(warehouse_partner_id, email) DO UPDATE SET
                user_id = excluded.user_id,
                name = excluded.name,
                phone = excluded.phone,
                role = excluded.role,
                status = 'active',
                updated_at = CURRENT_TIMESTAMP
            ''',
            (
                partner["id"],
                user_id,
                payload["name"],
                email,
                payload.get("phone"),
                payload["role"],
                request.warehouse_user["user_id"],
            ),
        )
        notify_warehouse(
            cursor,
            partner["id"],
            "Warehouse staff updated",
            f"{payload['name']} was added or updated as {payload['role'].replace('_', ' ')}.",
            metadata={"email": email},
            send_email=True,
        )
        conn.commit()
        conn.close()
        return jsonify({"message": "Staff member saved successfully"}), 201

    @app.route("/api/warehouse/staff/<int:staff_id>", methods=["PATCH"])
    @require_warehouse_roles(WAREHOUSE_MANAGER_ROLES)
    def update_staff_member(staff_id):
        payload = request.get_json(silent=True) or {}
        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        cursor.execute(
            '''
            SELECT role
            FROM warehouse_staff
            WHERE id = ? AND warehouse_partner_id = ?
            ''',
            (staff_id, partner["id"]),
        )
        staff = cursor.fetchone()
        if not staff:
            conn.close()
            return jsonify({"error": "Staff member not found"}), 404
        if staff["role"] == "owner":
            conn.close()
            return jsonify({"error": "Owner role cannot be changed here"}), 400

        cursor.execute(
            '''
            UPDATE warehouse_staff
            SET name = COALESCE(?, name),
                phone = COALESCE(?, phone),
                role = COALESCE(?, role),
                status = COALESCE(?, status),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            ''',
            (
                payload.get("name"),
                payload.get("phone"),
                payload.get("role"),
                payload.get("status"),
                staff_id,
            ),
        )
        conn.commit()
        conn.close()
        return jsonify({"message": "Staff member updated successfully"}), 200

    @app.route("/api/warehouse/staff/<int:staff_id>", methods=["DELETE"])
    @require_warehouse_roles(WAREHOUSE_MANAGER_ROLES)
    def remove_staff_member(staff_id):
        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        cursor.execute(
            '''
            SELECT role
            FROM warehouse_staff
            WHERE id = ? AND warehouse_partner_id = ?
            ''',
            (staff_id, partner["id"]),
        )
        staff = cursor.fetchone()
        if not staff:
            conn.close()
            return jsonify({"error": "Staff member not found"}), 404
        if staff["role"] == "owner":
            conn.close()
            return jsonify({"error": "Owner cannot be removed"}), 400

        cursor.execute("DELETE FROM warehouse_staff WHERE id = ?", (staff_id,))
        conn.commit()
        conn.close()
        return jsonify({"message": "Staff member removed successfully"}), 200

    @app.route("/api/warehouse/notifications", methods=["GET"])
    @warehouse_token_required
    def warehouse_notifications():
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            SELECT id, title, message, is_read, created_at
            FROM notifications
            WHERE user_id = ? AND type = 'WAREHOUSE'
            ORDER BY created_at DESC
            LIMIT 100
            ''',
            (request.warehouse_user["user_id"],),
        )
        notifications = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return jsonify(notifications), 200

    @app.route("/api/warehouse/notifications/read-all", methods=["POST"])
    @warehouse_token_required
    def read_warehouse_notifications():
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            '''
            UPDATE notifications
            SET is_read = 1
            WHERE user_id = ? AND type = 'WAREHOUSE'
            ''',
            (request.warehouse_user["user_id"],),
        )
        conn.commit()
        conn.close()
        return jsonify({"message": "Warehouse notifications marked as read"}), 200

    @app.route("/api/warehouse/analytics", methods=["GET"])
    @warehouse_token_required
    def warehouse_analytics():
        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        cursor.execute(
            '''
            SELECT assignment_status, COUNT(*) AS count
            FROM warehouse_orders
            WHERE warehouse_partner_id = ?
            GROUP BY assignment_status
            ''',
            (partner["id"],),
        )
        status_breakdown = {row["assignment_status"]: row["count"] for row in cursor.fetchall()}

        cursor.execute(
            '''
            SELECT COUNT(*) AS low_stock_skus
            FROM warehouse_inventory
            WHERE warehouse_partner_id = ?
              AND stock_quantity <= low_stock_threshold
            ''',
            (partner["id"],),
        )
        low_stock = cursor.fetchone()["low_stock_skus"]
        conn.close()
        return jsonify({"status_breakdown": status_breakdown, "low_stock_skus": low_stock}), 200

    @app.route("/api/warehouse/settings", methods=["GET", "PATCH"])
    @require_warehouse_roles(WAREHOUSE_MANAGER_ROLES)
    def warehouse_settings():
        conn = get_db_connection()
        cursor = conn.cursor()
        partner = current_warehouse_partner(cursor, request.warehouse_user)
        if not partner:
            conn.close()
            return jsonify({"error": "Warehouse access revoked"}), 403

        if request.method == "GET":
            conn.close()
            return jsonify(partner), 200

        payload = request.get_json(silent=True) or {}
        operations_status = payload.get("operations_status")
        weather_status = payload.get("weather_status")
        service_radius_km = payload.get("service_radius_km")

        if operations_status and operations_status not in VALID_OPERATION_STATUSES:
            conn.close()
            return jsonify({"error": "Invalid operations_status"}), 400

        if weather_status and weather_status not in VALID_WEATHER_STATUSES:
            conn.close()
            return jsonify({"error": "Invalid weather_status"}), 400

        cursor.execute(
            '''
            UPDATE warehouse_partners
            SET warehouse_name = COALESCE(?, warehouse_name),
                phone = COALESCE(?, phone),
                address = COALESCE(?, address),
                pincode = COALESCE(?, pincode),
                warehouse_capacity = COALESCE(?, warehouse_capacity),
                warehouse_type = COALESCE(?, warehouse_type),
                operations_status = COALESCE(?, operations_status),
                weather_status = COALESCE(?, weather_status),
                service_radius_km = COALESCE(?, service_radius_km),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            ''',
            (
                payload.get("warehouse_name"),
                payload.get("phone"),
                payload.get("address"),
                payload.get("pincode"),
                payload.get("warehouse_capacity"),
                payload.get("warehouse_type"),
                operations_status,
                weather_status,
                service_radius_km,
                partner["id"],
            ),
        )
        conn.commit()
        conn.close()
        return jsonify({"message": "Warehouse settings updated"}), 200

    return build_warehouse_oauth_redirect, sync_warehouse_order_with_root_status
