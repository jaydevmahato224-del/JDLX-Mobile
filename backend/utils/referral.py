import os
import sys
import random
import string
from datetime import datetime

# Add parent directory to path to import database and wallet utils
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from database import get_db
from utils.wallet import add_wallet_credit

def generate_referral_code(user_id):
    """Generates a unique referral code: JD + 6 random uppercase alphanumeric characters."""
    chars = string.ascii_uppercase + string.digits
    suffix = ''.join(random.choice(chars) for _ in range(6))
    return f"JD{suffix}"

def get_or_create_referral_code(user_id):
    """Retrieves the user's referral code or generates one if it doesn't exist."""
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT referral_code FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        
        # Correctly access referral_code based on Row type
        code = None
        if row:
            if hasattr(row, '__getitem__') and 'referral_code' in row.keys():
                code = row['referral_code']
            else:
                code = row[0]
        
        if code:
            return code
            
        # Generate and save new code
        new_code = generate_referral_code(user_id)
        # Ensure uniqueness
        while True:
            cursor.execute("SELECT id FROM users WHERE referral_code = ?", (new_code,))
            if not cursor.fetchone():
                break
            new_code = generate_referral_code(user_id)
            
        cursor.execute("UPDATE users SET referral_code = ? WHERE id = ?", (new_code, user_id))
        conn.commit()
        return new_code
    except Exception as e:
        print(f"Error in get_or_create_referral_code: {e}")
        return None
    finally:
        conn.close()

def apply_referral_code(referred_user_id, code):
    """Validates and applies a referral code to a new user."""
    conn = get_db()
    cursor = conn.cursor()
    try:
        # 1. Validate code exists
        cursor.execute("SELECT id FROM users WHERE referral_code = ?", (code,))
        row = cursor.fetchone()
        if not row:
            return False, "Invalid referral code."
            
        referrer_id = row['id'] if hasattr(row, '__getitem__') and 'id' in row.keys() else row[0]
        
        # 2. Cannot refer self
        if referrer_id == referred_user_id:
            return False, "You cannot refer yourself."
            
        # 3. User must have 0 orders
        cursor.execute("SELECT COUNT(*) FROM orders WHERE user_id = ?", (referred_user_id,))
        order_count_row = cursor.fetchone()
        order_count = order_count_row[0] if order_count_row else 0
        if order_count > 0:
            return False, "Referral codes can only be applied by new users with no orders."
            
        # 4. No existing referral for this user
        cursor.execute("SELECT id FROM referrals WHERE referred_id = ?", (referred_user_id,))
        if cursor.fetchone():
            return False, "A referral code has already been applied to your account."
            
        # 5. Create referral record
        cursor.execute('''
            INSERT INTO referrals (referrer_id, referred_id, referral_code, status)
            VALUES (?, ?, ?, 'pending')
        ''', (referrer_id, referred_user_id, code, ))
        
        conn.commit()
        return True, "Referral code applied successfully!"
    except Exception as e:
        print(f"Error applying referral code: {e}")
        return False, "System error while applying referral code."
    finally:
        conn.close()

def process_referral_reward(order_id, user_id, order_amount):
    """Processes referral rewards if criteria are met (first completed order, amount >= 199)."""
    if order_amount < 199:
        return False
        
    conn = get_db()
    cursor = conn.cursor()
    try:
        # 1. Check if user has exactly 1 order (the current one)
        cursor.execute("SELECT COUNT(*) FROM orders WHERE user_id = ?", (user_id,))
        count_row = cursor.fetchone()
        if not count_row or count_row[0] != 1:
            return False
            
        # 2. Check for pending referral
        cursor.execute('''
            SELECT id, referrer_id FROM referrals 
            WHERE referred_id = ? AND status = 'pending'
        ''', (user_id,))
        referral_row = cursor.fetchone()
        
        if not referral_row:
            return False
            
        referral_id = referral_row['id'] if hasattr(referral_row, '__getitem__') and 'id' in referral_row.keys() else referral_row[0]
        referrer_id = referral_row['referrer_id'] if hasattr(referral_row, '__getitem__') and 'referrer_id' in referral_row.keys() else referral_row[1]
        
        # 3. Process rewards
        # Referrer gets ₹50
        add_wallet_credit(referrer_id, 50.0, "Referral Reward (Referrer)", f"REF_ORD_{order_id}")
        
        # Referred gets ₹30
        add_wallet_credit(user_id, 30.0, "Referral Reward (Referred)", f"REF_ORD_{order_id}")
        
        # 4. Update referral status
        cursor.execute('''
            UPDATE referrals 
            SET status = 'completed', qualifying_order_id = ?, reward_given_at = ?
            WHERE id = ?
        ''', (order_id, datetime.now().isoformat(), referral_id))
        
        conn.commit()
        return True
    except Exception as e:
        print(f"Error processing referral reward: {e}")
        return False
    finally:
        conn.close()
