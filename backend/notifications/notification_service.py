import json
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(BASE_DIR)

# Use the app-wide Turso-aware connection helper so in-app notifications land
# in the SAME database the API reads from (production Turso) and therefore
# appear in the user's notification panel. Falls back to a local SQLite file
# only if the helper cannot be imported.
try:
    from database import get_db as _app_get_db
    _HAS_APP_DB = True
except ImportError:
    _HAS_APP_DB = False
    import sqlite3
    DATABASE_PATH = os.path.join(BASE_DIR, 'jdlx.db')

# --- Pure Web Push (VAPID) — no Firebase required ---
# Generate a keypair once and keep it stable across deploys:
#   npx web-push generate-vapid-keys
# Then set in backend/.env:
#   VAPID_PRIVATE_KEY=<base64url private key>
#   VAPID_SUBJECT=mailto:admin@your-domain.com
# The matching PUBLIC key goes in frontend-store/.env as VITE_VAPID_PUBLIC_KEY.
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:admin@jdlxmobile.in").strip()

try:
    from pywebpush import webpush as _pywebpush, WebPushException
    _HAS_PYWEBPUSH = True
except ImportError:
    _HAS_PYWEBPUSH = False

VAPID_ENABLED = bool(_HAS_PYWEBPUSH and VAPID_PRIVATE_KEY)
if not VAPID_ENABLED:
    print("[PUSH WARNING] VAPID_PRIVATE_KEY not set (or pywebpush missing). Push notifications will be simulated.")


def _send_web_push(subscription_row, title, message, url="/"):
    """Sends one VAPID web push to a subscription. Returns 'sent' | 'gone' | 'failed'."""
    if not VAPID_ENABLED:
        return "failed"
    try:
        _pywebpush(
            subscription_info={
                "endpoint": subscription_row["endpoint"],
                "keys": {
                    "p256dh": subscription_row["p256dh"],
                    "auth": subscription_row["auth"],
                },
            },
            data=json.dumps({"title": title, "body": message, "url": url}),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_SUBJECT},
            timeout=15,
        )
        return "sent"
    except WebPushException as e:
        # 410/404 = the browser unsubscribed / endpoint is dead → clean it up.
        status = getattr(e, "response", None)
        code = getattr(status, "status_code", None)
        if code in (404, 410):
            return "gone"
        print(f"[PUSH ERROR] webpush failed (HTTP {code}): {e}")
        return "failed"
    except Exception as e:
        print(f"[PUSH ERROR] webpush exception: {e}")
        return "failed"


class NotificationService:
    def __init__(self):
        pass

    def _get_db(self):
        if _HAS_APP_DB:
            return _app_get_db()
        conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        return conn

    def notify_user_internal(self, user_id, title, message, type='SYSTEM', url="/"):
        """
        Persists a notification to the database and sends a VAPID web push.
        """
        try:
            print(f"[NOTIFY DEBUG] Attempting to notify User {user_id}: {title}")
            conn = self._get_db()
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO notifications (user_id, title, message, type)
                VALUES (?, ?, ?, ?)
            ''', (user_id, title, message, type))
            conn.commit()

            # Fetch web push (VAPID) subscriptions for this user
            cursor.execute(
                "SELECT endpoint, p256dh, auth FROM web_push_subscriptions WHERE user_id = ?",
                (user_id,),
            )
            subs = cursor.fetchall()
            conn.close()

            sent = 0
            if subs and VAPID_ENABLED:
                for sub in subs:
                    result = _send_web_push(sub, title, message, url)
                    if result == "sent":
                        sent += 1
                    elif result == "gone":
                        try:
                            conn2 = self._get_db()
                            cur2 = conn2.cursor()
                            cur2.execute("DELETE FROM web_push_subscriptions WHERE endpoint = ?", (sub["endpoint"],))
                            conn2.commit()
                            conn2.close()
                        except Exception as e:
                            print(f"[PUSH ERROR] failed to remove dead subscription: {e}")
                print(f"[PUSH SUCCESS] Sent {sent}/{len(subs)} web pushes to User {user_id}.")
            else:
                print(f"[PUSH SIMULATED] To User {user_id}: {title} (subscriptions: {len(subs)}, vapid: {VAPID_ENABLED})")

            return True
        except Exception as e:
            print(f"[NOTIFY ERROR] Failed to insert/send notification for User {user_id}: {e}")
            return False

    def send_push_notification(self, tokens, title, message):
        """Kept for backward compatibility — tokens here are legacy FCM tokens,
        which are no longer delivered (Firebase removed). In-app notifications
        still work; web push uses notify_user_internal()."""
        if not tokens:
            return
        print(f"[PUSH INFO] Ignoring {len(tokens)} legacy FCM token(s) — VAPID web push is used instead.")

    def send_order_notification(self, user_id, order_id, status):
        """
        Sends status-specific notifications for orders using database templates.
        """
        # Mapping statuses to template keys
        status_tpl_map = {
            'PLACED': 'order_placed_app',
            'PACKING': 'order_packing_app',
            'OUT_FOR_DELIVERY': 'order_out_delivery_app',
            'DELIVERED': 'order_delivered_app',
        }

        tpl_key = status_tpl_map.get(status)

        if tpl_key:
            try:
                conn = self._get_db()
                cursor = conn.cursor()
                cursor.execute("SELECT title, message, is_active FROM notification_templates WHERE template_key = ?", (tpl_key,))
                tpl = cursor.fetchone()
                conn.close()

                if tpl and tpl['is_active']:
                    title = tpl['title'].format(order_id=order_id)
                    message = tpl['message'].format(order_id=order_id)
                    return self.notify_user_internal(user_id, title, message, 'ORDER', url=f"/order-tracking/{order_id}")
            except Exception as e:
                print(f"Error fetching template for {status}: {e}")

        # Fallback to hardcoded messages if template not found or error
        messages = {
            'PLACED': f"Your order #{order_id} has been placed successfully!",
            'PACKING': f"We are packing your items for order #{order_id}.",
            'READY_FOR_PICKUP': f"Order #{order_id} is ready for pickup!",
            'OUT_FOR_DELIVERY': f"Order #{order_id} is out for delivery! Track it live.",
            'DELIVERED': f"Order #{order_id} has been delivered. Enjoy!",
            'PENDING_PAYMENT': f"Complete your payment for order #{order_id} to confirm.",
            'CANCELLED': f"Your order #{order_id} has been cancelled."
        }

        msg = messages.get(status, f"Update on your order #{order_id}")
        return self.notify_user_internal(user_id, "Order Update", msg, 'ORDER', url=f"/order-tracking/{order_id}")

    def send_offer_notification(self, user_id, title, message):
        """
        Sends promotional offers.
        """
        return self.notify_user_internal(user_id, title, message, 'OFFER')


notification_service = NotificationService()
