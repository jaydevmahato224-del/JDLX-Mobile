import os
import json
import datetime
from flask import Blueprint, jsonify, request, current_app
from functools import wraps
import razorpay
from auth.role_guard import _current_user_claims
from database import get_db
from utils.response_utils import success_response, error_response

payment_bp = Blueprint('payment', __name__)

def get_razorpay_client():
    from app import razorpay_client
    return razorpay_client

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user_claims, error = _current_user_claims()
        if error:
            message, code = error
            return error_response(message, code)
        return f(*args, **kwargs)
    return decorated

@payment_bp.route('/api/payment/create-order', methods=['POST'])
@token_required
def create_payment_order():
    user_id = request.user.get('user_id')
    data = request.get_json()
    order_id = data.get('order_id')

    if not order_id:
        return error_response("Order ID is required", 400)

    conn = get_db()
    try:
        # Fetch order
        order = conn.execute(
            "SELECT id, total_amount, user_id, payment_type FROM orders WHERE id = ?",
            (order_id,)
        ).fetchone()

        if not order:
            return error_response("Order not found", 404)

        # Verify ownership
        if int(order['user_id']) != int(user_id):
            return error_response("Unauthorized access to this order", 403)

        # Check if already paid
        existing_payment = conn.execute(
            "SELECT id FROM payments WHERE order_id = ? AND status = 'paid'",
            (order_id,)
        ).fetchone()
        
        if existing_payment:
            return error_response("Is order ka payment pehle ho chuka hai", 400)

        # Convert amount to paise
        amount_paise = int(float(order['total_amount']) * 100)

        # Create Razorpay order
        client = get_razorpay_client()
        razorpay_order_data = {
            'amount': amount_paise,
            'currency': 'INR',
            'receipt': f'jdlx_order_{order_id}',
            'notes': {
                'jdlx_order_id': str(order_id),
                'user_id': str(user_id)
            }
        }
        
        razorpay_order = client.order.create(data=razorpay_order_data)

        # Save to payments table
        payment_method = order['payment_type'] or 'PREPAID'
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO payments (order_id, user_id, razorpay_order_id, amount, payment_method, status)
               VALUES (?, ?, ?, ?, ?, 'created')""",
            (order_id, user_id, razorpay_order['id'], amount_paise, payment_method)
        )
        conn.commit()

        return success_response({
            "razorpay_order_id": razorpay_order['id'],
            "amount": amount_paise,
            "currency": 'INR',
            "key_id": os.environ.get('RAZORPAY_KEY_ID'),
            "order_id": order_id
        }, "Razorpay order created successfully")

    except Exception as e:
        return error_response(f"Error creating payment order: {str(e)}", 500)
    finally:
        conn.close()

@payment_bp.route('/api/payment/verify', methods=['POST'])
@token_required
def verify_payment():
    user_id = request.user.get('user_id')
    data = request.get_json()
    
    razorpay_order_id = data.get('razorpay_order_id')
    razorpay_payment_id = data.get('razorpay_payment_id')
    razorpay_signature = data.get('razorpay_signature')

    if not all([razorpay_order_id, razorpay_payment_id, razorpay_signature]):
        return error_response("Missing required payment verification fields", 400)

    client = get_razorpay_client()
    try:
        client.utility.verify_payment_signature({
            'razorpay_order_id': razorpay_order_id,
            'razorpay_payment_id': razorpay_payment_id,
            'razorpay_signature': razorpay_signature
        })
    except Exception:
        return error_response("Payment verification failed — invalid signature", 400)

    conn = get_db()
    try:
        cursor = conn.cursor()
        
        # Update payments table
        cursor.execute(
            """UPDATE payments SET
                razorpay_payment_id = ?,
                razorpay_signature = ?,
                status = 'paid',
                updated_at = CURRENT_TIMESTAMP
               WHERE razorpay_order_id = ?""",
            (razorpay_payment_id, razorpay_signature, razorpay_order_id)
        )
        
        # Get order_id to update orders table
        payment = conn.execute(
            "SELECT order_id FROM payments WHERE razorpay_order_id = ?",
            (razorpay_order_id,)
        ).fetchone()
        
        if payment:
            try:
                from app import confirm_order_and_decrement_stock_logic, trigger_order_email
                # Safe, transactional order confirmation & stock decrement
                was_confirmed = confirm_order_and_decrement_stock_logic(cursor, payment['order_id'])
                if was_confirmed:
                    trigger_order_email(payment['order_id'])
            except Exception as conf_err:
                print(f"Error during order confirmation/email: {conf_err}")
        
        conn.commit()
        return success_response({"success": True}, "Payment successful")
    except Exception as e:
        return error_response(f"Database update failed: {str(e)}", 500)
    finally:
        conn.close()

@payment_bp.route('/api/payment/webhook', methods=['POST'])
def payment_webhook():
    webhook_secret = os.environ.get('RAZORPAY_WEBHOOK_SECRET')
    signature = request.headers.get('X-Razorpay-Signature')
    payload = request.data.decode()

    client = get_razorpay_client()
    try:
        if webhook_secret:
            client.utility.verify_webhook_signature(payload, signature, webhook_secret)
    except Exception as e:
        return error_response(f"Webhook verification failed: {str(e)}", 400)

    # Log webhook
    data = request.get_json()
    event_type = data.get('event')
    razorpay_order_id = data.get('payload', {}).get('payment', {}).get('entity', {}).get('order_id')
    razorpay_payment_id = data.get('payload', {}).get('payment', {}).get('entity', {}).get('id')

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO payment_webhooks (event_type, razorpay_order_id, razorpay_payment_id, payload)
               VALUES (?, ?, ?, ?)""",
            (event_type, razorpay_order_id, razorpay_payment_id, json.dumps(data))
        )
        
        # Handle simple events
        if event_type == 'payment.captured':
            cursor.execute(
                "UPDATE payments SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE razorpay_order_id = ?",
                (razorpay_order_id,)
            )
            # Also update order status
            payment = conn.execute(
                "SELECT order_id FROM payments WHERE razorpay_order_id = ?",
                (razorpay_order_id,)
            ).fetchone()
            if payment:
                try:
                    from app import confirm_order_and_decrement_stock_logic, trigger_order_email
                    # Safe, transactional order confirmation & stock decrement via webhook
                    was_confirmed = confirm_order_and_decrement_stock_logic(cursor, payment['order_id'])
                    if was_confirmed:
                        trigger_order_email(payment['order_id'])
                except Exception as conf_err:
                    print(f"Error during order confirmation/email via webhook: {conf_err}")
        elif event_type == 'payment.failed':
            cursor.execute(
                "UPDATE payments SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE razorpay_order_id = ?",
                (razorpay_order_id,)
            )
        elif event_type == 'refund.created':
            cursor.execute(
                "UPDATE payments SET status = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE razorpay_order_id = ?",
                (razorpay_order_id,)
            )

        conn.commit()
        return jsonify({"status": "ok"}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        conn.close()

@payment_bp.route('/api/payment/status/<int:order_id>', methods=['GET'])
@token_required
def get_payment_status(order_id):
    user_id = request.user.get('user_id')
    conn = get_db()
    try:
        # Verify ownership
        order = conn.execute(
            "SELECT user_id FROM orders WHERE id = ?",
            (order_id,)
        ).fetchone()

        if not order:
            return error_response("Order not found", 404)
        
        if int(order['user_id']) != int(user_id):
            return error_response("Unauthorized access", 403)

        payment = conn.execute(
            """SELECT status, razorpay_payment_id, amount, created_at
               FROM payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1""",
            (order_id,)
        ).fetchone()

        if not payment:
            return error_response("No payment found for this order", 404)

        return success_response({
            "status": payment['status'],
            "razorpay_payment_id": payment['razorpay_payment_id'],
            "amount": payment['amount'],
            "created_at": payment['created_at']
        }, "Payment status retrieved successfully")
    finally:
        conn.close()
