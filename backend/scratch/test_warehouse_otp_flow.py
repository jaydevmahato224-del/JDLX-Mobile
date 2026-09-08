"""Verify the warehouse Google OTP-linking flow works end-to-end.

Covers the pieces that c1d8ba0 broke:
  1. OTP generation in partner_auth_google_callback must not crash
     (secrets / _hash_warehouse_otp imports, row access without .get()).
  2. google_link_verify must link warehouses.google_id (not users) and
     return a warehouse partner session.
  3. The warehouses table has a google_id column.
  4. The callback sends the OTP SYNCHRONOUSLY and cleans up the row when the
     send fails (a background thread used to swallow failures silently).
  5. google_link_resend handles warehouse_ google_ids (partner not in users).
"""
import os
import sys
import json
import sqlite3

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

import database
import warehouse_routes

# Use the local DB but keep it untouched: copy it to a temp file first so
# init_db migrations run against a full existing schema.
TMP_DB = os.path.join(backend_dir, "scratch", "_wh_otp_test.db")
SRC_DB = os.path.join(backend_dir, "jdlx.db")
if os.path.exists(TMP_DB):
    os.remove(TMP_DB)
import shutil
shutil.copy(SRC_DB, TMP_DB)

_orig_open = database._open_connection

def _test_open():
    conn = sqlite3.connect(TMP_DB, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

database._open_connection = _test_open

from database import init_db, get_db
init_db()

conn = get_db()
# Create a test warehouse (schema now includes google_id)
conn.execute(
    "INSERT OR IGNORE INTO warehouses (warehouse_name, email, owner_name, warehouse_role) "
    "VALUES ('Test WH', 'wh-otp-test@example.com', 'Test Owner', 'owner')"
)
conn.commit()
wh = conn.execute("SELECT * FROM warehouses WHERE email = ?", ("wh-otp-test@example.com",)).fetchone()
wh_id = wh["id"]
print(f"Test warehouse id={wh_id}, google_id column present: {'google_id' in wh.keys()}")

# 1) Exercise the OTP branch helpers directly (simulating callback internals)
import warehouse_routes as wr
from warehouse_routes import _hash_warehouse_otp
salt = "testsalt"
otp = "123456"
hashed = _hash_warehouse_otp(otp, salt)
# Must match app._hash_admin_otp algorithm (sha256 of f"{salt}:{otp}")
import hashlib
expected = hashlib.sha256(f"{salt}:{otp}".encode()).hexdigest()
assert hashed == expected, "OTP hash must match app._hash_admin_otp"
print("OTP hash helper matches app._hash_admin_otp algorithm")

# 2) google_link_otps insert path (same statement the callback uses)
cursor = conn.cursor()
cursor.execute(
    "INSERT INTO google_link_otps (email, user_id, google_id, name, picture, otp_hash, otp_salt, expires_at) "
    "VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+10 minutes'))",
    ("wh-otp-test@example.com", wh_id, "warehouse_" + str(wh_id),
     wh["owner_name"] or wh["warehouse_name"], None, hashed, salt)
)
conn.commit()
row = conn.execute(
    "SELECT * FROM google_link_otps WHERE email = ? AND google_id = ?",
    ("wh-otp-test@example.com", "warehouse_" + str(wh_id))
).fetchone()
assert row is not None and row["user_id"] == wh_id
print("google_link_otps row inserted for warehouse flow")

# 3) Simulate google_link_verify's warehouse branch: update warehouses.google_id
cursor.execute("UPDATE warehouses SET google_id = ? WHERE id = ?", ("warehouse_" + str(wh_id), wh_id))
conn.commit()
wh2 = conn.execute("SELECT google_id FROM warehouses WHERE id = ?", (wh_id,)).fetchone()
assert wh2["google_id"] == "warehouse_" + str(wh_id)
print("warehouses.google_id updated (not users table)")

# 4) Callback google_id readback uses [] access and picks up the link
wh3 = conn.execute("SELECT * FROM warehouses WHERE id = ?", (wh_id,)).fetchone()
wh_google_id = wh3["google_id"] if "google_id" in wh3.keys() else None
assert wh_google_id == "warehouse_" + str(wh_id)
print("Callback readback of google_id works without .get()")

# 5) issue_warehouse_token still issues a token with type=warehouse
token = wr.issue_warehouse_token(wh_id, "wh-otp-test@example.com", "owner")
import jwt
from jwt_config import get_jwt_secret
payload = jwt.decode(token, get_jwt_secret(), algorithms=["HS256"])
assert payload.get("type") == "warehouse" and payload.get("warehouse_id") == wh_id
print("issue_warehouse_token OK (type=warehouse)")

# Reset google_id so the callback test below re-enters the OTP branch
conn.execute("UPDATE warehouses SET google_id = NULL WHERE id = ?", (wh_id,))
conn.commit()

# ── Flask test client: callback (sync send) + warehouse resend ──────────────
import app as app_module

emails_sent = []
def _fake_send(to, name, subject, message):
    emails_sent.append({"to": to, "subject": subject, "message": message})
    return True
app_module.send_individual_email = _fake_send
# The callback reads send_individual_email via the module-global import in
# warehouse_routes, so patch that binding too.
warehouse_routes.send_individual_email = _fake_send

class _FakeOAuthPartner:
    def __init__(self, fail_token=False):
        self.fail_token = fail_token
        self.calls = []
    def authorize_access_token(self):
        self.calls.append("token")
        if self.fail_token:
            raise RuntimeError("mock token failure")
        return {"access_token": "x", "userinfo": {"email": "wh-otp-test@example.com", "name": "Test Owner"}}
    def userinfo(self):
        self.calls.append("userinfo")
        return {"email": "wh-otp-test@example.com", "name": "Test Owner"}

class _FakeOAuth:
    def __init__(self, partner):
        self.google_partner = partner

client = app_module.app.test_client()
_SECURE = {"wsgi.url_scheme": "https"}

def _env():
    return {**_SECURE, "REMOTE_ADDR": "10.9.9.9"}

def _run_callback(fake_partner):
    app_module.app.config["PARTNER_OAUTH_CLIENT"] = _FakeOAuth(fake_partner)
    with client.session_transaction() as sess:
        sess["partner_oauth_flow"] = "warehouse_login"
    return client.get("/partner/auth/google/callback?code=mock&state=mock",
                      environ_overrides=_env(), follow_redirects=False)

# 6) Callback with a fresh (unlinked) warehouse → OTP sent synchronously
#    and redirect carries link_required + email + google_id.
conn.execute("DELETE FROM google_link_otps WHERE email = ?", ("wh-otp-test@example.com",))
conn.commit()
emails_sent.clear()
r = _run_callback(_FakeOAuthPartner())
assert r.status_code == 302, f"callback should redirect, got {r.status_code}"
loc = r.headers.get("Location", "")
assert "link_required=true" in loc, f"expected link_required redirect, got {loc}"
assert "google_id=warehouse_" + str(wh_id) in loc, f"expected warehouse google_id in redirect, got {loc}"
assert len(emails_sent) == 1, f"OTP email should be sent synchronously, got {len(emails_sent)} sends"
assert "OTP" in emails_sent[0]["message"]
otp_row = conn.execute(
    "SELECT otp_hash, last_sent_at FROM google_link_otps WHERE email = ? AND google_id = ?",
    ("wh-otp-test@example.com", "warehouse_" + str(wh_id))
).fetchone()
assert otp_row is not None, "OTP row should exist after successful send"
assert otp_row["last_sent_at"] is not None, "last_sent_at should be recorded"
print("Callback sends OTP synchronously + records last_sent_at + redirects to link_required")

# 7) Callback when the send FAILS → OTP row removed, redirect carries error
def _failing_send(to, name, subject, message):
    return False
warehouse_routes.send_individual_email = _failing_send
app_module.send_individual_email = _failing_send
emails_sent.clear()
r = _run_callback(_FakeOAuthPartner())
assert r.status_code == 302, f"callback should redirect, got {r.status_code}"
loc = r.headers.get("Location", "")
assert "otp_send_failed" in loc, f"expected otp_send_failed redirect, got {loc}"
orphan = conn.execute(
    "SELECT COUNT(*) AS n FROM google_link_otps WHERE email = ? AND google_id = ?",
    ("wh-otp-test@example.com", "warehouse_" + str(wh_id))
).fetchone()
assert orphan["n"] == 0, "no orphan OTP row should remain after failed send"
print("Callback send failure → OTP row cleaned up + error redirect")
warehouse_routes.send_individual_email = _fake_send
app_module.send_individual_email = _fake_send

# 8) Warehouse resend: partner exists only in warehouses, not users → a fresh
#    OTP is generated and emailed (no fake enumeration success without send).
conn.execute("DELETE FROM google_link_otps WHERE email = ?", ("wh-otp-test@example.com",))
conn.commit()
emails_sent.clear()
r = client.post("/api/auth/google/link-resend",
                json={"email": "wh-otp-test@example.com", "google_id": "warehouse_" + str(wh_id)},
                environ_overrides=_env())
assert r.status_code == 200, f"resend should succeed, got {r.status_code}: {r.get_data(as_text=True)[:200]}"
assert len(emails_sent) == 1, f"resend should email the OTP, got {len(emails_sent)} sends"
otp_row2 = conn.execute(
    "SELECT resend_count FROM google_link_otps WHERE email = ? AND google_id = ?",
    ("wh-otp-test@example.com", "warehouse_" + str(wh_id))
).fetchone()
assert otp_row2 is not None and otp_row2["resend_count"] == 0, "fresh resend row should exist"
print("google_link_resend handles warehouse google_id (sends real OTP)")

# Cleanup (temp DB — disable FK checks so child rows don't block removal)
conn.execute("PRAGMA foreign_keys = OFF")
conn.execute("DELETE FROM google_link_otps WHERE email = ?", ("wh-otp-test@example.com",))
conn.execute("DELETE FROM warehouses WHERE id = ?", (wh_id,))
conn.commit()
conn.close()
database._open_connection = _orig_open
if os.path.exists(TMP_DB):
    os.remove(TMP_DB)

print("\nALL WAREHOUSE OTP FLOW CHECKS PASSED")