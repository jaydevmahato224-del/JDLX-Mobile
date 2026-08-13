import os
import sys
import random
import string
from datetime import datetime, timedelta

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
    # Normalize so lowercase/whitespace input (direct API calls, shared links)
    # always matches the generated uppercase codes (e.g. JD + 6 chars).
    code = (code or '').strip().upper()
    if not code:
        return False, "Invalid referral code."
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
        referral_id = cursor.lastrowid
        
        conn.commit()
        
        # 6. Instant signup bonus — ₹10 to BOTH users the moment the code is
        # applied (no more waiting for the first order). The remaining reward
        # (₹40 referrer / ₹20 referred) is still paid after the referred user's
        # first order of ₹199+ via process_referral_reward().
        #
        # Tradeoff note: credits commit on their own connections BEFORE the
        # instant_bonus_given flag is set. In the (tiny) crash window between
        # the two, the flag stays 0 and process_referral_reward pays the full
        # legacy ₹50/₹30 — an ₹10/user overpay rather than a user shortfall.
        # Failing on the side of never shortchanging users is intentional.
        instant_bonus = 10.0
        ref_credited = add_wallet_credit(
            referrer_id, instant_bonus,
            "Referral Signup Bonus (Referrer)",
            f"REF_INSTANT_{referral_id}"
        )
        refd_credited = add_wallet_credit(
            referred_user_id, instant_bonus,
            "Referral Signup Bonus (Referred)",
            f"REF_INSTANT_{referral_id}"
        )
        if ref_credited and refd_credited:
            cursor.execute("UPDATE referrals SET instant_bonus_given = 1 WHERE id = ?", (referral_id,))
            conn.commit()
        
        if ref_credited and refd_credited:
            return True, "Referral code applied successfully! ₹10 instantly credited to you and your friend."
        return True, "Referral code applied successfully!"
    except Exception as e:
        print(f"Error applying referral code: {e}")
        return False, "System error while applying referral code."
    finally:
        conn.close()

REFERRAL_REWARD_WINDOW_DAYS = 7


def _get_reward_window_days():
    """Return/exchange/cancellation window (in days) that must pass before the
    order-triggered referral reward is paid out.

    Reads system_settings['referral_reward_window_days'] (so it can be tuned
    alongside the store's return policy) and defaults to 7 — the same 7-day
    window the refund/return flow enforces.
    """
    try:
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT value FROM system_settings WHERE key = 'referral_reward_window_days'"
            ).fetchone()
        finally:
            conn.close()
        if row and row[0]:
            value = int(float(str(row[0]).strip()))
            if value >= 0:
                return value
    except Exception as e:
        print(f"Error reading referral reward window setting: {e}")
    return REFERRAL_REWARD_WINDOW_DAYS


def _row_get(row, key, fallback):
    """Key access that works for sqlite3.Row and LibsqlRow alike."""
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return fallback


def _compute_reward_due_at(order_row):
    """Payout due time = delivery anchor + return/exchange/cancellation window.

    The delivery anchor mirrors the refund flow exactly
    (status_delivered_at or created_at), so the reward becomes payable at the
    same moment the return policy window closes.
    """
    window_days = _get_reward_window_days()
    if window_days == 0:
        # Zero-day policy: payable immediately (still gated by refund-hold).
        return datetime.now().isoformat()
    anchor = None
    if order_row is not None:
        for col in ('status_delivered_at', 'created_at'):
            try:
                val = order_row[col]
            except (KeyError, IndexError, TypeError):
                val = None
            if val:
                anchor = val
                break
    try:
        anchor_dt = datetime.fromisoformat(str(anchor)) if anchor else datetime.now()
    except (ValueError, TypeError):
        anchor_dt = datetime.now()
    return (anchor_dt + timedelta(days=window_days)).isoformat()


