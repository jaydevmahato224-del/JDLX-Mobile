import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

GMAIL_USER = os.environ.get("GMAIL_USER")
GMAIL_PASS = os.environ.get("GMAIL_PASS")

print(f"DEBUG: GMAIL_USER={GMAIL_USER}")
print(f"DEBUG: GMAIL_PASS={'SET' if GMAIL_PASS else 'NOT SET'}")

def test_send_email():
    if not GMAIL_USER or not GMAIL_PASS:
        print("ERROR: GMAIL_USER or GMAIL_PASS is missing in environment!")
        return

    to_email = "jaydevmahato52964@gmail.com"
    msg = MIMEMultipart()
    msg['From'] = GMAIL_USER
    msg['To'] = to_email
    msg['Subject'] = "JDLX Mail Test"
    msg.attach(MIMEText("This is a test email from Antigravity debugger.", 'plain'))

    try:
        print("Attempting to connect to smtp.gmail.com...")
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        print("Logging in...")
        server.login(GMAIL_USER, GMAIL_PASS)
        print("Sending mail...")
        server.sendmail(GMAIL_USER, to_email, msg.as_string())
        server.quit()
        print("SUCCESS: Email sent!")
    except Exception as e:
        print(f"FAILURE: {e}")

if __name__ == "__main__":
    test_send_email()
