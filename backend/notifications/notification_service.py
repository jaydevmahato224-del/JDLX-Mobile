import sqlite3
import os
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATABASE_PATH = os.path.join(BASE_DIR, 'jdlx.db')

# Initialize Firebase Admin
try:
    import firebase_admin
    from firebase_admin import credentials, messaging
    # Look for service account in environment or local file
    service_account_path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON") or os.path.join(BASE_DIR, 'firebase-service-account.json')
    if os.path.exists(service_account_path):
        cred = credentials.Certificate(service_account_path)
        firebase_admin.initialize_app(cred)
        FIREBASE_ENABLED = True
    else:
        print("[FIREBASE WARNING] Service account file not found. Push notifications will be simulated.")
        FIREBASE_ENABLED = False
except ImportError:
    print("[FIREBASE WARNING] firebase_admin module not installed. Push notifications will be simulated.")
    FIREBASE_ENABLED = False
except Exception as e:
    print(f"[FIREBASE ERROR] Failed to initialize: {e}")
    FIREBASE_ENABLED = False

class NotificationService:
    def __init__(self):
        pass

    def _get_db(self):
        conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        return conn

    def notify_user_internal(self, user_id, title, message, type='SYSTEM'):
        """
        Persists a notification to the database and sends a push alert via FCM.
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

            # Fetch FCM tokens for this user
            cursor.execute("SELECT fcm_token FROM user_push_tokens WHERE user_id = ?", (user_id,))
            tokens = [row['fcm_token'] for row in cursor.fetchall()]
            conn.close()
            
            if tokens and FIREBASE_ENABLED:
                self.send_push_notification(tokens, title, message)
            else:
                # Simulate FCM Push Alert if not enabled or no tokens
                print(f"[FCM PUSH SIMULATED] To User {user_id}: {title} (Tokens: {len(tokens)})")
            
            return True
        except Exception as e:
            print(f"[NOTIFY ERROR] Failed to insert/send notification for User {user_id}: {e}")
            return False

    def send_push_notification(self, tokens, title, message):
        """Sends FCM push notifications to a list of tokens."""
        if not tokens or not FIREBASE_ENABLED:
            return

        message_obj = messaging.MulticastMessage(
            notification=messaging.Notification(
                title=title,
                body=message,
            ),
            tokens=tokens,
        )
        try:
            response = messaging.send_multicast(message_obj)
            print(f"[FCM PUSH SUCCESS] Sent {response.success_count} messages. {response.failure_count} failed.")
            # Optional: handle invalid tokens (clean up database)
            if response.failure_count > 0:
                pass # Logic to remove invalid tokens could go here
        except Exception as e:
            print(f"[FCM PUSH ERROR] {e}")

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
                    return self.notify_user_internal(user_id, title, message, 'ORDER')
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
        return self.notify_user_internal(user_id, "Order Update", msg, 'ORDER')

    def send_offer_notification(self, user_id, title, message):
        """
        Sends promotional offers.
        """
        return self.notify_user_internal(user_id, title, message, 'OFFER')

notification_service = NotificationService()
