import os
import json
import logging
from datetime import datetime
from functools import wraps
from flask import Blueprint, request, jsonify, current_app
from database import get_db
import jwt
from utils.response_utils import success_response, error_response
from auth.role_guard import _current_user_claims, require_admin

logger = logging.getLogger(__name__)

offer_bp = Blueprint('offer_bp', __name__)

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user_claims, error = _current_user_claims()
        if error:
            message, code = error
            return error_response(message, code)
        return f(*args, **kwargs)
    return decorated

@offer_bp.route('/api/offers/active', methods=['GET'])
def get_active_offers():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM offers 
        WHERE is_active = 1 
        AND (start_date IS NULL OR start_date <= datetime('now', 'localtime'))
        AND (end_date IS NULL OR end_date >= datetime('now', 'localtime'))
        AND (usage_limit IS NULL OR usage_count < usage_limit)
    """)
    offers = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    for offer in offers:
        if offer.get('applicable_ids'):
            try:
                offer['applicable_ids'] = json.loads(offer['applicable_ids'])
            except:
                offer['applicable_ids'] = []
                
    return success_response(offers, "Active offers retrieved successfully")

@offer_bp.route('/api/offers/banners', methods=['GET'])
def get_offer_banners():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, title, description, banner_image, target_type, applicable_on, applicable_ids
        FROM offers 
        WHERE is_active = 1 AND banner_image IS NOT NULL
        AND (start_date IS NULL OR start_date <= datetime('now', 'localtime'))
        AND (end_date IS NULL OR end_date >= datetime('now', 'localtime'))
    """)
    banners = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return success_response(banners, "Offer banners retrieved successfully")

def _eligible_subtotal(offer, items, cart_total, conn):
    """Returns the subtotal of the cart items an offer legitimately covers.

    When per-item prices are supplied (``items``), percentage/flat discounts
    are computed against ONLY the eligible items' value — multi-vendor
    fairness: Store A's offer never discounts Store B's products. When items
    are absent (legacy callers) the whole ``cart_total`` is used, preserving
    the previous behavior.

    ``items`` shape: [{product_id, price, quantity}] (price = unit price).
    """
    if not items:
        return cart_total

    product_subtotals = {}
    for item in items:
        try:
            pid = str(int(item.get('product_id')))
        except (TypeError, ValueError):
            continue
        try:
            qty = int(item.get('quantity') or 1)
        except (TypeError, ValueError):
            qty = 1
        try:
            price = float(item.get('price') or 0)
        except (TypeError, ValueError):
            price = 0.0
        product_subtotals[pid] = product_subtotals.get(pid, 0.0) + (price * qty)

    if not product_subtotals:
        return cart_total

    eligible_ids = set(product_subtotals.keys())

    if offer.get('warehouse_id'):
        if not eligible_ids:
            return 0.0
        placeholders = ','.join('?' * len(eligible_ids))
        rows = conn.execute(
            f"SELECT product_id FROM warehouse_inventory "
            f"WHERE (warehouse_id = ? OR warehouse_partner_id = ?) "
            f"AND product_id IN ({placeholders})",
            [offer['warehouse_id'], offer['warehouse_id']] + list(eligible_ids),
        ).fetchall()
        eligible_ids = {str(r['product_id']) for r in rows}

    if offer['applicable_on'] == 'product':
        applicable_ids = {str(x) for x in json.loads(offer.get('applicable_ids') or '[]')}
        eligible_ids &= applicable_ids
    elif offer['applicable_on'] == 'category':
        applicable_ids = {str(x) for x in json.loads(offer.get('applicable_ids') or '[]')}
        if applicable_ids:
            if not eligible_ids:
                return 0.0
            placeholders = ','.join('?' * len(eligible_ids))
            rows = conn.execute(
                f"SELECT id, category_id FROM products WHERE id IN ({placeholders})",
                list(eligible_ids),
            ).fetchall()
            category_by_product = {str(r['id']): str(r['category_id']) for r in rows}
            eligible_ids = {pid for pid in eligible_ids if category_by_product.get(pid) in applicable_ids}

    if not eligible_ids:
        return 0.0

    return sum(subtotal for pid, subtotal in product_subtotals.items() if pid in eligible_ids)


