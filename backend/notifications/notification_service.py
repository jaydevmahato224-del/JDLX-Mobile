import sqlite3
import os

import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATABASE_PATH = os.path.join(BASE_DIR, 'jdlx.db')

class NotificationService:
    def __init__(self):
        pass

    def _get_db(self):
        conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        return conn

    def notify_user_internal(self, user_id, title, message, type='SYSTEM'):
        """
        Persists a notification to the database and simulates a push alert.
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
            conn.close()
            
            # Simulate FCM Push Alert
            print(f"[FCM PUSH SUCCESS] To User {user_id}: {title}")
            return True
        except Exception as e:
            print(f"[NOTIFY ERROR] Failed to insert notification for User {user_id}: {e}")
            return False

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