def _pay_armed_referral(conn, referral_id, order_id, instant_given, referred_user_id):
    """Credits the order-triggered remainder and marks the referral completed.

    With the instant-bonus split: if the ₹10 signup bonus was already credited
    (instant_bonus_given = 1), the referrer receives the remaining ₹40 and the
    referred user the remaining ₹20. Legacy pending referrals that never got the
    instant bonus receive the full original ₹50 / ₹30 so nobody loses money.

    Concurrency-safe: the referral is atomically CLAIMED first
    (reward_paid 0→1) so two sweeps can never both credit it; if a wallet
    credit then fails the claim is rolled back and the sweep retries later.
    Wallet credits use their own connections (add_wallet_credit); `conn` is
    the caller's connection used for the claim/status updates.
    """
    cursor = conn.cursor()
    if instant_given:
        referrer_reward = 40.0
        referred_reward = 20.0
    else:
        referrer_reward = 50.0
        referred_reward = 30.0

    cursor.execute("SELECT referrer_id FROM referrals WHERE id = ?", (referral_id,))
    row = cursor.fetchone()
    if not row:
        return False
    referrer_id = _row_get(row, 'referrer_id', row[0] if len(row) > 0 else None)
    if referrer_id is None:
        return False

    # Atomic claim — only ONE caller may pay this referral.
    claim = cursor.execute(
        "UPDATE referrals SET reward_paid = 1 WHERE id = ? AND reward_paid = 0", (referral_id,)
    )
    conn.commit()
    if claim.rowcount == 0:
        # Already claimed/paid by a concurrent sweep.
        return False

    ref_ok = add_wallet_credit(referrer_id, referrer_reward, "Referral Reward (Referrer)", f"REF_ORD_{order_id}")
    refd_ok = add_wallet_credit(referred_user_id, referred_reward, "Referral Reward (Referred)", f"REF_ORD_{order_id}")

    if ref_ok and refd_ok:
        cursor.execute('''
            UPDATE referrals
            SET status = 'completed',
                qualifying_order_id = COALESCE(qualifying_order_id, ?),
                reward_given_at = ?
            WHERE id = ?
        ''', (order_id, datetime.now().isoformat(), referral_id))
        conn.commit()
        return True

    # A credit failed — roll back the claim so the sweep retries later instead
    # of permanently marking the reward paid without paying the user.
    cursor.execute("UPDATE referrals SET reward_paid = 0 WHERE id = ?", (referral_id,))
    conn.commit()
    return False


def _is_qualifying_order(user_id, order_id, cursor):
    """True when `order_id` is the user's FIRST qualifying (DELIVERED + ₹199+)
    order. Cancelled/in-transit/sub-threshold orders never count, so they can't
    permanently block the reward. The referral's own status='pending' guard
    prevents double payment."""
    cursor.execute(
        "SELECT COUNT(*) FROM orders WHERE user_id = ? AND order_status = 'DELIVERED' AND total_amount >= 199",
        (user_id,),
    )
    count_row = cursor.fetchone()
    return bool(count_row and count_row[0] == 1)