def calculate_discount(offer, cart_total, product_ids, conn=None, items=None):
    """Computes the discount an offer grants on a cart.

    Multi-vendor scoping (additive, existing logic untouched):
      - Warehouse offers (``warehouse_id`` set) only apply to carts that
        contain at least one product stocked by that warehouse.
      - Product/category offers only discount the value of the eligible items
        (``items`` with per-item prices), never other stores' products.
      - Category offers (``applicable_on == 'category'``) only apply when the
        cart contains products belonging to one of the targeted categories
        (this was previously accepted but never filtered).
    """
    close_conn = conn is None
    if conn is None:
        conn = get_db()
    try:
        product_ids = [str(pid) for pid in (product_ids or [])]

        if offer.get('warehouse_id'):
            if not product_ids:
                return 0
            placeholders = ','.join('?' * len(product_ids))
            rows = conn.execute(
                f"SELECT product_id FROM warehouse_inventory "
                f"WHERE (warehouse_id = ? OR warehouse_partner_id = ?) "
                f"AND product_id IN ({placeholders})",
                [offer['warehouse_id'], offer['warehouse_id']] + product_ids
            ).fetchall()
            warehouse_product_ids = {str(row['product_id']) for row in rows}
            if not any(pid in warehouse_product_ids for pid in product_ids):
                return 0

        if offer['applicable_on'] == 'product':
            applicable_ids = json.loads(offer.get('applicable_ids') or '[]')
            # Eligibility gate: at least one cart product must be targeted.
            has_applicable = any(str(pid) in [str(x) for x in applicable_ids] for pid in product_ids)
            if not has_applicable:
                return 0
        elif offer['applicable_on'] == 'category':
            applicable_ids = json.loads(offer.get('applicable_ids') or '[]')
            if applicable_ids and product_ids:
                placeholders = ','.join('?' * len(product_ids))
                rows = conn.execute(
                    f"SELECT id, category_id FROM products WHERE id IN ({placeholders})",
                    product_ids
                ).fetchall()
                cart_category_ids = {str(row['category_id']) for row in rows}
                if not any(str(cid) in cart_category_ids for cid in applicable_ids):
                    return 0

        # Discount base: the value of ONLY the eligible items (fair multi-vendor).
        base = _eligible_subtotal(offer, items, cart_total, conn)
        if base <= 0:
            return 0
    finally:
        if close_conn:
            conn.close()

    # Calculate amount
    discount = 0
    if offer['discount_type'] == 'percentage':
        discount = (base * offer['discount_value']) / 100
    elif offer['discount_type'] == 'flat':
        discount = offer['discount_value']
        
    if offer['max_discount_amount'] and discount > offer['max_discount_amount']:
        discount = offer['max_discount_amount']
        
    return min(discount, base)

@offer_bp.route('/api/offers/validate-coupon', methods=['POST'])
@token_required
def validate_coupon():
    data = request.json
    coupon_code = data.get('coupon_code', '').strip().upper()
    cart_total = float(data.get('cart_total', 0))
    user_id = (request.user or {}).get('user_id')
    product_ids = data.get('product_ids', [])
    items = data.get('items')  # [{product_id, price, quantity}] — for fair multi-vendor discount base
    
    if not coupon_code:
        return error_response("Coupon code is required")
        
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM offers WHERE coupon_code = ? AND offer_type = 'coupon'", (coupon_code,))
    offer = cursor.fetchone()
    
    if not offer:
        conn.close()
        return error_response("Invalid coupon code")
        
    offer = dict(offer)
    
    if not offer['is_active']:
        conn.close()
        return error_response("This coupon is no longer active")
        
    if offer['end_date']:
        try:
            end_date = datetime.strptime(offer['end_date'], '%Y-%m-%d %H:%M:%S')
            if datetime.now() > end_date:
                conn.close()
                return error_response("This coupon has expired")
        except: pass
        
    if offer['start_date']:
        try:
            start_date = datetime.strptime(offer['start_date'], '%Y-%m-%d %H:%M:%S')
            if datetime.now() < start_date:
                conn.close()
                return error_response("This coupon is not active yet")
        except: pass
        
    if offer['min_order_amount'] and cart_total < offer['min_order_amount']:
        conn.close()
        return error_response(f"Minimum order amount of ₹{offer['min_order_amount']} required")
        
    if offer['usage_limit'] and offer['usage_count'] >= offer['usage_limit']:
        conn.close()
        return error_response("Coupon usage limit reached")
        
    if offer['target_type'] == 'specific_user':
        applicable_ids = json.loads(offer.get('applicable_ids') or '[]')
        if str(user_id) not in [str(x) for x in applicable_ids]:
            conn.close()
            return error_response("Coupon is not applicable for your account")
            
    # Check per user limit
    cursor.execute("SELECT COUNT(*) FROM offer_usage WHERE offer_id = ? AND user_id = ?", (offer['id'], user_id))
    user_usage = cursor.fetchone()[0]
    
    if offer['per_user_limit'] and user_usage >= offer['per_user_limit']:
        conn.close()
        return error_response("You have already used this coupon maximum allowed times")
        
    discount = calculate_discount(offer, cart_total, product_ids, conn, items)
    
    if discount == 0:
        conn.close()
        return error_response("Coupon not applicable to items in your cart")
        
    conn.close()
    return success_response({
        "valid": True,
        "discount_amount": discount,
        "offer_id": offer['id'],
        "title": offer['title'],
        "message": f"Coupon {coupon_code} applied: ₹{discount} off"
    }, "Coupon applied successfully")

