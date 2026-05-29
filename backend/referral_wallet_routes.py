import os
from flask import Blueprint, jsonify, request, g
from functools import wraps
import jwt

from database import get_db
from utils.wallet import get_wallet_balance, get_wallet_transactions, deduct_wallet_balance
from utils.referral import get_or_create_referral_code, apply_referral_code
from auth.role_guard import require_admin

referral_wallet_bp = Blueprint('referral_wallet', __name__)

# Basic token_required decorator (standard in this project)
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        if 'Authorization' in request.headers:
            token = request.headers['Authorization'].split(" ")[1]
        
        if not token:
            return jsonify({'message': 'Token is missing!'}), 401
            
        try:
            data = jwt.decode(token, os.environ.get("JWT_SECRET", "jdlx_secret_keys_123"), algorithms=["HS256"])
            g.user_id = data['user_id']
            # Optional: Check if user exists in DB
        except Exception:
            return jsonify({'message': 'Token is invalid!'}), 401
            
        return f(*args, **kwargs)
    return decorated

@referral_wallet_bp.route('/api/wallet/balance', methods=['GET'])
@token_required
def wallet_balance():
    user_id = g.user_id
    balance = get_wallet_balance(user_id)
    transactions = get_wallet_transactions(user_id)
    return jsonify({
        'balance': balance,
        'transactions': transactions
    })

@referral_wallet_bp.route('/api/referral/my-code', methods=['GET'])
@token_required
def my_referral_code():
    user_id = g.user_id
    code = get_or_create_referral_code(user_id)
    
    # Get stats
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM referrals WHERE referrer_id = ?", (user_id,))
    total_referrals = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM referrals WHERE referrer_id = ? AND status = 'completed'", (user_id,))
    completed_referrals = cursor.fetchone()[0]

    # Check if user is already referred
    cursor.execute("SELECT id FROM referrals WHERE referred_id = ?", (user_id,))
    is_referred = cursor.fetchone() is not None

    # Check referral attempts
    cursor.execute("SELECT attempts FROM referral_attempts WHERE user_id = ?", (user_id,))
    att_row = cursor.fetchone()
    attempts = att_row['attempts'] if att_row else 0

    conn.close()
    
    # Base URL for referral (placeholder - usually handled by frontend)
    referral_url = f"https://jdlx-mobile.vercel.app/signup?ref={code}"
    
    return jsonify({
        'code': code,
        'referral_url': referral_url,
        'is_referred': is_referred,
        'attempts': attempts,
        'stats': {
            'total': total_referrals,
            'completed': completed_referrals,
            'earnings': completed_referrals * 50
        }
    })

@referral_wallet_bp.route('/api/referral/apply', methods=['POST'])
@token_required
def apply_code():
    user_id = g.user_id
    data = request.get_json()
    code = data.get('code')
    
    if not code:
        return jsonify({'message': 'Referral code is required.'}), 400
        
    success, message = apply_referral_code(user_id, code)
    if success:
        return jsonify({'message': message})
    else:
        return jsonify({'message': message}), 400

@referral_wallet_bp.route('/api/referral/apply-from-profile', methods=['POST'])
@token_required
def apply_code_from_profile():
    user_id = g.user_id
    data = request.get_json()
    code = data.get('code')
    
    if not code:
        return jsonify({'message': 'Referral code is required.'}), 400

    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # 1. Check referral_attempts table
        cursor.execute("SELECT attempts FROM referral_attempts WHERE user_id = ?", (user_id,))
        att_row = cursor.fetchone()
        attempts = att_row['attempts'] if att_row else 0
        
        if attempts >= 3:
            return jsonify({'message': 'Too many invalid attempts. Referral code entry disabled.'}), 403

        # 2. Check user has 0 orders
        cursor.execute("SELECT COUNT(*) FROM orders WHERE user_id = ?", (user_id,))
        order_count = cursor.fetchone()[0]
        if order_count > 0:
            return jsonify({'message': 'Cannot apply code after placing orders'}), 400

        # 3. Check user not already referred
        cursor.execute("SELECT id FROM referrals WHERE referred_id = ?", (user_id,))
        if cursor.fetchone():
            return jsonify({'message': 'Already used a referral code'}), 400

        # 4. Check code exists
        cursor.execute("SELECT id FROM users WHERE referral_code = ?", (code,))
        ref_user_row = cursor.fetchone()
        if not ref_user_row:
            # Increment attempts on failure
            if att_row:
                cursor.execute("UPDATE referral_attempts SET attempts = attempts + 1 WHERE user_id = ?", (user_id,))
            else:
                cursor.execute("INSERT INTO referral_attempts (user_id, attempts) VALUES (?, 1)", (user_id,))
            conn.commit()
            return jsonify({'message': 'Invalid referral code'}), 400
            
        referrer_id = ref_user_row['id']

        # 5. Check not self-referral
        if referrer_id == user_id:
            return jsonify({'message': 'Cannot use your own referral code'}), 400

        # 6. Call existing apply_referral_code()
        # We've already done most checks, but calling this to maintain consistency and record the entry
        success, message = apply_referral_code(user_id, code)
        
        if success:
            return jsonify({
                'success': true, 
                'message': 'Code applied! ₹30 will be credited after your first order of ₹199+'
            })
        else:
            return jsonify({'message': message}), 400

    except Exception as e:
        print(f"Error in apply_code_from_profile: {e}")
        return jsonify({'message': 'Internal server error'}), 500
    finally:
        conn.close()

@referral_wallet_bp.route('/api/wallet/apply-to-order', methods=['POST'])
@token_required
def apply_wallet_to_order():
    user_id = g.user_id
    data = request.get_json()
    amount = data.get('amount')
    order_id = data.get('order_id', 'PENDING')
    
    if not amount or amount <= 0:
        return jsonify({'message': 'Invalid amount.'}), 400
        
    success = deduct_wallet_balance(user_id, amount, f"Applied to Order {order_id}", order_id)
    if success:
        return jsonify({'message': 'Wallet balance applied successfully.'})
    else:
        return jsonify({'message': 'Insufficient wallet balance or error.'}), 400

@referral_wallet_bp.route('/api/admin/referrals', methods=['GET'])
@token_required
@require_admin
def admin_referrals():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT r.*, u1.name as referrer_name, u2.name as referred_name 
        FROM referrals r
        JOIN users u1 ON r.referrer_id = u1.id
        JOIN users u2 ON r.referred_id = u2.id
        ORDER BY r.created_at DESC
    ''')
    rows = cursor.fetchall()
    
    referrals = []
    for row in rows:
        referrals.append(dict(row))
    conn.close()
    
    return jsonify(referrals)

@referral_wallet_bp.route('/api/admin/wallet-stats', methods=['GET'])
@token_required
@require_admin
def admin_wallet_stats():
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT SUM(balance) FROM wallet")
    total_liability = cursor.fetchone()[0] or 0
    
    cursor.execute("SELECT COUNT(*) FROM wallet WHERE balance > 0")
    active_wallets = cursor.fetchone()[0] or 0
    
    cursor.execute("SELECT SUM(amount) FROM wallet_transactions WHERE type = 'credit'")
    total_credits = cursor.fetchone()[0] or 0
    
    cursor.execute("SELECT SUM(amount) FROM wallet_transactions WHERE type = 'debit'")
    total_debits = cursor.fetchone()[0] or 0
    
    conn.close()
    
    return jsonify({
        'total_liability': total_liability,
        'active_wallets': active_wallets,
        'total_credits': total_credits,
        'total_debits': total_debits
    })
