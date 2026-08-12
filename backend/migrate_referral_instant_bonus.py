"""Backfill: credit the ₹10 instant referral signup bonus to EXISTING referrals.

Rules (match the new instant-bonus flow):
- Only referrals that have NOT received the instant bonus yet are credited
  (status = 'pending' AND instant_bonus_given != 1). Users who already got
  their full reward (status = 'completed') receive NOTHING extra.
- Both sides of the referral get ₹10: the referrer and the referred user.
- Idempotent: rows already marked instant_bonus_given = 1 (or that already have
  a REF_INSTANT_* wallet transaction) are skipped, so re-running is safe.

Usage:
    cd backend && python migrate_referral_instant_bonus.py
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from database import get_db
from utils.wallet import add_wallet_credit

INSTANT_BONUS = 10.0


def migrate():
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

    credited = 0
    skipped = 0

    def already_credited(user_id, reference_id):
        """True if this user already has the instant-bonus ledger entry."""
        cursor.execute(
            "SELECT COUNT(*) FROM wallet_transactions WHERE user_id = ? AND reference_id = ?",
            (user_id, reference_id),
        )
        return cursor.fetchone()[0] > 0

    for row in rows:
        referral_id = row['id'] if hasattr(row, 'keys') else row[0]
        referrer_id = row['referrer_id'] if hasattr(row, 'keys') else row[1]
        referred_id = row['referred_id'] if hasattr(row, 'keys') else row[2]
        reference_id = f"REF_INSTANT_{referral_id}"

        # Per-side ledger check: each user is credited independently, so a
        # partial failure on one side never blocks the other side.
        ref_ok = already_credited(referrer_id, reference_id) or add_wallet_credit(
            referrer_id, INSTANT_BONUS, "Referral Signup Bonus (Referrer)", reference_id
        )
        refd_ok = already_credited(referred_id, reference_id) or add_wallet_credit(
            referred_id, INSTANT_BONUS, "Referral Signup Bonus (Referred)", reference_id
        )

        if ref_ok and refd_ok:
            cursor.execute("UPDATE referrals SET instant_bonus_given = 1 WHERE id = ?", (referral_id,))
            credited += 1
            print(f"  [ok] referral #{referral_id}: referrer #{referrer_id} + referred #{referred_id} got ₹{INSTANT_BONUS} each")
        else:
            skipped += 1
            print(f"  [skip] referral #{referral_id}: wallet credit failed on one side, left for manual review")

    conn.commit()
    conn.close()

    print(f"\nDONE: {credited} pending referral(s) credited ₹{INSTANT_BONUS} to both users. "
          f"{skipped} skipped (already credited / error).")
    print("Note: completed referrals already received their full reward and were untouched.")


if __name__ == "__main__":
    migrate()
