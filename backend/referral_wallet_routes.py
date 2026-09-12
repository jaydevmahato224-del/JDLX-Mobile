from flask import Blueprint, jsonify, request, g, current_app
from functools import wraps
import os
import jwt

from jwt_config import get_jwt_secret

from database import get_db
from utils.wallet import get_wallet_balance, get_wallet_transactions, deduct_wallet_balance
from utils.referral import get_or_create_referral_code, apply_referral_code
from auth.role_guard import require_admin

referral_wallet_bp = Blueprint('referral_wallet', __name__)

# token_required decorator — mirrors app.py: resolve the JWT from the
# Authorization header first, then the HttpOnly cookie. Header-first keeps
# admin/API clients safe; the cookie fallback fixes the hard 401 that cookie-only
# sessions used to get on every wallet/referral endpoint.
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        header_token = None
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            header_token = auth_header.split(" ", 1)[1].strip()
        cookie_token = request.cookies.get('token')

        candidates = [t for t in (header_token, cookie_token) if t]
        if not candidates:
            return jsonify({'message': 'Token is missing!'}), 401

        try:
            secret = current_app.config.get('JWT_SECRET') or get_jwt_secret()
            data = None
            for candidate in candidates:
                try:
                    data = jwt.decode(candidate, secret, algorithms=["HS256"])
                    break
                except Exception:
                    data = None
            if not data:
                return jsonify({'message': 'Token is invalid!'}), 401

            user_id = data.get('user_id')
            if not user_id:
                return jsonify({'message': 'Token is invalid!'}), 401

            # Global Logout Check: honour min_token_iat so "logout everywhere"
            # invalidates this token too (same guarantee as app.token_required).
            iat = data.get('iat')
            if iat:
                conn = get_db()
                try:
                    row = conn.execute(
                        "SELECT min_token_iat FROM users WHERE id = ?", (user_id,)
                    ).fetchone()
                finally:
                    conn.close()
                if row and row['min_token_iat'] and iat < row['min_token_iat']:
                    return jsonify({'message': 'Session invalidated. Please login again.'}), 401

            g.user_id = user_id
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

    # Opportunistic settle: if this user's order-triggered reward window has
    # already passed (and the qualifying order is still valid), pay it now so
    # the stats below reflect the freshly-credited reward without waiting for
    # the 30-minute scheduler sweep.
    try:
        from utils.referral import process_due_referral_rewards
        process_due_referral_rewards(user_id=user_id)
    except Exception:
        pass  # never break the referral page

    # Get stats
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM referrals WHERE referrer_id = ?", (user_id,))
    total_referrals = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM referrals WHERE referrer_id = ? AND status = 'completed'", (user_id,))
    completed_referrals = cursor.fetchone()[0]

    # Referrer total is always ₹50 per completed referral (₹10 instant + ₹40
    # after the friend's first order). Pending referrals that already received
    # the instant ₹10 are also counted toward earnings.
    cursor.execute("SELECT COUNT(*) FROM referrals WHERE referrer_id = ? AND status = 'pending' AND instant_bonus_given = 1", (user_id,))
    pending_with_instant = cursor.fetchone()[0]

    # Check if user is already referred
    cursor.execute("SELECT id FROM referrals WHERE referred_id = ?", (user_id,))
    is_referred = cursor.fetchone() is not None

    # Check referral attempts
    cursor.execute("SELECT attempts FROM referral_attempts WHERE user_id = ?", (user_id,))
    att_row = cursor.fetchone()
    attempts = att_row['attempts'] if att_row else 0

    conn.close()
    
    # Referral share link — must land on a REAL storefront route that reads the
    # `ref` param (/login reads ?ref= and carries it into the Google OAuth flow;
    # the old /signup path does not exist in the SPA and silently dropped the
    # code, so shared links never credited anyone).
    frontend_base = os.environ.get("FRONTEND_BASE_URL", "").strip('"').strip("'").rstrip('/')
    if not frontend_base or 'localhost' in frontend_base or '127.0.0.1' in frontend_base:
        frontend_base = "https://jdlx-mobile.vercel.app"
    referral_url = f"{frontend_base}/login?ref={code}"
    
    return jsonify({
        'code': code,
        'referral_url': referral_url,
        'is_referred': is_referred,
        'attempts': attempts,
        'stats': {
            'total': total_referrals,
            'completed': completed_referrals,
            'earnings': completed_referrals * 50 + pending_with_instant * 10
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
    # Normalize input so lowercase/whitespace codes still match (the generated
    # codes are always uppercase, e.g. JD + 6 chars).
    code = (data.get('code') or '').strip().upper()
    
    if not code:
        return jsonify({'message': 'Referral code is required.', 'attempts': 0}), 400

    conn = get_db()
    cursor = conn.cursor()
    
    try:
        # 1. Check referral_attempts table
        cursor.execute("SELECT attempts, blocked_at FROM referral_attempts WHERE user_id = ?", (user_id,))
        att_row = cursor.fetchone()
        attempts = att_row['attempts'] if att_row else 0
        
        if attempts >= 3:
            return jsonify({'message': 'Too many invalid attempts. Referral code entry disabled.', 'attempts': attempts}), 403

        # 2. Check user has 0 orders
        cursor.execute("SELECT COUNT(*) FROM orders WHERE user_id = ?", (user_id,))
        order_count = cursor.fetchone()[0]
        if order_count > 0:
            return jsonify({'message': 'Cannot apply code after placing orders', 'attempts': attempts}), 400

        # 3. Check user not already referred
        cursor.execute("SELECT id FROM referrals WHERE referred_id = ?", (user_id,))
        if cursor.fetchone():
            return jsonify({'message': 'Already used a referral code', 'attempts': attempts}), 400

        # 4. Check code exists
        cursor.execute("SELECT id FROM users WHERE referral_code = ?", (code,))
        ref_user_row = cursor.fetchone()
        if not ref_user_row:
            # Increment attempts on failure (brute-force protection) and stamp
            # blocked_at the moment the user reaches the 3-attempt limit so the
            # block is traceable.
            new_attempts = attempts + 1
            if att_row:
                cursor.execute("UPDATE referral_attempts SET attempts = ?, blocked_at = CASE WHEN ? >= 3 THEN CURRENT_TIMESTAMP ELSE blocked_at END WHERE user_id = ?", (new_attempts, new_attempts, user_id))
            else:
                cursor.execute("INSERT INTO referral_attempts (user_id, attempts, blocked_at) VALUES (?, ?, CASE WHEN ? >= 3 THEN CURRENT_TIMESTAMP ELSE NULL END)", (user_id, new_attempts, new_attempts))
            conn.commit()
            return jsonify({'message': 'Invalid referral code', 'attempts': new_attempts}), 400
            
        referrer_id = ref_user_row['id']

        # 5. Check not self-referral
        if referrer_id == user_id:
            return jsonify({'message': 'Cannot use your own referral code', 'attempts': attempts}), 400

        # 6. Call existing apply_referral_code()
        # We've already done most checks, but calling this to maintain consistency and record the entry
        success, message = apply_referral_code(user_id, code)
        
        if success:
            return jsonify({
                'success': True, 
                'message': 'Code applied! ₹10 instantly credited to your wallet. ₹20 more after your first order of ₹199+'
            })
        else:
            return jsonify({'message': message, 'attempts': attempts}), 400

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
    if not order_id or str(order_id).upper() == 'PENDING':
        return jsonify({'message': 'A valid order_id is required.'}), 400

    # Verify the order exists, belongs to this user and is still applicable.
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
        order = cursor.fetchone()
        if not order:
            return jsonify({'message': 'Order not found.'}), 404
        if order['user_id'] != user_id:
            return jsonify({'message': 'This order does not belong to you.'}), 403
        if order['order_status'] != 'PLACED':
            return jsonify({'message': 'Wallet balance can only be applied to a PLACED order.'}), 400

        # Prevent applying wallet balance to the same order more than once.
        cursor.execute(
            "SELECT COUNT(*) FROM wallet_transactions WHERE type = 'debit' AND user_id = ? AND reference_id = ?",
            (user_id, str(order_id))
        )
        if cursor.fetchone()[0] > 0:
            return jsonify({'message': 'Wallet balance already applied to this order.'}), 400
    finally:
        conn.close()
        
    success = deduct_wallet_balance(user_id, amount, f"Applied to Order {order_id}", str(order_id))
    if success:
        return jsonify({'message': 'Wallet balance applied successfully.'})
    else:
        return jsonify({'message': 'Insufficient wallet balance or error.'}), 400

@referral_wallet_bp.route('/api/admin/referrals', methods=['GET'])
@token_required
@require_admin()
def admin_referrals():
    conn = get_db()
    cursor = conn.cursor()
    # Enriched: both users' emails, the reward lifecycle flags and the
    # qualifying order amount/status so admins can audit every referral.
    cursor.execute('''
        SELECT r.*,
               u1.name as referrer_name, u1.email as referrer_email,
               u2.name as referred_name, u2.email as referred_email,
               o.total_amount as qualifying_order_amount,
               o.order_status as qualifying_order_status
        FROM referrals r
        JOIN users u1 ON r.referrer_id = u1.id
        JOIN users u2 ON r.referred_id = u2.id
        LEFT JOIN orders o ON o.id = r.qualifying_order_id
        ORDER BY r.created_at DESC
    ''')
    rows = cursor.fetchall()
    
    referrals = []
    for row in rows:
        referrals.append(dict(row))
    conn.close()
    
    return jsonify(referrals)

@referral_wallet_bp.route('/api/admin/referral-rewards', methods=['GET'])
@token_required
@require_admin()
def admin_referral_rewards():
    """Full ledger of every referral-related wallet credit: which user received
    how much, when, and why (instant signup bonus vs order-triggered reward).
    """
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            SELECT wt.id, wt.user_id, wt.amount, wt.type, wt.reason,
                   wt.reference_id, wt.created_at,
                   u.name, u.email
            FROM wallet_transactions wt
            JOIN users u ON u.id = wt.user_id
            WHERE wt.reason LIKE 'Referral%'
            ORDER BY wt.created_at DESC, wt.id DESC
            LIMIT 300
        ''')
        rows = cursor.fetchall()
        return jsonify([dict(r) for r in rows])
    except Exception as e:
        print(f"Error in admin_referral_rewards: {e}")
        return jsonify({'message': 'Internal server error'}), 500
    finally:
        conn.close()

@referral_wallet_bp.route('/api/admin/wallet-stats', methods=['GET'])
@token_required
@require_admin()
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