@offer_bp.route('/api/offers/apply-automatic', methods=['POST'])
@token_required
def apply_automatic():
    data = request.json
    cart_total = float(data.get('cart_total', 0))
    user_id = (request.user or {}).get('user_id')
    product_ids = data.get('product_ids', [])
    items = data.get('items')  # [{product_id, price, quantity}] — for fair multi-vendor discount base
    
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT * FROM offers 
        WHERE offer_type IN ('automatic', 'seasonal', 'daily')
        AND is_active = 1
        AND (start_date IS NULL OR start_date <= datetime('now', 'localtime'))
        AND (end_date IS NULL OR end_date >= datetime('now', 'localtime'))
        AND (usage_limit IS NULL OR usage_count < usage_limit)
        AND min_order_amount <= ?
    """, (cart_total,))
    
    offers = [dict(row) for row in cursor.fetchall()]
    
    applicable_offers = []
    best_offer = None
    max_discount = 0
    
    for offer in offers:
        if offer['target_type'] == 'specific_user':
            applicable_ids = json.loads(offer.get('applicable_ids') or '[]')
            if str(user_id) not in [str(x) for x in applicable_ids]:
                continue
                
        cursor.execute("SELECT COUNT(*) FROM offer_usage WHERE offer_id = ? AND user_id = ?", (offer['id'], user_id))
        user_usage = cursor.fetchone()[0]
        if offer['per_user_limit'] and user_usage >= offer['per_user_limit']:
            continue
            
        discount = calculate_discount(offer, cart_total, product_ids, conn, items)
        if discount > 0:
            offer_data = {
                "offer_id": offer['id'],
                "title": offer['title'],
                "discount_amount": discount
            }
            applicable_offers.append(offer_data)
            
            if discount > max_discount:
                max_discount = discount
                best_offer = offer_data
                
    conn.close()
    
    # We only apply the highest discount
    final_discount = max_discount
    applied_offer = best_offer
    
    return success_response({
        "applicable_offers": applicable_offers,
        "applied_offer": applied_offer,
        "total_discount": final_discount
    }, "Automatic offers evaluated")

@offer_bp.route('/api/offers/record-usage', methods=['POST'])
@token_required
def record_usage():
    data = request.get_json(silent=True) or {}
    try:
        offer_id = int(data.get('offer_id'))
        order_id = int(data.get('order_id'))
    except (TypeError, ValueError):
        return error_response("offer_id and order_id are required")

    # H4 fix: never trust a client-supplied user_id - derive it from the token.
    user_id = (request.user or {}).get('user_id')
    if not user_id:
        return error_response("Unauthorized", 401)

    conn = get_db()
    cursor = conn.cursor()

    # Verify the order belongs to the authenticated user.
    cursor.execute("SELECT user_id, total_amount FROM orders WHERE id = ?", (order_id,))
    order_row = cursor.fetchone()
    if not order_row:
        conn.close()
        return error_response("Order not found", 404)
    if int(order_row['user_id']) != int(user_id):
        conn.close()
        return error_response("Order does not belong to this user", 403)

    # Idempotent: if usage was already recorded for this order (e.g. by checkout
    # during order placement), do not double-count.
    cursor.execute("SELECT id FROM offer_usage WHERE order_id = ?", (order_id,))
    if cursor.fetchone():
        conn.close()
        return success_response(None, "Offer usage recorded successfully")

    cursor.execute("SELECT * FROM offers WHERE id = ? AND is_active = 1", (offer_id,))
    offer_row = cursor.fetchone()
    if not offer_row:
        conn.close()
        return error_response("Offer not found or inactive", 400)
    offer = dict(offer_row)

    # Re-validate limits server-side.
    if offer.get('usage_limit') and int(offer.get('usage_count') or 0) >= int(offer['usage_limit']):
        conn.close()
        return error_response("Offer usage limit reached", 400)
    cursor.execute(
        "SELECT COUNT(*) FROM offer_usage WHERE offer_id = ? AND user_id = ?",
        (offer_id, user_id),
    )
    if cursor.fetchone()[0] >= int(offer.get('per_user_limit') or 1):
        conn.close()
        return error_response("Offer already used by this user", 400)

    # H4 fix: recompute the discount server-side from the order items and the
    # offer; a client-supplied discount amount is never trusted.
    cursor.execute(
        "SELECT product_id, quantity, price FROM order_items WHERE order_id = ?",
        (order_id,),
    )
    item_rows = cursor.fetchall()
    if not item_rows:
        conn.close()
        return error_response("Order has no items", 400)
    product_ids = []
    cart_total = 0.0
    order_items = []
    for row in item_rows:
        product_ids.append(row['product_id'])
        item_total = float(row['price']) * int(row['quantity'])
        cart_total += item_total
        order_items.append({
            'product_id': row['product_id'],
            'price': float(row['price']),
            'quantity': int(row['quantity']),
        })
    computed = calculate_discount(offer, cart_total, product_ids, conn, order_items) or 0
    discount_applied = round(min(float(computed), float(order_row['total_amount'] or 0)), 2)
    if discount_applied <= 0:
        conn.close()
        return success_response(None, "No discount to record")

    try:
        cursor.execute(
            "INSERT INTO offer_usage (offer_id, user_id, order_id, discount_applied) VALUES (?, ?, ?, ?)",
            (offer_id, user_id, order_id, discount_applied),
        )
        cursor.execute(
            "UPDATE offers SET usage_count = usage_count + 1 WHERE id = ? AND (usage_limit IS NULL OR usage_count < usage_limit)",
            (offer_id,),
        )
        if cursor.rowcount == 0:
            raise ValueError("Offer usage limit reached")
        conn.commit()
    except Exception:
        conn.rollback()
        conn.close()
        return error_response("Unable to record offer usage", 400)

    conn.close()
    return success_response(None, "Offer usage recorded successfully")

# ==============================================================================
# ADMIN APIs
# ==============================================================================

@offer_bp.route('/api/admin/offers', methods=['GET'])
@require_admin()
def admin_get_offers():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM offers ORDER BY created_at DESC")
    offers = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    for offer in offers:
        if offer.get('applicable_ids'):
            try:
                offer['applicable_ids'] = json.loads(offer['applicable_ids'])
            except:
                offer['applicable_ids'] = []
                
    return success_response(offers, "Offers retrieved")

@offer_bp.route('/api/admin/offers', methods=['POST'])
@require_admin()
def admin_create_offer():
    data = request.json
    
    title = data.get('title')
    offer_type = data.get('offer_type', 'coupon')
    discount_type = data.get('discount_type', 'percentage')
    discount_value = data.get('discount_value', 0)
    coupon_code = data.get('coupon_code')
    
    if offer_type == 'coupon' and not coupon_code:
        return error_response("coupon_code is required for coupon offers")
        
    conn = get_db()
    cursor = conn.cursor()
    
    if coupon_code:
        cursor.execute("SELECT id FROM offers WHERE coupon_code = ?", (coupon_code,))
        if cursor.fetchone():
            conn.close()
            return error_response("Coupon code already exists")
            
    applicable_ids = data.get('applicable_ids', [])
    applicable_ids_json = json.dumps(applicable_ids) if applicable_ids else None
    
    cursor.execute("""
        INSERT INTO offers (
            title, description, offer_type, discount_type, discount_value,
            min_order_amount, max_discount_amount, target_type, applicable_on,
            applicable_ids, coupon_code, usage_limit, per_user_limit,
            start_date, end_date, is_active, banner_image
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        title, data.get('description'), offer_type, discount_type, discount_value,
        data.get('min_order_amount', 0), data.get('max_discount_amount'),
        data.get('target_type', 'all'), data.get('applicable_on', 'all'),
        applicable_ids_json, coupon_code, data.get('usage_limit'),
        data.get('per_user_limit', 1), data.get('start_date'), data.get('end_date'),
        data.get('is_active', 1), data.get('banner_image')
    ))
    
    offer_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return success_response({"id": offer_id}, "Offer created successfully")

