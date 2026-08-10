"""
Verification for the three LOW fixes:
  1. add_review rating 1-5 validation (app.py)
  2. FCM push-token ownership guard (app.py register-token)
  3. notifier.py HTML email escaping + subject header-injection guard

Runs against a TEMP local SQLite DB (never touches production/Turso data).
"""
import os
import sys
import tempfile
import datetime

# --- Force a temp local DB BEFORE importing app ---
_tmpdir = tempfile.mkdtemp(prefix="jdlx_low_test_")
os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["DATABASE_PATH"] = os.path.join(_tmpdir, "test.db")
os.environ["DISABLE_RATE_LIMIT"] = "1"

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

import sqlite3

import jwt

import app as app_module
import notifier
from database import init_db

init_db()

app = app_module.app
app.config["TESTING"] = True
client = app.test_client()

PASS, FAIL = [], []


def check(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print(f"  ✅ PASS: {name}")
    else:
        FAIL.append(name)
        print(f"  ❌ FAIL: {name} {detail}")


def db():
    return sqlite3.connect(os.environ["DATABASE_PATH"])


def make_token(user_id, role="user"):
    now = datetime.datetime.utcnow()
    return jwt.encode(
        {"user_id": user_id, "email": f"u{user_id}@test.local", "role": role,
         "iat": now, "exp": now + datetime.timedelta(hours=1)},
        app_module.SECRET_KEY, algorithm="HS256",
    )


# --- Setup users ---
conn = db()
conn.execute("INSERT INTO users (id, google_id, name, email, role) VALUES (1, 'g1', 'User One', 'u1@test.local', 'user')")
conn.execute("INSERT INTO users (id, google_id, name, email, role) VALUES (2, 'g2', 'User Two', 'u2@test.local', 'user')")
conn.execute("INSERT INTO products (id, name, price, stock) VALUES (201, 'Test Product', 100, 10)")
# add_review reads notification_templates for the thank-you email — it exists in
# production via migrations, so create it here for the temp DB.
conn.execute("CREATE TABLE IF NOT EXISTS notification_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, template_key TEXT UNIQUE, subject TEXT, message TEXT, is_active INTEGER DEFAULT 1)")
conn.commit()
conn.close()

import email as _email


def decode_body(raw_msg):
    """Decode the HTML payload of a captured MIME email."""
    m = _email.message_from_string(raw_msg)
    if m.is_multipart():
        for part in m.walk():
            if part.get_content_type() == "text/html":
                return part.get_payload(decode=True).decode("utf-8", errors="replace")
    return m.get_payload(decode=True).decode("utf-8", errors="replace")

H1 = {"Authorization": f"Bearer {make_token(1)}", "Content-Type": "application/json"}
H2 = {"Authorization": f"Bearer {make_token(2)}", "Content-Type": "application/json"}

print("\n=== 1. add_review rating validation ===")

r = client.post("/api/review/add", json={"product_id": 201, "rating": 0, "review_text": "bad"}, headers=H1)
check("rating 0 -> 400", r.status_code == 400, f"(got {r.status_code})")
r = client.post("/api/review/add", json={"product_id": 201, "rating": 6, "review_text": "bad"}, headers=H1)
check("rating 6 -> 400", r.status_code == 400, f"(got {r.status_code})")
r = client.post("/api/review/add", json={"product_id": 201, "rating": "abc", "review_text": "bad"}, headers=H1)
check("rating 'abc' -> 400", r.status_code == 400, f"(got {r.status_code})")
r = client.post("/api/review/add", json={"product_id": 201, "rating": -1, "review_text": "bad"}, headers=H1)
check("rating -1 -> 400", r.status_code == 400, f"(got {r.status_code})")
r = client.post("/api/review/add", json={"product_id": "not-a-number", "rating": 5, "review_text": "ok"}, headers=H1)
check("non-numeric product_id -> 400", r.status_code == 400, f"(got {r.status_code})")
r = client.post("/api/review/add", json={"product_id": 201, "rating": 4.7, "review_text": "good product"}, headers=H1)
check("valid rating 4.7 -> 201 (stored as int)", r.status_code == 201, f"(got {r.status_code} {r.get_json()})")
conn = db()
row = conn.execute("SELECT rating FROM product_reviews WHERE user_id = 1 AND product_id = 201").fetchone()
conn.close()
check("rating stored as 4 (INTEGER column)", row is not None and row[0] == 4, f"(got {row})")
r = client.post("/api/review/add", json={"product_id": 201, "rating": 5, "review_text": "again"}, headers=H1)
check("duplicate review -> 400 (friendly)", r.status_code == 400, f"(got {r.status_code})")
r = client.post("/api/review/add", json={"product_id": 201, "rating": 5, "review_text": "x" * 2500}, headers=H2)
check("overlong review_text -> 400", r.status_code == 400, f"(got {r.status_code})")

print("\n=== 2. FCM push-token ownership guard ===")

r = client.post("/api/notifications/register-token", json={"token": "fcm_token_shared", "device_type": "web"}, headers=H1)
check("user1 registers token -> 200", r.status_code == 200, f"(got {r.status_code})")
conn = db()
owner = conn.execute("SELECT user_id FROM user_push_tokens WHERE fcm_token = 'fcm_token_shared'").fetchone()
conn.close()
check("token owned by user1", owner and owner[0] == 1, f"(got {owner})")

# User 2 tries to hijack user 1's token -> must NOT steal it
r = client.post("/api/notifications/register-token", json={"token": "fcm_token_shared", "device_type": "web"}, headers=H2)
conn = db()
owner = conn.execute("SELECT user_id FROM user_push_tokens WHERE fcm_token = 'fcm_token_shared'").fetchone()
conn.close()
check("user2 cannot hijack user1's token (owner unchanged)", owner and owner[0] == 1, f"(got {owner})")

# Legit same-user re-registration still works
r = client.post("/api/notifications/register-token", json={"token": "fcm_token_shared", "device_type": "android"}, headers=H1)
conn = db()
owner = conn.execute("SELECT user_id, device_type FROM user_push_tokens WHERE fcm_token = 'fcm_token_shared'").fetchone()
conn.close()
check("owner re-registers own token (updated, still owner)", owner and owner[0] == 1 and owner[1] == "android", f"(got {owner})")

print("\n=== 3. notifier email escaping ===")

# 3a. Helpers
check("_esc escapes <script>", notifier._esc('<script>alert(1)</script>') == "&lt;script&gt;alert(1)&lt;/script&gt;",
      f"(got {notifier._esc('<script>x</script>')})")
check("_clean_subject strips CR/LF", notifier._clean_subject("evil\r\nBcc: x@y.com") == "evil  Bcc: x@y.com",
      f"(got {notifier._clean_subject('evil\\r\\nBcc: x@y.com')!r})")

# 3b. Full email path with a fake SMTP to capture the rendered body
class FakeSMTP:
    instances = []
    def __init__(self, *a, **k):
        self.msgs = []
        FakeSMTP.instances.append(self)
    def starttls(self): pass
    def login(self, *a): pass
    def set_debuglevel(self, n): pass
    def sendmail(self, *a, **k):
        self.msgs.append(k.get("msg", a[-1] if a else ""))
    def quit(self): pass

notifier.smtplib.SMTP = FakeSMTP
notifier.GMAIL_USER = "noreply@test.local"
notifier.GMAIL_PASS = "pw"

evil_name = '<script>alert(1)</script>'
evil_addr = '<img src=x onerror=alert(2)>'
notifier.send_order_email("buyer@test.local", {
    "order_id": 42, "payment_type": "PREPAID", "customer_name": evil_name,
    "address": evil_addr, "total_amount": 100, "subtotal": 100, "platform_fee": 0,
    "delivery_fee": 0, "fitting_charge": 0, "discount_applied": 0,
    "items": [{"name": evil_name, "qty": 1, "price": 100}],
})
body = decode_body(FakeSMTP.instances[-1].msgs[-1])
check("order email: raw <script> NOT present", "<script>alert" not in body, "(leak!)")
check("order email: raw <img onerror> NOT present", "<img src=x onerror" not in body, "(leak!)")
check("order email: escaped name present", "&lt;script&gt;alert" in body, "(missing escape)")
check("order email: escaped address present", "&lt;img src=x onerror" in body, "(missing escape)")

# subject injection guard: a \r\n in the warehouse name must NOT create a new
# header line (CR/LF replaced with spaces by _clean_subject). The BODY may still
# contain the literal text (rendered as harmless whitespace in HTML) — only the
# header section is security-relevant.
notifier.send_warehouse_kyc_pending_email("wh@test.local", "Owner", "WH\r\nBcc: evil@test.local")
raw_msg = FakeSMTP.instances[-1].msgs[-1]
header_section = raw_msg.split("\r\n\r\n", 1)[0]
header_lines = header_section.split("\r\n")
check("kyc email: no Bcc header line injected (header section only)",
      not any(l.lower().startswith("bcc:") for l in header_lines), f"(headers={header_lines})")

print("\n" + "=" * 50)
print(f"TOTAL: {len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    print("FAILED:", FAIL)
    sys.exit(1)
print("ALL TESTS PASSED ✅")
