"""Backfill: credit the ₹10 instant referral signup bonus to EXISTING referrals.

Rules (match the new instant-bonus flow):
- Only referrals that have NOT received the instant bonus yet are credited
  (status = 'pending' AND instant_bonus_given != 1). Users who already got
  their full reward (status = 'completed') receive NOTHING extra.
- Both sides of the referral get ₹10: the referrer and the referred user.
- Idempotent: each side is checked against the wallet ledger before crediting,
  and rows already marked instant_bonus_given = 1 are skipped — re-running is
  always safe (it only finishes whatever was left incomplete).
- Robustness: every DB operation uses a FRESH connection (remote Turso streams
  go stale on long-lived connections) and transient errors are retried.

Usage:
    cd backend && python migrate_referral_instant_bonus.py
"""
import os
import sys
import time

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from database import get_db
from utils.wallet import add_wallet_credit

INSTANT_BONUS = 10.0


def _credit_with_retry(user_id, reason, reference_id, attempts=3, delay=2):
    """Credit a user, retrying on transient failures. Returns success bool."""
    for i in range(attempts):
        try:
            if add_wallet_credit(user_id, INSTANT_BONUS, reason, reference_id):
                return True
        except Exception as e:
            print(f"    retryable error ({e})")
        if i < attempts - 1:
            print(f"    retrying credit for user #{user_id} ({i + 2}/{attempts})...")
            time.sleep(delay)
    return False


def _already_credited_with_retry(user_id, reference_id, attempts=3, delay=2):
    """Fresh connection ledger check with retry. Returns True if credited."""
    for i in range(attempts):
        conn = None
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute(
                "SELECT COUNT(*) FROM wallet_transactions WHERE user_id = ? AND reference_id = ?",
                (user_id, reference_id),
            )
            return cur.fetchone()[0] > 0
        except Exception as e:
            print(f"    retryable error ({e})")
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
            conn = None
            if i < attempts - 1:
                print(f"    retrying ledger check for user #{user_id} ({i + 2}/{attempts})...")
                time.sleep(delay)
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
    return False


def _mark_credited_with_retry(referral_id, attempts=3, delay=2):
    """Set instant_bonus_given = 1 on a fresh connection, with retry."""
    for i in range(attempts):
        conn = None
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("UPDATE referrals SET instant_bonus_given = 1 WHERE id = ?", (referral_id,))
            conn.commit()
            return True
        except Exception as e:
            print(f"    retryable error ({e})")
            if i < attempts - 1:
                print(f"    retrying flag update for referral #{referral_id} ({i + 2}/{attempts})...")
                time.sleep(delay)
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
    return False


def migrate():
    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()

        # Ensure the tracking column exists before reading it.
        cursor.execute("PRAGMA table_info(referrals)")
        cols = [r[1] for r in cursor.fetchall()]
        if 'instant_bonus_given' not in cols:
            cursor.execute("ALTER TABLE referrals ADD COLUMN instant_bonus_given INTEGER DEFAULT 0")
            conn.commit()

        cursor.execute("""
            SELECT id, referrer_id, referred_id
            FROM referrals
            WHERE status = 'pending' AND (instant_bonus_given IS NULL OR instant_bonus_given = 0)
            ORDER BY id
        """)
        rows = cursor.fetchall()
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass

    credited = 0
    skipped = 0
    for row in rows:
        referral_id = row['id'] if hasattr(row, 'keys') else row[0]
        referrer_id = row['referrer_id'] if hasattr(row, 'keys') else row[1]
        referred_id = row['referred_id'] if hasattr(row, 'keys') else row[2]
        reference_id = f"REF_INSTANT_{referral_id}"

        print(f"referral #{referral_id}: referrer #{referrer_id} + referred #{referred_id}")

        # Per-side ledger check: each user is credited independently, so a
        # partial failure on one side never blocks the other side.
        ref_ok = _already_credited_with_retry(referrer_id, reference_id)
        if not ref_ok:
            ref_ok = _credit_with_retry(referrer_id, "Referral Signup Bonus (Referrer)", reference_id)

        refd_ok = _already_credited_with_retry(referred_id, reference_id)
        if not refd_ok:
            refd_ok = _credit_with_retry(referred_id, "Referral Signup Bonus (Referred)", reference_id)

        if ref_ok and refd_ok:
            flagged = _mark_credited_with_retry(referral_id)
            if flagged:
                credited += 1
                print(f"  [ok] both sides got ₹{INSTANT_BONUS}")
            else:
                skipped += 1
                print(f"  [warn] credits done but flag update failed — re-run to finish")
        else:
            skipped += 1
            print(f"  [skip] credit failed on one side, left for re-run")

    print(f"\nDONE: {credited} pending referral(s) fully credited ₹{INSTANT_BONUS} to both users. "
          f"{skipped} pending (already credited / error).")
    print("Note: completed referrals already received their full reward and were untouched.")
    print("This script is idempotent — re-run it anytime to finish any incomplete work.")


if __name__ == "__main__":
    migrate()
