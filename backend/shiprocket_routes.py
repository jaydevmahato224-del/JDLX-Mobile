import os
import hmac
import json
import datetime
import requests
from flask import Blueprint, jsonify, request, current_app
from functools import wraps
from auth.role_guard import _current_user_claims, require_admin
from database import get_db
from utils.response_utils import success_response, error_response
from shiprocket_client import SHIPROCKET_API, sr_headers

shiprocket_bp = Blueprint('shiprocket', __name__)

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user_claims, error = _current_user_claims()
        if error:
            message, code = error
            return error_response(message, code)
        return f(*args, **kwargs)
    return decorated

@shiprocket_bp.route('/api/admin/shipment/create', methods=['POST'])
@require_admin()
def create_shiprocket_order():
    data = request.get_json()
    order_id = data.get('order_id')
    
    if not order_id:
        return error_response("Order ID is required", 400)

    conn = get_db()
    try:
        # Fetch order and user details if not provided in JSON
        order_query = """
            SELECT o.id, o.total_amount, o.user_id, u.name, u.email, o.phone, o.delivery_address
            FROM orders o
            JOIN users u ON o.user_id = u.id
            WHERE o.id = ?
        """
        order = conn.execute(order_query, (order_id,)).fetchone()
        if not order:
            return error_response("Order not found", 404)

        # Fetch first item for product details (Shiprocket needs at least one item)
        item = conn.execute(
            "SELECT p.name, oi.quantity, oi.price FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ? LIMIT 1",
            (order_id,)
        ).fetchone()
        
        if not item:
            return error_response("Order has no items", 400)

        customer_name = data.get('customer_name', order['name'])
        customer_email = data.get('customer_email', order['email'])
        customer_phone = data.get('customer_phone', order['phone'])
        delivery_address = data.get('delivery_address', order['delivery_address'])
        delivery_city = data.get('delivery_city', 'Unknown')
        delivery_state = data.get('delivery_state', 'Unknown')
        delivery_pincode = data.get('delivery_pincode', '')
        
        weight_kg = data.get('weight_kg', 0.5)

        # Shiprocket order payload
        payload = {
            "order_id": f"JDLX-{order_id}",
            "order_date": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
            "pickup_location": "warehouse",
            "channel_id": os.environ.get('SHIPROCKET_CHANNEL_ID'),
            "billing_customer_name": customer_name,
            "billing_last_name": "",
            "billing_address": delivery_address,
            "billing_city": delivery_city,
            "billing_pincode": delivery_pincode,
            "billing_state": delivery_state,
            "billing_country": "India",
            "billing_email": customer_email,
            "billing_phone": customer_phone,
            "shipping_is_billing": True,
            "order_items": [{
                "name": item['name'],
                "sku": f"SKU-{order_id}",
                "units": item['quantity'],
                "selling_price": item['price'],
            }],
            "payment_method": "Prepaid",
            "sub_total": float(order['total_amount']),
            "length": 10,
            "breadth": 10,
            "height": 5,
            "weight": weight_kg
        }

        headers = sr_headers()
        res = requests.post(f"{SHIPROCKET_API}/orders/create/adhoc", json=payload, headers=headers)
        sr_data = res.json()

        if res.status_code not in [200, 201]:
            return error_response(sr_data.get('message', 'Shiprocket order creation failed'), res.status_code)

        sr_order_id = sr_data.get('order_id')
        sr_shipment_id = sr_data.get('shipment_id')

        # Save to shipments table
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO shipments (order_id, shiprocket_order_id, shiprocket_shipment_id, status)
               VALUES (?, ?, ?, 'created')""",
            (order_id, sr_order_id, sr_shipment_id)
        )
        conn.commit()

        return success_response({
            "order_id": order_id,
            "shiprocket_order_id": sr_order_id,
            "shiprocket_shipment_id": sr_shipment_id
        }, "Shiprocket order created successfully", 201)

    except Exception as e:
        return error_response(f"Shiprocket Error: {str(e)}", 500)
    finally:
        conn.close()

@shiprocket_bp.route('/api/admin/shipment/assign-courier/<int:order_id>', methods=['POST'])
@require_admin()
def assign_courier(order_id):
    conn = get_db()
    try:
        shipment = conn.execute(
            "SELECT shiprocket_shipment_id FROM shipments WHERE order_id = ?",
            (order_id,)
        ).fetchone()

        if not shipment or not shipment['shiprocket_shipment_id']:
            return error_response("Shipment not found for this order", 404)

        shipment_id = shipment['shiprocket_shipment_id']
        headers = sr_headers()

        # 1. Fetch available couriers (serviceability)
        # Note: In a real scenario, we might need more params like pincodes.
        # For simplicity, we assume Shiprocket uses the data from the order_id.
        res = requests.get(
            f"{SHIPROCKET_API}/courier/serviceability/",
            params={"shipment_id": shipment_id},
            headers=headers
        )
        serviceability = res.json()
        
        if not serviceability.get('status') == 200:
            return error_response("Courier serviceability check failed", 400)

        available_couriers = serviceability.get('data', {}).get('available_courier_companies', [])
        if not available_couriers:
            return error_response("No couriers available for this route", 404)

        # 2. Auto-assign best courier (lowest rate, highest rating)
        # For this logic, we'll just pick the first one which is usually the recommended
        best_courier = available_couriers[0]
        courier_id = best_courier['courier_company_id']

        assign_res = requests.post(
            f"{SHIPROCKET_API}/shipments/assign/courier",
            json={"shipment_id": shipment_id, "courier_id": courier_id},
            headers=headers
        )
        assign_data = assign_res.json()

        if not assign_data.get('status') == 200:
            return error_response("Courier assignment failed", 400)

        # 3. Request AWB
        awb_res = requests.post(
            f"{SHIPROCKET_API}/courier/generate/awb",
            json={"shipment_id": shipment_id},
            headers=headers
        )
        awb_data = awb_res.json()
        
        awb_code = awb_data.get('response', {}).get('data', {}).get('awb_code')

        # Update shipments table
        cursor = conn.cursor()
        cursor.execute(
            """UPDATE shipments SET
                awb_code = ?,
                courier_name = ?,
                courier_id = ?,
                status = 'assigned',
                updated_at = CURRENT_TIMESTAMP
               WHERE order_id = ?""",
            (awb_code, best_courier['courier_name'], courier_id, order_id)
        )
        conn.commit()

        return success_response({
            "awb_code": awb_code,
            "courier_name": best_courier['courier_name'],
            "courier_id": courier_id
        }, "Courier assigned and AWB generated")

    except Exception as e:
        return error_response(f"Courier Assignment Error: {str(e)}", 500)
    finally:
        conn.close()

@shiprocket_bp.route('/api/shipment/track/<int:order_id>', methods=['GET'])
@token_required
def track_shipment(order_id):
    user_id = request.user.get('user_id')
    conn = get_db()
    try:
        # Verify ownership
        order = conn.execute("SELECT user_id FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not order:
            return error_response("Order not found", 404)
        if int(order['user_id']) != int(user_id):
            return error_response("Unauthorized", 403)

        shipment = conn.execute(
            "SELECT id, awb_code, courier_name, status, tracking_url FROM shipments WHERE order_id = ?",
            (order_id,)
        ).fetchone()

        if not shipment or not shipment['awb_code']:
            return error_response("Tracking information not available yet", 404)

        awb_code = shipment['awb_code']
        headers = sr_headers()

        # Call Shiprocket tracking API
        res = requests.get(f"{SHIPROCKET_API}/courier/track/awb/{awb_code}", headers=headers)
        tracking_data = res.json()

        # Parse and save events
        tracking_info = tracking_data.get('tracking_data', {})
        shipment_track_activities = tracking_info.get('shipment_track_activities', [])
        
        cursor = conn.cursor()
        for activity in shipment_track_activities:
            # Check if event already exists to avoid duplicates
            existing = conn.execute(
                "SELECT id FROM shipment_tracking WHERE shipment_id = ? AND status = ? AND timestamp = ?",
                (shipment['id'], activity.get('status'), activity.get('date'))
            ).fetchone()
            
            if not existing:
                cursor.execute(
                    """INSERT INTO shipment_tracking (shipment_id, status, location, description, timestamp)
                       VALUES (?, ?, ?, ?, ?)""",
                    (shipment['id'], activity.get('status'), activity.get('location'), activity.get('activity'), activity.get('date'))
                )
        
        # Update current status in shipments table
        current_status = tracking_info.get('shipment_status')
        if current_status:
            cursor.execute(
                "UPDATE shipments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (current_status, shipment['id'])
            )

        conn.commit()

        return success_response({
            "current_status": current_status or shipment['status'],
            "awb_code": awb_code,
            "courier_name": shipment['courier_name'],
            "tracking_url": shipment['tracking_url'],
            "events": [dict(a) for a in shipment_track_activities]
        }, "Tracking data retrieved successfully")

    except Exception as e:
        return error_response(f"Tracking Error: {str(e)}", 500)
    finally:
        conn.close()

@shiprocket_bp.route('/api/admin/shipment/list', methods=['GET'])
@require_admin()
def list_shipments():
    status_filter = request.args.get('status')
    conn = get_db()
    try:
        query = """
            SELECT s.*, o.total_amount, u.name as customer_name
            FROM shipments s
            JOIN orders o ON s.order_id = o.id
            JOIN users u ON o.user_id = u.id
        """
        params = []
        if status_filter:
            query += " WHERE s.status = ?"
            params.append(status_filter)
        
        query += " ORDER BY s.created_at DESC"
        
        rows = conn.execute(query, params).fetchall()
        return success_response([dict(row) for row in rows])
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@shiprocket_bp.route('/api/shiprocket/webhook', methods=['POST'])
def shiprocket_webhook():
    # M1 fix: mandatory webhook token (fail closed). Token is read from the
    # system_settings DB row (shiprocket_token) OR the env var, mirroring the
    # main app.py webhook, so the endpoint works with the DB-configured token
    # while still rejecting requests when no token is configured.
    token = request.headers.get('x-api-key') or request.headers.get('X-Api-Key') or request.headers.get('Authorization')
    if token and token.startswith('Bearer '):
        token = token[7:]
    expected_token = os.environ.get('SHIPROCKET_WEBHOOK_TOKEN')
    try:
        conn = get_db()
        row = conn.execute("SELECT value FROM system_settings WHERE key = 'shiprocket_token'").fetchone()
        if row and row['value']:
            expected_token = row['value']
    except Exception:
        pass  # settings table unavailable -> fall back to env token
    finally:
        try:
            conn.close()
        except Exception:
            pass
    if not expected_token:
        return jsonify({"status": "error", "message": "Webhook token not configured"}), 503
    if not token or not hmac.compare_digest(token, expected_token):
        return jsonify({"status": "error", "message": "Unauthorized"}), 401

    data = request.get_json() or {}
    awb_code = data.get('awb')
    new_status = data.get('current_status')
    
    if not awb_code or not new_status:
        return jsonify({"status": "error", "message": "Missing awb or status"}), 400
    # Cap arbitrary status strings before they reach the tracking log.
    new_status = str(new_status)[:64]

    conn = get_db()
    try:
        shipment = conn.execute("SELECT id FROM shipments WHERE awb_code = ?", (awb_code,)).fetchone()
        if not shipment:
            return jsonify({"status": "ignored"}), 200

        cursor = conn.cursor()
        # Log event
        cursor.execute(
            """INSERT INTO shipment_tracking (shipment_id, status, description, timestamp)
               VALUES (?, ?, ?, CURRENT_TIMESTAMP)""",
            (shipment['id'], new_status, data.get('current_status_description', 'Status updated via webhook'))
        )
        
        # Update shipment status
        cursor.execute(
            "UPDATE shipments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (new_status, shipment['id'])
        )
        
        conn.commit()
        return jsonify({"status": "ok"}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        conn.close()

