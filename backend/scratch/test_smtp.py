import smtplib
from email.mime.text import MIMEText
import os
from dotenv import load_dotenv

# Load env
load_dotenv('/home/jaydev/Desktop/JDLX-Mobile/backend/.env')

SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
GMAIL_USER = os.getenv("GMAIL_USER")
GMAIL_PASS = os.getenv("GMAIL_PASS")

print(f"Attempting to send email from {GMAIL_USER}...")

try:
    msg = MIMEText("This is a test email from JDLX System.")
    msg['Subject'] = "SMTP Test"
    msg['From'] = GMAIL_USER
    msg['To'] = GMAIL_USER
    
    server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=10)
    server.set_debuglevel(1)
    server.starttls()
    server.login(GMAIL_USER, GMAIL_PASS)
    server.send_message(msg)
    server.quit()
    print("SUCCESS: Email sent!")
except Exception as e:
    print(f"FAILED: {e}")
