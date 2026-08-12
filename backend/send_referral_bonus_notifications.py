"""Send ₹10 referral-bonus notifications to backfilled users.

Notifies each user whose referral instant bonus was credited by
migrate_referral_instant_bonus.py. Uses the app's NotificationService so the
notification lands BOTH in the in-app panel (production Turso DB) AND as an
FCM push (when a device token + Firebase service account are configured).

Idempotent: users who already received this exact notification (matching
title within the last 24h) are skipped, so re-running is safe.

Usage:
    cd backend && python send_referral_bonus_notifications.py
"""
import sys

sys.path.append(sys.path[0])
from database import get_db
from notifications.notification_service import notification_service

TITLE = "Referral Bonus Credited 🎉"
MESSAGE = "₹10 has been added to your wallet instantly from your referral! The remaining reward arrives after your first order of ₹199+."


def _credited_user_ids():
    """Users who actually received a REF_INSTANT_* backfill credit."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT DISTINCT user_id FROM wallet_transactions WHERE reference_id LIKE 'REF_INSTANT_%' ORDER BY user_id"
        )
        return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


def _already_notified(user_id):
    """True if this user got the same notification within the last 24h."""
    conn = get_db()
    try:
        cur = conn.cursor()
        # Cutoff computed in SQL (UTC) so it matches SQLite CURRENT_TIMESTAMP
        # regardless of server timezone or string formatting.
        cur.execute(
            "SELECT COUNT(*) FROM notifications WHERE user_id = ? AND title = ? "
            "AND created_at >= strftime('%Y-%m-%d %H:%M:%S', 'now', '-24 hours')",
            (user_id, TITLE),
        )
        return cur.fetchone()[0] > 0
    finally:
        conn.close()


def main():
    notified = 0
    skipped = 0
    for user_id in _credited_user_ids():
        if _already_notified(user_id):
            print(f"[skip] user #{user_id}: already notified in the last 24h")
            skipped += 1
            continue
        ok = notification_service.notify_user_internal(user_id, TITLE, MESSAGE, 'WALLET')
        if ok:
            notified += 1
            print(f"[ok] user #{user_id}: notification sent (in-app + push)")
        else:
            skipped += 1
            print(f"[warn] user #{user_id}: notification failed")

    print(f"\nDONE: {notified} user(s) notified, {skipped} skipped.")


if __name__ == "__main__":
    main()