@offer_bp.route('/api/admin/offers/<int:offer_id>', methods=['PUT'])
@require_admin()
def admin_update_offer(offer_id):
    data = request.json
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT id FROM offers WHERE id = ?", (offer_id,))
    if not cursor.fetchone():
        conn.close()
        return error_response("Offer not found", 404)
        
    applicable_ids = data.get('applicable_ids', [])
    applicable_ids_json = json.dumps(applicable_ids) if applicable_ids else None
    
    cursor.execute("""
        UPDATE offers SET
            title = ?, description = ?, offer_type = ?, discount_type = ?, discount_value = ?,
            min_order_amount = ?, max_discount_amount = ?, target_type = ?, applicable_on = ?,
            applicable_ids = ?, coupon_code = ?, usage_limit = ?, per_user_limit = ?,
            start_date = ?, end_date = ?, is_active = ?, banner_image = ?
        WHERE id = ?
    """, (
        data.get('title'), data.get('description'), data.get('offer_type'), data.get('discount_type'),
        data.get('discount_value'), data.get('min_order_amount', 0), data.get('max_discount_amount'),
        data.get('target_type', 'all'), data.get('applicable_on', 'all'), applicable_ids_json,
        data.get('coupon_code'), data.get('usage_limit'), data.get('per_user_limit', 1),
        data.get('start_date'), data.get('end_date'), data.get('is_active', 1),
        data.get('banner_image'), offer_id
    ))
    
    conn.commit()
    conn.close()
    
    return success_response(None, "Offer updated successfully")

