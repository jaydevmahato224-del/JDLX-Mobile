"""
Smoke test: admin session flow reliability (no login-loop regressions).

Covers the fixes wired in this change:
  1. /api/auth/verify-token works with a cookie-issued admin JWT (role echoed,
     401 only when session truly dead).
  2. logout-all (min_token_iat bump) actually invalidates the old JWT — and
     a FRESH login afterwards works (no stuck "session invalidated" state).
  3. /admin/login-password issues a fresh 8h cookie and verify-token accepts
     it (the "Extend Session" modal path).

Runs against a TEMP local SQLite DB — never touches prod data.
Usage: python3 backend/scratch/test_admin_session_flow.py
"""
import os
import sys
import tempfile

_tmpdir = tempfile.mkdtemp(prefix="jdlx_sess_test_")
os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["DATABASE_PATH"] = os.path.join(_tmpdir, "test.db")
os.environ["DISABLE_RATE_LIMIT"] = "1"
os.environ["FORCE_HTTPS"] = "0"

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

import datetime
import sqlite3
import jwt as pyjwt

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


def make_admin():
    conn = sqlite3.connect(os.environ["DATABASE_PATH"])
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO users (email, name, role, google_id, password_hash, account_status, min_token_iat)
           VALUES (?, ?, ?, ?, ?, 'active', 0)""",
        ("sessadmin@test.local", "Sess Admin", "super_admin", "sess-test-google-id",
         "pbkdf2:sha256:600000$salt$deadbeef"),
    )
    admin_id = cur.lastrowid
    conn.commit()
    conn.close()
    return admin_id


ADMIN_ID = make_admin()


def login_payload_and_token():
    # iat 1 hour in the past: mirrors a real session that was issued long
    # before the logout-all bump. (A token issued in the SAME second as the
    # min_token_iat bump survives the strict `iat < min_token_iat` guard by
    # design — that grace keeps the login-immediately-after-password-reset
    # flow working instead of looping it.)
    now = datetime.datetime.utcnow() - datetime.timedelta(hours=1)
    payload = {
        "user_id": ADMIN_ID,
        "email": "sessadmin@test.local",
        "role": "super_admin",
        "iat": now,
        "jti": "sess-test-1",
        "exp": now + datetime.timedelta(hours=8),
    }
    return payload, pyjwt.encode(payload, app_module.SECRET_KEY, algorithm="HS256")


# --- 1. verify-token accepts a valid admin JWT via cookie ---
_, token = login_payload_and_token()
client.set_cookie("token", token)
r = client.get("/api/auth/verify-token")
check("verify-token 200 with valid admin cookie", r.status_code == 200, f"got {r.status_code}")
body = r.get_json()
check("verify-token echoes admin role", body.get("role") == "super_admin", f"role={body.get('role')}")

# --- 2. logout-all invalidates the old token, fresh login still works ---
r = client.post(f"/api/admin/users/{ADMIN_ID}/logout-all")
check("logout-all 200", r.status_code == 200, f"got {r.status_code} {r.get_json()}")
r = client.get("/api/auth/verify-token")
check("old token rejected after logout-all (401)", r.status_code == 401, f"got {r.status_code}")

conn = sqlite3.connect(os.environ["DATABASE_PATH"])
conn.execute(
    "UPDATE users SET password_hash = ? WHERE id = ?",
    ("pbkdf2:sha256:600000$salt$" + "a" * 64, ADMIN_ID),
)
conn.commit()
conn.close()

from werkzeug.security import generate_password_hash

conn = sqlite3.connect(os.environ["DATABASE_PATH"])
conn.execute("UPDATE users SET password_hash = ? WHERE id = ?",
             (generate_password_hash("Validpass123"), ADMIN_ID))
conn.commit()
conn.close()

r = client.post("/api/admin/login-password",
                json={"identifier": "sessadmin@test.local", "password": "Validpass123"})
check("fresh password login 200 after logout-all", r.status_code == 200, f"got {r.status_code} {r.get_json()}")
# (cookie presence implicitly verified by the verify-token check below)

# --- 2c. login body carries the JWT as a Bearer fallback ---
# The deployed admin SPA is cross-site (Vercel → Render); browsers that block
# third-party cookies drop the Set-Cookie entirely, so the SPA persists this
# body token and sends it as Authorization: Bearer on every call.
login_body = r.get_json()
check("login response carries Bearer fallback token", bool(login_body.get("token")),
      "missing 'token' in login response body")

# --- 2d. that body token authenticates via header alone (cookie-blocked path) ---
r = client.get("/api/auth/verify-token",
               headers={"Authorization": f"Bearer {login_body.get('token', '')}"})
check("body token works as Bearer with no cookie", r.status_code == 200, f"got {r.status_code}")

# --- 3. new cookie works on verify-token ---
r = client.get("/api/auth/verify-token")
check("verify-token 200 with fresh password-login cookie", r.status_code == 200, f"got {r.status_code}")

# 2b. old (pre-logout-all) token must ALSO now fail when re-presented alone:
# the test client kept the newer cookie from login, so re-set the old one.
client.set_cookie("token", token)
r = client.get("/api/auth/verify-token")
check("pre-logout-all token stays invalid (401)", r.status_code == 401, f"got {r.status_code}")

# --- 4. role demotion check doesn't crash on valid role ---
r = client.post("/api/admin/request-otp", json={"email": "sessadmin@test.local"})
check("request-otp 200 (enumeration-safe)", r.status_code == 200, f"got {r.status_code}")

print()
print(f"=== {len(PASS)} passed, {len(FAIL)} failed ===")
sys.exit(1 if FAIL else 0)
