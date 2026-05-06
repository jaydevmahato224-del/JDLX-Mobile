import logging
import jwt
from flask import current_app
from notifier import send_low_stock_catchy_email

logger = logging.getLogger(__name__)

def trigger_low_stock_notifications(product_id, new_stock, product_name, get_db, notify_user_internal):
    """
    Finds all users who have the product in their cart and sends catchy 
    low-stock notifications (In-app + Email) using dynamic templates from the database.
    """
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # 1. Fetch Templates from DB
        cursor.execute("SELECT * FROM notification_templates WHERE template_key = ?", ('low_stock_app',))
        app_tpl = cursor.fetchone()
        
        cursor.execute("SELECT * FROM notification_templates WHERE template_key = ?", ('low_stock_email',))
        email_tpl = cursor.fetchone()

        # 2. Find users who have this in their CART (Higher Urgency)
        cursor.execute("""
            SELECT DISTINCT u.id, u.name, u.email, 'cart' as source
            FROM users u
            JOIN cart c ON u.id = c.user_id
            WHERE c.product_id = ?
        """, (product_id,))
        cart_users = cursor.fetchall()
        print(f"[LOW STOCK DEBUG] Found {len(cart_users)} cart users for product {product_id}")
        
        # 3. Find users who have this in their WISHLIST
        cursor.execute("""
            SELECT DISTINCT u.id, u.name, u.email, 'wishlist' as source
            FROM users u
            JOIN wishlist w ON u.id = w.user_id
            WHERE w.product_id = ?
        """, (product_id,))
        wishlist_users = cursor.fetchall()
        print(f"[LOW STOCK DEBUG] Found {len(wishlist_users)} wishlist users for product {product_id}")
        
        # 4. Also notify Warehouse Owners
        cursor.execute("""
            SELECT DISTINCT u.id, u.name, u.email, 'admin' as source
            FROM users u
            JOIN warehouses w ON u.email = w.email
            JOIN warehouse_inventory wi ON w.id = wi.warehouse_id
            WHERE wi.product_id = ?
        """, (product_id,))
        admin_users = cursor.fetchall()
        print(f"[LOW STOCK DEBUG] Found {len(admin_users)} admin users for product {product_id}")

        all_to_notify = []
        seen_ids = set()
        
        # Priority: Admin > Cart > Wishlist
        for u in admin_users:
            if u['id'] not in seen_ids:
                all_to_notify.append(dict(u))
                seen_ids.add(u['id'])
        
        for u in cart_users:
            if u['id'] not in seen_ids:
                all_to_notify.append(dict(u))
                seen_ids.add(u['id'])

        for u in wishlist_users:
            if u['id'] not in seen_ids:
                all_to_notify.append(dict(u))
                seen_ids.add(u['id'])

        for user in all_to_notify:
            user_id = user['id']
            user_name = user['name']
            user_email = user['email']
            source = user['source']
            
            # Check for recent duplicate notifications to prevent spam
            cursor.execute("""
                SELECT COUNT(*) FROM notifications 
                WHERE user_id = ? AND title LIKE ? AND created_at > datetime('now', '-24 hours')
            """, (user_id, f"%{product_name}%"))
            if cursor.fetchone()[0] > 0:
                print(f"[LOW STOCK DEBUG] Skipping {user_name} - already notified about {product_name} recently.")
                continue

            print(f"[LOW STOCK DEBUG] Notifying {user_name} ({user_email}) - Source: {source}")

            # --- A. In-App Notification ---
            notified_app = False
            if source == 'admin':
                notified_app = notify_user_internal(user_id, "🚨 Low Stock Alert", f"Product {product_name} is running low ({new_stock} left). Please restock soon!", type='system')
            elif source == 'cart':
                if app_tpl and app_tpl['is_active']:
                    # Use a very urgent message for cart users
                    title = "🛒 Item in Cart is ALMOST GONE!"
                    message = f"Hurry {user_name}! The {product_name} in your cart has only {new_stock} units left. Buy it now before it sells out! ⚡"
                    notified_app = notify_user_internal(user_id, title, message, type='OFFER')
                else:
                    # Fallback for cart if template is missing
                    notified_app = notify_user_internal(user_id, "🛒 Cart Item Low Stock", f"Hurry! {product_name} in your cart has only {new_stock} left!", type='OFFER')
            elif app_tpl and app_tpl['is_active']:
                try:
                    title = app_tpl['title'].format(product_name=product_name, stock_left=new_stock, user_name=user_name)
                    message = app_tpl['message'].format(product_name=product_name, stock_left=new_stock, user_name=user_name)
                    notified_app = notify_user_internal(user_id, title, message, type='OFFER')
                except:
                    notified_app = notify_user_internal(user_id, "⚠️ Low Stock Alert", f"{product_name} has only {new_stock} left!", type='OFFER')
            else:
                # Absolute fallback
                notified_app = notify_user_internal(user_id, "⚠️ Low Stock Alert", f"{product_name} is running low ({new_stock} left)!", type='SYSTEM')
            
            print(f"[LOW STOCK DEBUG] In-App Notification status for {user_name}: {notified_app}")
            
            # --- B. Email Notification ---
            if user_email:
                try:
                    sent = False
                    if source == 'admin':
                        sent = send_low_stock_catchy_email(
                            user_email, user_name, product_name, new_stock,
                            custom_subject=f"URGENT: Low Stock for {product_name}",
                            custom_message=f"Hello {user_name}, the stock for {product_name} is currently {new_stock}. Please restock to avoid losing sales.",
                            custom_title="Warehouse Alert"
                        )
                    elif source == 'cart':
                        sent = send_low_stock_catchy_email(
                            user_email, user_name, product_name, new_stock,
                            custom_subject=f"⚠️ URGENT: {product_name} is almost SOLD OUT!",
                            custom_message=f"Don't miss out! {product_name} is in your cart and stock just dropped to {new_stock}. Complete your purchase now before someone else grabs it!",
                            custom_title="Cart Alert: Hurry Up!"
                        )
                    elif email_tpl and email_tpl['is_active']:
                        subject = email_tpl['subject'].format(product_name=product_name, stock_left=new_stock, user_name=user_name)
                        body_text = email_tpl['message'].format(product_name=product_name, stock_left=new_stock, user_name=user_name)
                        sent = send_low_stock_catchy_email(user_email, user_name, product_name, new_stock, 
                                                   custom_subject=subject, custom_message=body_text, custom_title=email_tpl['title'])
                    
                    if sent:
                        print(f"[LOW STOCK DEBUG] Email successfully SENT to {user_email}")
                    else:
                        print(f"[LOW STOCK DEBUG] Email function returned FALSE for {user_email}")
                except Exception as ex:
                    print(f"[LOW STOCK DEBUG] Email exception for {user_email}: {ex}")
                
        conn.close()
    except Exception as e:
        logger.error(f"[LOW STOCK TRIGGER ERROR] {e}")
        print(f"[LOW STOCK DEBUG] Trigger Error: {e}")
