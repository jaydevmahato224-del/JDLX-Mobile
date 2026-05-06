import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

GMAIL_USER = os.environ.get("GMAIL_USER")
GMAIL_PASS = os.environ.get("GMAIL_PASS")

def send_order_email(to_email, order_details):
    msg = MIMEMultipart()
    msg['From'] = GMAIL_USER
    msg['To'] = to_email
    msg['Subject'] = f"JDLX Mobile: Order #{order_details['order_id']} Placed!"

    body = f"""
    <h2>Thank you for your order, {order_details['customer_name']}!</h2>
    <p>Your order for <b>₹{order_details['total_amount']}</b> has been placed successfully.</p>
    <h3>Order Summary:</h3>
    <ul>
        {"".join([f"<li>{item['name']} x {item['qty']} - ₹{item['price'] * item['qty']}</li>" for item in order_details['items']])}
    </ul>
    <p><b>Delivery Address:</b> {order_details['address']}</p>
    <p><b>Estimated Delivery:</b> 30-120 minutes</p>
    <br/>
    <p>Track your order on our app!</p>
    """
    msg.attach(MIMEText(body, 'html'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASS)
        text = msg.as_string()
        server.sendmail(GMAIL_USER, to_email, text)
        server.quit()
        print("Order email sent successfully.")
        return True
    except Exception as e:
        print(f"Failed to send email: {e}")
        return False

def send_warehouse_application_email(to_email, status, owner_name, notes=None):
    msg = MIMEMultipart()
    msg['From'] = GMAIL_USER
    msg['To'] = to_email
    
    if status == "approved":
        msg['Subject'] = "JDLX Mobile: Warehouse Application Approved!"
        body = f"""
        <h2>Congratulations, {owner_name}!</h2>
        <p>Your application to become a JDLX Mobile Warehouse Partner has been <b style="color:green;">Approved</b>.</p>
        <p>You can now log in to the Warehouse Dashboard using your registered email and start receiving orders.</p>
        """
        if notes:
            body += f"<p><b>Admin Notes:</b> {notes}</p>"
    elif status == "rejected":
        msg['Subject'] = "JDLX Mobile: Update on your Warehouse Application"
        body = f"""
        <h2>Dear {owner_name},</h2>
        <p>Thank you for applying to be a JDLX Mobile Warehouse Partner.</p>
        <p>Unfortunately, your application has been <b style="color:red;">Rejected</b> at this time.</p>
        """
        if notes:
            body += f"<p><b>Reason / Admin Notes:</b> {notes}</p>"
        body += "<p>You may correct the issues and apply again.</p>"
    else:
        return False
        
    msg.attach(MIMEText(body, 'html'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASS)
        server.sendmail(GMAIL_USER, to_email, msg.as_string())
        server.quit()
        print(f"Warehouse application email ({status}) sent to {to_email}.")
        return True
    except Exception as e:
        print(f"Failed to send warehouse email: {e}")
        return False

def send_warehouse_registration_confirmation_email(to_email, owner_name, warehouse_name):
    msg = MIMEMultipart()
    msg['From'] = GMAIL_USER
    msg['To'] = to_email
    msg['Subject'] = "JDLX Mobile: Warehouse Application Received!"
    
    body = f"""
    <h2>Thank you for your application, {owner_name}!</h2>
    <p>We have successfully received your request to register <b>{warehouse_name}</b> as a JDLX Mobile Warehouse Partner.</p>
    <p>Our admin team is currently reviewing your application. You will receive another email once your request has been approved or if we need more information.</p>
    <p>We appreciate your interest in partnering with us!</p>
    <br/>
    <p>Best Regards,<br/>JDLX Mobile Team</p>
    """
    msg.attach(MIMEText(body, 'html'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASS)
        server.sendmail(GMAIL_USER, to_email, msg.as_string())
        server.quit()
        print(f"Warehouse registration confirmation email sent to {to_email}.")
        return True
    except Exception as e:
        print(f"Failed to send warehouse registration confirmation email: {e}")
        return False

def send_review_thank_you_email(to_email, user_name, product_name, rating, custom_subject=None, custom_body=None):
    msg = MIMEMultipart()
    msg['From'] = GMAIL_USER
    msg['To'] = to_email
    msg['Subject'] = custom_subject if custom_subject else "Thank you for your review! - JDLX Mobile"

    stars = "★" * rating + "☆" * (5 - rating)
    
    if custom_body:
        # Simple placeholder replacement if body is provided from DB template
        body_content = custom_body.replace('{user_name}', user_name).replace('{product_name}', product_name).replace('{stars}', stars)
        body_content_html = body_content.replace('\n', '<br/>')
        body = f"""
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            {body_content_html}
            <br/><br/>
            <p style="font-size: 12px; color: #9CA3AF;">Best Regards,<br/>JDLX Mobile Team</p>
        </div>
        """
    else:
        body = f"""
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #4F46E5;">Thank you for your feedback, {user_name}!</h2>
            <p>We've received your review for <b>{product_name}</b>.</p>
            <div style="background: #F9FAFB; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0; font-size: 14px; color: #6B7280;">Your Rating:</p>
                <p style="margin: 5px 0 0 0; font-size: 24px; color: #F59E0B;">{stars}</p>
            </div>
            <p>Your reviews help other customers make better choices and help us improve our services.</p>
            <p>We appreciate your contribution to the JDLX community!</p>
            <br/>
            <p style="font-size: 12px; color: #9CA3AF;">Best Regards,<br/>JDLX Mobile Team</p>
        </div>
        """
    msg.attach(MIMEText(body, 'html'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASS)
        server.sendmail(GMAIL_USER, to_email, msg.as_string())
        server.quit()
        return True
    except Exception as e:
        print(f"Failed to send review thank you email: {e}")
        return False

def send_warehouse_kyc_pending_email(to_email, owner_name, warehouse_name):
    msg = MIMEMultipart()
    msg['From'] = GMAIL_USER
    msg['To'] = to_email
    msg['Subject'] = f"JDLX Mobile: KYC Update Required for {warehouse_name}"

    body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 620px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: #0f172a; color: #f8fafc; padding: 18px 22px;">
            <h2 style="margin: 0; font-size: 20px;">Profile Update Required</h2>
        </div>
        <div style="padding: 22px;">
            <p>Hello <b>{owner_name}</b>,</p>
            <p>Your warehouse profile for <b>{warehouse_name}</b> needs KYC updates to continue smooth partner operations.</p>
            <p>Please open the warehouse partner portal and complete the missing KYC documents:</p>
            <ul>
                <li>Store image(s)</li>
                <li>Owner image</li>
                <li>KYC details</li>
                <li>Request message / note</li>
            </ul>
            <p style="margin-top: 18px;">Once submitted, the status will move out of <b>Profile Pending</b> after review.</p>
            <p style="margin-top: 20px; color: #64748b; font-size: 13px;">
                This is an automated compliance notification from JDLX Mobile.
            </p>
        </div>
    </div>
    """
    msg.attach(MIMEText(body, 'html'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASS)
        server.sendmail(GMAIL_USER, to_email, msg.as_string())
        server.quit()
        print(f"[MAIL LOG] Warehouse KYC pending email sent to {to_email}.")
        return True
    except Exception as e:
        print(f"[MAIL ERROR] Failed to send warehouse KYC pending email: {e}")
        return False

def send_delivery_application_email(to_email, status, partner_name, notes=None):
    msg = MIMEMultipart()
    msg['From'] = GMAIL_USER
    msg['To'] = to_email
    
    if status == "approved":
        msg['Subject'] = "JDLX Mobile: Final Approval - Partner Activated!"
        body = f"""
        <h2 style="color: green;">Congratulations, {partner_name}!</h2>
        <p>All stages of your verification are complete. Your JDLX Mobile Delivery Partner account is now <b style="color:green;">Activated</b>.</p>
        <p>You can now log in to the Delivery Portal and start accepting delivery tasks.</p>
        """
        if notes:
            body += f"<div style='background:#f1f5f9; padding: 15px; border-radius: 8px;'><b>Admin Notes:</b> {notes}</div>"

    elif status == "pending_admin":
        msg['Subject'] = "JDLX Mobile: Store Approval Complete - Moved to High Authority"
        body = f"""
        <h2>Good news, {partner_name}!</h2>
        <p>Your local store has <b style="color: #14b8a6;">Approved</b> your application.</p>
        <p>Your request has been <b>sent to the High Authority (Admin Panel)</b> for final verification. Once they authorize your credentials, your account will be activated.</p>
        <p>Please wait for the final onboarding confirmation email.</p>
        """
        
    elif status == "rejected":
        msg['Subject'] = "JDLX Mobile: Update on your Delivery Partner Request"
        body = f"""
        <h2>Dear {partner_name},</h2>
        <p>Thank you for applying to be a JDLX Mobile Delivery Partner.</p>
        <p>Unfortunately, your application has been <b style="color:red;">Rejected</b> at this time.</p>
        """
        if notes:
            body += f"<div style='background:#fef2f2; padding: 15px; border-radius: 8px;'><b>Reason / Notes:</b> {notes}</div>"
        else:
            body += "<p>You may correct the issues and apply again after 24 hours.</p>"
            
    else:
        return False
        
    msg.attach(MIMEText(body, 'html'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASS)
        server.sendmail(GMAIL_USER, to_email, msg.as_string())
        server.quit()
        print(f"Delivery application email ({status}) sent to {to_email}.")
        return True
    except Exception as e:
        print(f"Failed to send delivery email: {e}")
        return False

def send_delivery_registration_confirmation_email(to_email, partner_name):
    msg = MIMEMultipart()
    msg['From'] = GMAIL_USER
    msg['To'] = to_email
    msg['Subject'] = "JDLX Mobile: Delivery Partner Application - 2-Step Verification"
    
    body = f"""
    <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
        <h2 style="color: #0f172a; font-size: 24px; border-bottom: 2px solid #e2e8f0; padding-bottom: 15px;">Application Received, {partner_name}!</h2>
        <p>Your request to join JDLX Mobile as a Delivery Partner has been submitted successfully.</p>
        
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 25px 0;">
            <h3 style="margin-top: 0; color: #475569; font-size: 16px; text-transform: uppercase; letter-spacing: 0.1em;">2-Step Approval Process</h3>
            <ol style="padding-left: 20px;">
                <li style="margin-bottom: 10px;"><b>Stage 1: Store Review</b> - Your selected Dark Store/Warehouse will review your profile for local alignment.</li>
                <li><b>Stage 2: High Authority Verification</b> - Once recommended by the store, our National Admin team will perform final checks and activate your account.</li>
            </ol>
        </div>
        
        <p>Please wait for the local store to complete the first stage of review. You will receive notification status at each step.</p>
        <p>Thank you for choosing JDLX Mobile!</p>
        <br/>
        <p style="color: #64748b; font-size: 12px; border-top: 1px solid #f1f5f9; padding-top: 15px;">
            Best Regards,<br/><b>JDLX Mobile Operations Team</b>
        </p>
    </div>
    """
    msg.attach(MIMEText(body, 'html'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASS)
        server.sendmail(GMAIL_USER, to_email, msg.as_string())
        server.quit()
        print(f"Delivery registration confirmation email sent to {to_email}.")
        return True
    except Exception as e:
        print(f"Failed to send delivery registration email: {e}")
        return False

def send_delivery_welcome_email(to_email, partner_name):
    msg = MIMEMultipart()
    msg['From'] = GMAIL_USER
    msg['To'] = to_email
    msg['Subject'] = "Welcome to the JDLX Mobile Onboarding Experience!"
    
    body = f"""
    <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.6; text-align: center;">
        <h1 style="color: #0f172a; font-size: 28px; margin-bottom: 20px;">Welcome to JDLX Mobile</h1>
        <p style="font-size: 18px; color: #64748b;">Thank you for your interest in becoming a <b>Delivery Partner</b>.</p>
        <p>We are excited about the possibility of you joining our premium logistics network. At JDLX, we prioritize efficiency, safety, and partner satisfaction.</p>
        <div style="margin: 30px 0;">
            <p style="background: #0f172a; color: #fff; display: inline-block; padding: 12px 30px; border-radius: 30px; text-decoration: none; font-weight: bold; font-size: 14px;">Premium Delivery Network</p>
        </div>
        <p>We've received your data and initiated the onboarding sequence. You will receive a separate email shortly detailing the next steps in our verification protocol.</p>
        <br/>
        <p style="color: #94a3b8; font-size: 13px;">Welcome to the future of delivery!</p>
    </div>
    """
    msg.attach(MIMEText(body, 'html'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASS)
        server.sendmail(GMAIL_USER, to_email, msg.as_string())
        server.quit()
        print(f"Delivery welcome email sent to {to_email}.")
        return True
    except Exception as e:
        print(f"Failed to send delivery welcome email: {e}")
        return False

def send_user_status_update_email(to_email, user_name, new_status, reason=None):
    msg = MIMEMultipart()
    msg['From'] = GMAIL_USER
    msg['To'] = to_email
    
    status_label = new_status.upper()
    color = "red" if new_status in ["suspended", "banned", "inactive"] else "green"
    
    msg['Subject'] = f"JDLX Mobile: Account Status Updated to {status_label}"
    
    body = f"""
    <h2>Hello {user_name},</h2>
    <p>This is to inform you that your JDLX Mobile account status has been updated to: <b style="color:{color};">{status_label}</b>.</p>
    """
    if reason:
        body += f"<p><b>Admin Note:</b> {reason}</p>"
        
    if new_status == "active":
        body += "<p>You can now continue using all our services as usual. Thank you for being part of JDLX Mobile!</p>"
    else:
        body += "<p>If you believe this is a mistake or have any questions, please contact our support team.</p>"
        
    body += "<br/><p>Best Regards,<br/>JDLX Mobile Team</p>"
    
    msg.attach(MIMEText(body, 'html'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASS)
        server.sendmail(GMAIL_USER, to_email, msg.as_string())
        server.quit()
        print(f"[MAIL LOG] User status update email ({new_status}) sent to {to_email}.")
        return True
    except Exception as e:
        print(f"[MAIL ERROR] Failed to send user status email to {to_email}: {e}")
        return False

def send_individual_email(to_email, user_name, subject, message):
    msg = MIMEMultipart()
    msg['From'] = GMAIL_USER
    msg['To'] = to_email
    msg['Subject'] = f"JDLX Mobile: {subject}"
    
    message_html = message.replace('\n', '<br/>')
    body = f"""
    <h2>Hello {user_name},</h2>
    <div style="padding: 15px; border-left: 4px solid #001f3f; background: #f9f9f9; font-style: italic;">
        {message_html}
    </div>
    <br/>
    <p>Best Regards,<br/>JDLX Mobile Team</p>
    """
    msg.attach(MIMEText(body, 'html'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASS)
        server.sendmail(GMAIL_USER, to_email, msg.as_string())
        server.quit()
        print(f"[MAIL LOG] Individual email sent to {to_email}.")
        return True
    except Exception as e:
        print(f"[MAIL ERROR] Failed to send individual email to {to_email}: {e}")
        return False

def send_warehouse_action_email(to_email, owner_name, warehouse_name, action, reason=None):
    msg = MIMEMultipart()
    msg['From'] = GMAIL_USER
    msg['To'] = to_email
    
    action_label = action.upper()
    color = "red"
    if action == "unban" or action == "activate":
        color = "green"
        msg['Subject'] = f"JDLX Mobile: Warehouse Access Restored - {warehouse_name}"
        body_title = f"Great news, {owner_name}!"
        body_text = f"Your warehouse <b>{warehouse_name}</b> has been reactivated. You can now log in and receive orders again."
    elif action == "suspend":
        msg['Subject'] = f"JDLX Mobile: Warehouse Suspended - {warehouse_name}"
        body_title = f"Notice of Suspension: {warehouse_name}"
        body_text = "Your warehouse account has been temporarily suspended. You will not be able to receive new orders during this time."
    elif action == "ban":
        msg['Subject'] = f"JDLX Mobile: Warehouse Banned - {warehouse_name}"
        body_title = f"Account Banned: {warehouse_name}"
        body_text = "Your warehouse account has been permanently banned from the JDLX Mobile network due to policy violations."
    elif action == "remove":
        msg['Subject'] = f"JDLX Mobile: Account Removed - {warehouse_name}"
        body_title = f"Account Removal: {warehouse_name}"
        body_text = "Your warehouse account and all associated data have been removed from our active secondary fulfillment network."
    else:
        return False
        
    body = f"""
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: {color};">{body_title}</h2>
        <p>{body_text}</p>
    """
    if reason:
        reason_html = reason.replace('\n', '<br/>')
        body += f"""
        <div style="background: #f8f9fa; padding: 15px; border-left: 4px solid {color}; margin: 20px 0;">
            <p style="margin: 0; font-size: 12px; font-weight: bold; color: #666; text-transform: uppercase;">Admin Message:</p>
            <p style="margin: 10px 0 0 0; font-style: italic;">{reason_html}</p>
        </div>
        """
    
    body += """
        <p>If you have any questions regarding this action, please reply to this email or contact support.</p>
        <br/>
        <p>Regards,<br/><b>JDLX Mobile Team</b></p>
    </div>
    """
    
    msg.attach(MIMEText(body, 'html'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASS)
        server.sendmail(GMAIL_USER, to_email, msg.as_string())
        server.quit()
        print(f"[MAIL LOG] Warehouse {action} email sent to {to_email}.")
        return True
    except Exception as e:
        print(f"[MAIL ERROR] Failed to send warehouse {action} email: {e}")
        return False

def send_bulk_notification_email(recipient_emails, subject, message):
    success_count = 0
    fail_count = 0
    
    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASS)
        
        for to_email in recipient_emails:
            if not to_email: continue
            msg = MIMEMultipart()
            msg['From'] = GMAIL_USER
            msg['To'] = to_email
            msg['Subject'] = f"JDLX Mobile: {subject}"
            
            message_html = message.replace('\n', '<br/>')
            body = f"""
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee;">
                <h1 style="color: #001f3f; border-bottom: 2px solid #001f3f; padding-bottom: 10px;">JDLX Announcement</h1>
                <div style="margin-top: 20px; line-height: 1.6;">
                    {message_html}
                </div>
                <hr style="margin-top: 40px; border: 0; border-top: 1px solid #eee;"/>
                <p style="font-size: 12px; color: #777;">You are receiving this because you are a registered user of JDLX Mobile.</p>
            </div>
            """
            msg.attach(MIMEText(body, 'html'))
            
            try:
                server.sendmail(GMAIL_USER, to_email, msg.as_string())
                success_count += 1
                print(f"[MAIL LOG] Bulk mail sent to {to_email}")
            except Exception as e:
                fail_count += 1
                print(f"[MAIL ERROR] Bulk mail failed for {to_email}: {e}")
        
        server.quit()
        print(f"[MAIL LOG] Bulk email process finished. Success: {success_count}, Fail: {fail_count}")
        return success_count, fail_count
    except Exception as e:
        print(f"[MAIL ERROR] Failed to start bulk email process: {e}")
        return 0, len(recipient_emails)

def send_low_stock_catchy_email(to_email, user_name, product_name, stock_left, 
                                custom_subject=None, custom_message=None, custom_title=None):
    msg = MIMEMultipart()
    msg['From'] = GMAIL_USER
    msg['To'] = to_email
    msg['Subject'] = custom_subject if custom_subject else f"Don't let it slip away! 🏃‍♂️ {product_name} is almost gone!"

    header_title = custom_title if custom_title else "Almost Sold Out!"
    main_message = custom_message if custom_message else f"We noticed you have <strong>{product_name}</strong> in your cart. We wanted to give you a heads-up that it's currently one of our hottest items and supply is extremely limited!"

    body = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet">
    </head>
    <body style="margin: 0; padding: 0; background-color: #f8fafc;">
        <div style="font-family: 'Inter', -apple-system, sans-serif; max-width: 600px; margin: 20px auto; color: #1e293b; line-height: 1.6; border: 1px solid #e2e8f0; border-radius: 24px; overflow: hidden; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
            <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 45px 30px; text-align: center;">
                <h1 style="color: #ffffff; font-size: 32px; font-weight: 900; margin: 0; letter-spacing: -0.03em; text-transform: uppercase;">{header_title}</h1>
                <p style="color: #94a3b8; font-size: 16px; margin-top: 12px; font-weight: 500;">Don't let your favorites slip away.</p>
            </div>
            
            <div style="padding: 40px 35px;">
                <p style="font-size: 18px; margin-bottom: 25px; color: #0f172a;">Hello <strong>{user_name}</strong>,</p>
                
                <p style="font-size: 16px; margin-bottom: 35px; color: #475569;">
                    {main_message}
                </p>
                
                <div style="background: #fff7ed; border: 2px dashed #fb923c; border-radius: 20px; padding: 30px; text-align: center; margin-bottom: 35px;">
                    <span style="display: block; font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.15em; color: #ea580c; margin-bottom: 10px;">Critical Inventory Alert</span>
                    <span style="font-size: 36px; font-weight: 900; color: #9a3412; letter-spacing: -0.02em;">ONLY {stock_left} LEFT</span>
                </div>
                
                <p style="font-size: 15px; color: #64748b; margin-bottom: 40px; text-align: center; font-style: italic;">
                    Inventory is moving fast. We cannot guarantee availability if you wait. Secure yours now!
                </p>
                
                <div style="text-align: center;">
                    <a href="https://jdlx-mobile.com/cart" style="background: #4f46e5; color: #ffffff; padding: 20px 45px; border-radius: 18px; text-decoration: none; font-weight: 800; font-size: 16px; display: inline-block; transition: all 0.3s ease; box-shadow: 0 10px 15px -3px rgba(79, 70, 229, 0.3);">
                        COMPLETE PURCHASE NOW
                    </a>
                </div>
            </div>
            
            <div style="background: #f1f5f9; padding: 35px; text-align: center; border-top: 1px solid #e2e8f0;">
                <p style="color: #94a3b8; font-size: 12px; margin: 0; line-height: 1.5;">
                    You are receiving this high-priority alert because this item is in your cart or wishlist.<br/>
                    &copy; 2026 <strong>JDLX Mobile</strong>. All rights reserved.<br/>
                    Hyperlocal Precision Logistics & Fulfillment.
                </p>
            </div>
        </div>
    </body>
    </html>
    """
    msg.attach(MIMEText(body, 'html'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASS)
        server.sendmail(GMAIL_USER, to_email, msg.as_string())
        server.quit()
        print(f"[LOW STOCK MAIL] Sent to {to_email} for {product_name}")
        return True
    except Exception as e:
        print(f"[LOW STOCK MAIL ERROR] Failed: {e}")
        return False
def send_availability_subscription_confirmation(to_email, product_name):
    msg = MIMEMultipart()
    msg['From'] = GMAIL_USER
    msg['To'] = to_email
    msg['Subject'] = f"JDLX Mobile: Alert Active for {product_name}"
    
    body = f"""
    <h2>Notification Alert Active!</h2>
    <p>We've successfully set up an availability alert for you.</p>
    <p>Product: <b>{product_name}</b></p>
    <p>We will send you an email the moment this item is back in stock in our warehouse.</p>
    <br/>
    <p>Thank you for shopping with JDLX Mobile!</p>
    """
    msg.attach(MIMEText(body, 'html'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASS)
        server.sendmail(GMAIL_USER, to_email, msg.as_string())
        server.quit()
        return True
    except Exception as e:
        print(f"Failed to send alert confirmation: {e}")
        return False

def send_product_restock_alert(to_email, product_name):
    msg = MIMEMultipart()
    msg['From'] = GMAIL_USER
    msg['To'] = to_email
    msg['Subject'] = f"JDLX Mobile: {product_name} is BACK IN STOCK!"
    
    body = f"""
    <h2>Good News! It's Back!</h2>
    <p>The product you were waiting for is now available in our warehouse.</p>
    <h3 style="color: #2563eb;">{product_name}</h3>
    <p>Hurry and grab it before it sells out again!</p>
    <br/>
    <a href="https://jdlx.app" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Shop Now</a>
    <br/><br/>
    <p>Best Regards,<br/>JDLX Mobile Team</p>
    """
    msg.attach(MIMEText(body, 'html'))

    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_PASS)
        server.sendmail(GMAIL_USER, to_email, msg.as_string())
        server.quit()
        return True
    except Exception as e:
        print(f"Failed to send restock alert: {e}")
        return False
