"""
Verification for the two HIGH security fixes:
  1. Admin OTP hardening (DB storage, hashed OTP, attempt limit, lockout, no enumeration)
  2. Razorpay webhook fail-closed + amount validation

Runs against a TEMP local SQLite DB (never touches production/Turso data).
"""
import os
import sys
import tempfile

# --- Force a temp local DB BEFORE importing app ---
_tmpdir = tempfile.mkdtemp(prefix="jdlx_sec_test_")
_tmp_db = os.path.join(_tmpdir, "test.db")
os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["DATABASE_PATH"] = _tmp_db
os.environ["DISABLE_RATE_LIMIT"] = "1"  # keep only the explicit endpoint limits
# Keep RAZORPAY env from .env; the webhook tests toggle the secret at runtime.

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

import re
import json
import hashlib
import hmac as hmac_lib
import sqlite3

import app as app_module
from database import init_db, get_db

init_db()

app = app_module.app
app.config["TESTING"] = True
client = app.test_client()

PASS = []
FAIL = []


def check(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print(f"  ✅ PASS: {name}")
    else:
        FAIL.append(name)
        print(f"  ❌ FAIL: {name} {detail}")


def otp_conn():
    return sqlite3.connect(_tmp_db)


def reset_limits():
    """Reset flask-limiter counters between test groups so the explicit
    endpoint limits (3/10min request-otp, 10/10min verify-otp) don't trip."""
    try:
        app_module.limiter.reset()
    except Exception:
        try:
            app_module.limiter._storage.reset()
        except Exception:
            pass


# ============================================================
# Setup: create a test admin user (email + name)
# ============================================================
conn = otp_conn()
conn.execute(
    "INSERT INTO users (google_id, name, email, role) VALUES (?, ?, ?, ?)",
    ("test-google-1", "Test Admin", "admin@test.local", "admin"),
)
conn.commit()

# Monkeypatch the email sender to capture the OTP (it runs in a background thread,
# so we wait for the thread to write into a shared dict).
captured = {}

orig_send = app_module.send_individual_email


def fake_send(email, name, subject, message):
    captured["email"] = email
    captured["message"] = message


app_module.send_individual_email = fake_send

print("\n=== 1. Admin OTP flow ===")

# 1a. Request OTP for a VALID admin -> generic 200 (no email enumeration message)
reset_limits()
r = client.post("/api/admin/request-otp", json={"email": "admin@test.local"})
check("request-otp valid admin -> 200", r.status_code == 200, f"(got {r.status_code})")

# 1b. Request OTP for a NON-EXISTENT email -> same generic 200 (no enumeration)
r2 = client.post("/api/admin/request-otp", json={"email": "ghost@test.local"})
check("request-otp non-existent -> 200 (no enumeration)",
      r2.status_code == 200 and r2.get_json() == r.get_json(),
      f"(got {r2.status_code} {r2.get_json()})")

# 1c. Request OTP for a plain USER (not admin) -> generic 200 (no enumeration)
conn = otp_conn()
conn.execute(
    "INSERT INTO users (google_id, name, email, role) VALUES (?, ?, ?, ?)",
    ("test-google-2", "Normal User", "user@test.local", "user"),
)
conn.commit()
r3 = client.post("/api/admin/request-otp", json={"email": "user@test.local"})
check("request-otp non-admin user -> 200 (no enumeration)",
      r3.status_code == 200 and r3.get_json() == r.get_json(),
      f"(got {r3.status_code})")

# 1d. OTP row stored hashed (never plaintext) in DB
conn = otp_conn()
row = conn.execute("SELECT otp_hash, otp_salt FROM admin_otps WHERE email = 'admin@test.local'").fetchone()
check("OTP stored hashed in DB", row is not None and len(row[0]) == 64 and row[1], f"(row={row})")

# 1e. Extract the real OTP from the captured email (it is still emailed in plaintext to the owner)
import time as _time
_time.sleep(0.5)  # let the background email thread write into `captured`
m = re.search(r"font-size: 24px; color: #4F46E5;'>(\d{6})</b>", captured.get("message", ""))
check("OTP email captured with 6-digit code", m is not None, f"(message={captured.get('message', '')[:80]})")
real_otp = m.group(1) if m else "000000"

# 1f. Wrong OTP x5 -> all 401, then OTP exhausted (correct OTP afterwards also fails)
statuses = []
for _ in range(5):
    rr = client.post("/api/admin/verify-otp", json={"email": "admin@test.local", "otp": "000000"})
    statuses.append(rr.status_code)
check("5 wrong OTP attempts -> all 401", statuses == [401] * 5, f"(got {statuses})")

conn = otp_conn()
remaining = conn.execute("SELECT COUNT(*) FROM admin_otps WHERE email = 'admin@test.local'").fetchone()[0]
check("OTP row deleted after exhaustion", remaining == 0, f"(rows left={remaining})")

rr = client.post("/api/admin/verify-otp", json={"email": "admin@test.local", "otp": real_otp})
check("exhausted OTP cannot be reused", rr.status_code == 401, f"(got {rr.status_code})")

# 1g. Fresh request -> correct OTP -> success with token (one-time use)
reset_limits()
conn = otp_conn()
conn.execute("DELETE FROM admin_otps WHERE email = 'admin@test.local'")
conn.commit()
captured.clear()
client.post("/api/admin/request-otp", json={"email": "admin@test.local"})
_time.sleep(0.5)
m2 = re.search(r"font-size: 24px; color: #4F46E5;'>(\d{6})</b>", captured.get("message", ""))
otp2 = m2.group(1) if m2 else None
check("fresh OTP captured", otp2 is not None)
if otp2:
    rr = client.post("/api/admin/verify-otp", json={"email": "admin@test.local", "otp": otp2})
    body = rr.get_json(silent=True) or {}
    check("correct OTP -> success + token", rr.status_code == 200 and body.get("success") is True and bool(body.get("token")), f"(got {rr.status_code} {body})")
    conn = otp_conn()
    left = conn.execute("SELECT COUNT(*) FROM admin_otps WHERE email = 'admin@test.local'").fetchone()[0]
    check("OTP consumed after success (one-time use)", left == 0, f"(rows left={left})")
    # reusing same OTP again must fail
    rr2 = client.post("/api/admin/verify-otp", json={"email": "admin@test.local", "otp": otp2})
    check("same OTP cannot be reused", rr2.status_code == 401, f"(got {rr2.status_code})")

# 1h. Lockout integration: 6 failed logins (login_guard threshold is > 5) ->
# account locked -> request-otp blocked (423)
reset_limits()
conn = otp_conn()
conn.execute("DELETE FROM login_attempts WHERE email = 'admin@test.local'")
for _ in range(6):
    conn.execute(
        "INSERT INTO login_attempts (email, ip_address, status) VALUES (?, '1.2.3.4', 'failed')",
        ("admin@test.local",),
    )
conn.commit()
rr = client.post("/api/admin/request-otp", json={"email": "admin@test.local"})
check("locked account cannot request OTP (423)", rr.status_code == 423, f"(got {rr.status_code})")

print("\n=== 2. Razorpay webhook fail-closed ===")

SECRET = "test_webhook_secret_abc123"


def make_payload(event, order_id, amount):
    return json.dumps({
        "event": event,
        "payload": {
            "payment": {
                "entity": {"id": "pay_test_1", "order_id": order_id, "amount": amount}
            }
        }
    })


def sign(body):
    return hmac_lib.new(SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()


# Seed a payments row (amount stored in paise, like /api/payment/create-order does)
conn = otp_conn()
conn.execute(
    """INSERT INTO payments (order_id, user_id, razorpay_order_id, amount, status)
       VALUES (?, ?, ?, ?, 'created')""",
    (999999, 1, "order_test_1", 50000,),
)
conn.commit()

# 2a. Secret missing -> 503 fail-closed
orig_secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET")
os.environ.pop("RAZORPAY_WEBHOOK_SECRET", None)
r = client.post("/api/payment/webhook", json={})
check("webhook without configured secret -> 503", r.status_code == 503, f"(got {r.status_code})")
# Use OUR test secret for the remaining webhook tests (do NOT restore the real
# .env secret, otherwise signature verification uses a secret the test can't sign).
os.environ["RAZORPAY_WEBHOOK_SECRET"] = SECRET

# 2b. Secret set but no signature -> 400
r = client.post("/api/payment/webhook", data=make_payload("payment.captured", "order_test_1", 50000),
                content_type="application/json")
check("webhook without signature -> 400", r.status_code == 400, f"(got {r.status_code})")

# 2c. Forged/invalid signature -> 400
r = client.post("/api/payment/webhook", data=make_payload("payment.captured", "order_test_1", 50000),
                content_type="application/json",
                headers={"X-Razorpay-Signature": "deadbeef"})
check("webhook with bad signature -> 400", r.status_code == 400, f"(got {r.status_code})")

# 2d. Valid signature but amount mismatch -> 400 (order NOT confirmed)
body = make_payload("payment.captured", "order_test_1", 1)
r = client.post("/api/payment/webhook", data=body, content_type="application/json",
                headers={"X-Razorpay-Signature": sign(body)})
check("valid signature + wrong amount -> 400", r.status_code == 400, f"(got {r.status_code})")
conn = otp_conn()
pay_status = conn.execute("SELECT status FROM payments WHERE razorpay_order_id = 'order_test_1'").fetchone()[0]
check("payment NOT marked paid on mismatch", pay_status == "created", f"(status={pay_status})")

# 2e. Valid signature + correct amount -> 200 (accepted)
body = make_payload("payment.captured", "order_test_1", 50000)
r = client.post("/api/payment/webhook", data=body, content_type="application/json",
                headers={"X-Razorpay-Signature": sign(body)})
check("valid signature + correct amount -> 200", r.status_code == 200, f"(got {r.status_code} {r.get_json()})")

# 2f. Unknown razorpay_order_id -> 404
body = make_payload("payment.captured", "order_unknown_1", 100)
r = client.post("/api/payment/webhook", data=body, content_type="application/json",
                headers={"X-Razorpay-Signature": sign(body)})
check("unknown razorpay_order_id -> 404", r.status_code == 404, f"(got {r.status_code})")

# 2g. Rupees-float convention (legacy /api/payment/create) still accepted
conn = otp_conn()
conn.execute(
    """INSERT INTO payments (order_id, user_id, razorpay_order_id, amount, status)
       VALUES (?, ?, ?, ?, 'created')""",
    (999998, 1, "order_test_2", 349.0,),  # ₹349 stored as rupees float
)
conn.commit()
body = make_payload("payment.captured", "order_test_2", 34900)  # 34900 paise captured
r = client.post("/api/payment/webhook", data=body, content_type="application/json",
                headers={"X-Razorpay-Signature": sign(body)})
check("legacy rupees-float amount accepted (₹349 = 34900 paise)", r.status_code == 200, f"(got {r.status_code} {r.get_json()})")

print("\n" + "=" * 50)
print(f"TOTAL: {len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    print("FAILED:", FAIL)
    sys.exit(1)
print("ALL TESTS PASSED ✅")
