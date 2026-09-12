"""
Verification for the auth-consistency fixes:

  1. Wallet/referral endpoints (referral_wallet_routes.token_required) now accept
     the HttpOnly `token` cookie as well as an Authorization Bearer header — so a
     cookie-only storefront session no longer gets a hard 401.
  2. /api/products/<id>/notify derives the in-app notification owner from the
     presented credential instead of trusting a client-supplied user_id, so a
     caller can no longer create notifications for an arbitrary account.
  3. The global-logout guard (min_token_iat) is honoured by the wallet route too.

Runs against a TEMP local SQLite DB (never touches production/Turso data).

Usage:  python3 backend/scratch/test_auth_consistency.py
"""
import datetime
import os
import sys
import tempfile

# --- Force a temp local DB + a plain-HTTP test environment BEFORE importing app ---
_tmpdir = tempfile.mkdtemp(prefix="jdlx_auth_test_")
os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["DATABASE_PATH"] = os.path.join(_tmpdir, "test.db")
os.environ["DISABLE_RATE_LIMIT"] = "1"
os.environ["FORCE_HTTPS"] = "0"

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

import sqlite3

import jwt

import app as app_module
from database import init_db

init_db()

app = app_module.app
app.config["TESTING"] = True
client = app.test_client()

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))


def db():
    conn = sqlite3.connect(os.environ["DATABASE_PATH"])
    conn.row_factory = sqlite3.Row
    return conn


def make_token(user_id, iat=None):
    now = iat or datetime.datetime.utcnow()
    return jwt.encode(
        {"user_id": user_id, "email": f"u{user_id}@test.local", "role": "user",
         "iat": now, "exp": now + datetime.timedelta(hours=1)},
        app_module.SECRET_KEY, algorithm="HS256",
    )


# --- Setup ---
conn = db()
conn.execute("INSERT INTO users (id, google_id, name, email, role) VALUES (1, 'g1', 'User One', 'u1@test.local', 'user')")
conn.execute("INSERT INTO users (id, google_id, name, email, role) VALUES (2, 'g2', 'User Two', 'u2@test.local', 'user')")
conn.execute("INSERT INTO products (id, name, price, stock) VALUES (201, 'Test Product', 100, 10)")
conn.commit()
conn.close()

TOKEN1 = make_token(1)
BEARER1 = {"Authorization": f"Bearer {TOKEN1}", "Content-Type": "application/json"}


def cookie_client(token):
    """Fresh test client carrying the auth cookie (Flask 3.x set_cookie API)."""
    c = app.test_client()
    c.set_cookie('token', token, domain='localhost')
    return c

print("\n=== 1. Wallet endpoint accepts cookie AND bearer ===")

r = client.get("/api/wallet/balance")
check("no credential -> 401", r.status_code == 401, f"(got {r.status_code})")

r = client.get("/api/wallet/balance", headers=BEARER1)
check("bearer -> 200", r.status_code == 200, f"(got {r.status_code})")

r = cookie_client(TOKEN1).get("/api/wallet/balance")
check("cookie-only -> 200 (was 401 before fix)", r.status_code == 200, f"(got {r.status_code})")
check("cookie response has balance", isinstance(r.get_json(), dict) and "balance" in r.get_json(),
      f"(got {r.get_json()})")

r = cookie_client("not-a-jwt").get("/api/wallet/balance")
check("garbage cookie -> 401", r.status_code == 401, f"(got {r.status_code})")

print("\n=== 2. Global logout (min_token_iat) honoured by wallet route ===")

old_iat = datetime.datetime.utcnow() - datetime.timedelta(hours=2)
old_token = make_token(1, iat=old_iat)
conn = db()
conn.execute("UPDATE users SET min_token_iat = ? WHERE id = 1", (int(datetime.datetime.utcnow().timestamp()),))
conn.commit()
conn.close()

r = client.get("/api/wallet/balance", headers={"Authorization": f"Bearer {old_token}", "Content-Type": "application/json"})
check("stale bearer after global logout -> 401", r.status_code == 401, f"(got {r.status_code})")
r = cookie_client(old_token).get("/api/wallet/balance")
check("stale cookie after global logout -> 401", r.status_code == 401, f"(got {r.status_code})")

# Restore min_token_iat so the fresh token stays valid for the next section.
conn = db()
conn.execute("UPDATE users SET min_token_iat = 0 WHERE id = 1")
conn.commit()
conn.close()

print("\n=== 3. /products/:id/notify ignores spoofed user_id ===")

r = client.post("/api/products/201/notify",
                json={"email": "spoof@test.local", "user_id": 2},
                headers=BEARER1)
check("authenticated notify -> 200", r.status_code == 200, f"(got {r.status_code} {r.get_json()})")

conn = db()
notif = conn.execute(
    "SELECT user_id FROM notifications WHERE title = 'Alert Activated' AND user_id = 1"
).fetchone()
spoofed = conn.execute(
    "SELECT user_id FROM notifications WHERE title = 'Alert Activated' AND user_id = 2"
).fetchone()
sub = conn.execute(
    "SELECT user_id FROM product_notifications WHERE email = 'spoof@test.local'"
).fetchone()
conn.close()

check("in-app notification created for REAL session user (1)", notif is not None)
check("no notification created for spoofed user (2)", spoofed is None, f"(got {dict(spoofed) if spoofed else None})")
check("subscription rows owned by session user (1)", sub is not None and sub["user_id"] == 1,
      f"(got {dict(sub) if sub else None})")

r = client.post("/api/products/201/notify", json={"email": "guest@test.local", "user_id": 2})
check("guest notify -> 200 (email alert still works)", r.status_code == 200, f"(got {r.status_code})")
conn = db()
guest_notif = conn.execute(
    "SELECT user_id FROM notifications WHERE user_id = 2"
).fetchone()
guest_sub = conn.execute(
    "SELECT user_id FROM product_notifications WHERE email = 'guest@test.local'"
).fetchone()
conn.close()
check("guest notify creates NO in-app notification for spoofed user", guest_notif is None,
      f"(got {dict(guest_notif) if guest_notif else None})")
check("guest subscription stored with NULL owner", guest_sub is not None and guest_sub["user_id"] is None,
      f"(got {dict(guest_sub) if guest_sub else None})")

print("\n=== 4. Header-first precedence + cookie fallback ===")

c = cookie_client(TOKEN1)
r = c.get("/api/wallet/balance", headers={"Authorization": "Bearer not-a-jwt"})
check("invalid bearer + valid cookie -> 200 (cookie fallback)", r.status_code == 200, f"(got {r.status_code})")

print("\n=== 5. Blueprint endpoint accepts a cookie-only session ===")

BODY = {"page_location": "Home page", "severity": "Low", "description": "scratch auth test"}
r = cookie_client(TOKEN1).post("/api/bug-report", data=BODY, content_type="multipart/form-data")
check("cookie-only /api/bug-report != 401", r.status_code != 401, f"(got {r.status_code})")

r = client.post("/api/bug-report", data=BODY, content_type="multipart/form-data")
check("no credential /api/bug-report -> 401", r.status_code == 401, f"(got {r.status_code})")

print("\n" + "=" * 50)
print(f"TOTAL: {len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    print("FAILED:", FAIL)
    sys.exit(1)
print("ALL TESTS PASSED ✅")