@offer_bp.route('/api/admin/offers/<int:offer_id>', methods=['DELETE'])
@require_admin()
def admin_delete_offer(offer_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM offer_usage WHERE offer_id = ?", (offer_id,))
    cursor.execute("DELETE FROM offers WHERE id = ?", (offer_id,))
    conn.commit()
    conn.close()
    return success_response(None, "Offer deleted successfully")

@offer_bp.route('/api/admin/offers/<int:offer_id>/upload-banner', methods=['POST'])
@require_admin()
def admin_upload_banner(offer_id):
    if 'file' not in request.files:
        return error_response("No file provided")
    file = request.files['file']
    if file.filename == '':
        return error_response("No file selected")
        
    banner_url = None
    
    # 1. Try uploading to persistent cloud storage first
    try:
        from services.cloud_image_service import upload_file_object_to_cloud
        cloud_url = upload_file_object_to_cloud(file)
        if cloud_url:
            logger.info(f"Successfully uploaded offer banner to cloud: {cloud_url}")
            banner_url = cloud_url
    except Exception as e:
        logger.error(f"Cloud upload failed inside admin_upload_banner: {str(e)}")

    # 2. Fallback to Base64 Data URL to store directly in Turso if cloud upload fails/is blocked
    if not banner_url:
        try:
            import base64
            file_data = file.read()
            file.seek(0)
            encoded = base64.b64encode(file_data).decode('utf-8')
            mime_type = file.mimetype or "image/jpeg"
            banner_url = f"data:{mime_type};base64,{encoded}"
            logger.info("Successfully fell back to Base64 Data URL for offer banner persistent storage in Turso.")
        except Exception as ex:
            logger.error(f"Base64 fallback failed for offer banner: {str(ex)}")
            return error_response("Cloud upload and Base64 fallback both failed", 500)
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE offers SET banner_image = ? WHERE id = ?", (banner_url, offer_id))
    conn.commit()
    conn.close()
    
    return success_response({"banner_url": banner_url}, "Banner uploaded successfully")
