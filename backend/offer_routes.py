import os
import json
from datetime import datetime
from functools import wraps
from flask import Blueprint, request, jsonify
from database import get_db
import jwt
from utils.response_utils import success_response, error_response
from auth.role_guard import _current_user_claims, require_admin

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

def calculate_discount(offer, cart_total, product_ids):
    if offer['applicable_on'] == 'product':
        applicable_ids = json.loads(offer.get('applicable_ids') or '[]')
        # Simple implementation: If any product in cart matches, apply discount to whole cart total (subtotal)
        # For stricter product-specific, we'd need item prices, but prompt says "apply on subtotal only"
        has_applicable = any(str(pid) in [str(x) for x in applicable_ids] for pid in product_ids)
        if not has_applicable:
            return 0
            
    # Calculate amount
    discount = 0
    if offer['discount_type'] == 'percentage':
        discount = (cart_total * offer['discount_value']) / 100
    elif offer['discount_type'] == 'flat':
        discount = offer['discount_value']
        
    if offer['max_discount_amount'] and discount > offer['max_discount_amount']:
        discount = offer['max_discount_amount']
        
    return min(discount, cart_total)

@offer_bp.route('/api/offers/validate-coupon', methods=['POST'])
@token_required
def validate_coupon():
    data = request.json
    coupon_code = data.get('coupon_code', '').strip().upper()
    cart_total = float(data.get('cart_total', 0))
    user_id = data.get('user_id') or request.user.get('user_id')
    product_ids = data.get('product_ids', [])
    
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
        
    discount = calculate_discount(offer, cart_total, product_ids)
    
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
    user_id = data.get('user_id') or request.user.get('user_id')
    product_ids = data.get('product_ids', [])
    
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
            
        discount = calculate_discount(offer, cart_total, product_ids)
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
    data = request.json
    offer_id = data.get('offer_id')
    order_id = data.get('order_id')
    discount_applied = data.get('discount_applied', 0)
    user_id = data.get('user_id') or request.user.get('user_id')
    
    if not offer_id or not order_id:
        return error_response("offer_id and order_id are required")
        
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        INSERT INTO offer_usage (offer_id, user_id, order_id, discount_applied)
        VALUES (?, ?, ?, ?)
    """, (offer_id, user_id, order_id, discount_applied))
    
    cursor.execute("UPDATE offers SET usage_count = usage_count + 1 WHERE id = ?", (offer_id,))
    
    conn.commit()
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

    # 2. Fallback to local storage if cloud storage fails or is unconfigured
    if not banner_url:
        logger.warning("Cloud upload failed for offer banner. Falling back to ephemeral local storage.")
        filename = f"offer_banner_{offer_id}_{int(datetime.now().timestamp())}.{file.filename.rsplit('.', 1)[1].lower()}"
        filepath = os.path.join('static', 'images', filename)
        # Ensure directories exist
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        file.save(filepath)
        banner_url = f"/static/images/{filename}"
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE offers SET banner_image = ? WHERE id = ?", (banner_url, offer_id))
    conn.commit()
    conn.close()
    
    return success_response({"banner_url": banner_url}, "Banner uploaded successfully")