def process_referral_reward(order_id, user_id, order_amount, settle_now=False):
    """Arms the order-triggered referral reward when an order reaches DELIVERED.

    The payout is NOT made on delivery anymore. Instead the referral is marked
    reward_armed=1 with reward_due_at = delivery anchor + return/exchange/
    cancellation window; the remainder is paid by process_due_referral_rewards()
    only once that window has passed AND the order is still valid (no
    pending/approved refund request).

    settle_now=True forces immediate payout — used when a refund/return request
    was REJECTED, because the user's return/exchange window is then closed and
    the order is definitively theirs.
    """
    if order_amount < 199:
        return False

    conn = get_db()
    cursor = conn.cursor()
    try:
        if not _is_qualifying_order(user_id, order_id, cursor):
            return False

        # Find the pending referral
        cursor.execute('''
            SELECT id, referrer_id, instant_bonus_given, reward_armed, reward_due_at
            FROM referrals
            WHERE referred_id = ? AND status = 'pending'
        ''', (user_id,))
        referral_row = cursor.fetchone()
        if not referral_row:
            return False

        referral_id = _row_get(referral_row, 'id', referral_row[0])
        instant_given = _row_get(referral_row, 'instant_bonus_given', 0)
        reward_armed = _row_get(referral_row, 'reward_armed', 0)

        # Arm the reward (idempotent: the ORIGINAL due date is kept on any
        # re-delivery / status toggle, so the window can never be extended).
        if not reward_armed:
            # SELECT * so environments whose orders table predates the
            # status_delivered_at migration still work (read defensively below).
            order_row = cursor.execute(
                "SELECT * FROM orders WHERE id = ?", (order_id,)
            ).fetchone()
            due_at = _compute_reward_due_at(order_row)
            cursor.execute('''
                UPDATE referrals
                SET reward_armed = 1, reward_due_at = ?,
                    qualifying_order_id = COALESCE(qualifying_order_id, ?)
                WHERE id = ?
            ''', (due_at, order_id, referral_id))
            conn.commit()

        if settle_now:
            # Refund/return REJECTED → the return window is closed for this
            # user, so the reward can be paid right away.
            return _pay_armed_referral(conn, referral_id, order_id, instant_given, user_id)

        # Opportunistic settle: if the window already passed (e.g. a 0-day
        # policy, or a same-request re-arm), pay immediately.
        process_due_referral_rewards(user_id=user_id)
        return True
    except Exception as e:
        print(f"Error arming referral reward: {e}")
        return False
    finally:
        conn.close()


def process_due_referral_rewards(user_id=None):
    """Pays every armed referral reward whose return/exchange/cancellation
    window has passed and whose qualifying order is still valid.

    Called by the scheduler sweep (every 30 min) and opportunistically from
    user-facing referral endpoints. Idempotent: already-paid referrals are
    skipped, and the referral status='pending' guard blocks double payment.

    Returns the number of rewards paid.
    """
    conn = get_db()
    cursor = conn.cursor()
    try:
        now = datetime.now().isoformat()
        query = '''
            SELECT id, referrer_id, referred_id, instant_bonus_given, qualifying_order_id
            FROM referrals
            WHERE status = 'pending' AND reward_armed = 1 AND reward_paid = 0
              AND reward_due_at IS NOT NULL AND reward_due_at <= ?
        '''
        params = [now]
        if user_id is not None:
            query += " AND referred_id = ?"
            params.append(user_id)
        cursor.execute(query, params)
        rows = cursor.fetchall()

        paid = 0
        for referral_row in rows:
            referral_id = _row_get(referral_row, 'id', referral_row[0])
            referred_id = _row_get(referral_row, 'referred_id', referral_row[1])
            instant_given = _row_get(referral_row, 'instant_bonus_given', 0)
            qual_order_id = _row_get(referral_row, 'qualifying_order_id', None)
            if not qual_order_id:
                continue

            order = cursor.execute(
                "SELECT order_status, total_amount FROM orders WHERE id = ?", (qual_order_id,)
            ).fetchone()
            if not order:
                continue
            status = (str(_row_get(order, 'order_status', '') or '')).upper()
            if status not in ('DELIVERED', 'COMPLETED'):
                continue
            amount = float(_row_get(order, 'total_amount', 0) or 0)
            if amount < 199:
                continue

            # Hold the payout while a refund/return/exchange request is pending
            # OR approved — the order isn't final until that policy resolves.
            # UPPER() guards against old-schema rows that store lowercase
            # status values ('rejected' vs 'Rejected').
            hold_row = cursor.execute(
                "SELECT COUNT(*) FROM refund_requests WHERE order_id = ? AND UPPER(status) != 'REJECTED'",
                (qual_order_id,),
            ).fetchone()
            if hold_row and hold_row[0] > 0:
                continue

            if _pay_armed_referral(conn, referral_id, qual_order_id, instant_given, referred_id):
                paid += 1
        return paid
    except Exception as e:
        print(f"Error processing due referral rewards: {e}")
        return 0
    finally:
        conn.close()
