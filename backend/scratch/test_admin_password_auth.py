"""
E2E test for the admin password login + security question flows.

Covers:
  1. Password login works after setting a password directly in the test DB
  2. Wrong password rejected (401) + lockout counts
  3. Security status endpoint (has_password / has_security_question)
  4. Security question setup (auth required, current answer required to replace)
  5. status-lookup returns a question (enumeration-safe decoy for unknown)
  6. reset-password with wrong answer fails generically, right answer works
  7. change-password requires security answer + current password
  8. update-profile (email/phone) requires security answer
  9. OTP reauth flow (existing) still works — no regression

Usage:  python3 backend/scratch/test_admin_password_auth.py
"""
import datetime
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request

import jwt
from werkzeug.security import generate_password_hash, check_password_hash

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_DB = os.path.join(BACKEND_DIR, "jdlx.db")
TEST_DB = "/tmp/jdlx_admin_auth_test.db"
SERVER_LOG = "/tmp/jdlx_admin_auth_server.log"
PORT = 5597
BASE = f"http://127.0.0.1:{PORT}"

JWT_SECRET = None
_env_path = os.path.join(BACKEND_DIR, ".env")
if os.path.exists(_env_path):
    for line in open(_env_path):
        if line.strip().startswith("JWT_SECRET="):
            JWT_SECRET = line.split("=", 1)[1].strip().strip('"').strip("'")
            break
if not JWT_SECRET:
    print("FAIL: JWT_SECRET not found in backend/.env")
    sys.exit(1)

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))


def db(query, params=(), fetchone=False):
    conn = sqlite3.connect(TEST_DB)
    conn.row_factory = sqlite3.Row
    cur = conn.execute(query, params)
    rows = cur.fetchall()
    conn.commit()
    conn.close()
    return (rows[0] if rows else None) if fetchone else rows


def api(method, path, token=None, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


def mint(payload_extra, hours=8):
    now = datetime.datetime.now(datetime.UTC)
    import secrets
    payload = {"iat": now, "jti": secrets.token_hex(16), "exp": now + datetime.timedelta(hours=hours)}
    payload.update(payload_extra)
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def clear_lockout(identifier):
    """Clear failed-attempt history for the identifier in the ISOLATED test DB.

    The suite intentionally makes many wrong-answer attempts (that's what we're
    testing); without this, the shared 10-minute brute-force lockout bleeds
    across phases and masks the later success-path assertions.
    """
    db("DELETE FROM login_attempts WHERE email = ?", ((identifier or '').lower(),))


def wait_for_server(proc, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        try:
            status, _ = api("GET", "/")
            if status == 200:
                return True
        except Exception:
            pass
        time.sleep(1)
    return False


def main():
    print("== E2E: admin password auth + security questions ==")
    # Prepare DB: copy + run the migration + seed an admin with a password
    shutil.copyfile(SOURCE_DB, TEST_DB)

    # DATABASE_PATH must be set BEFORE importing the migration module.
    # FORCE_LOCAL_DB is mandatory alongside DATABASE_PATH — the production
    # safety guard in migrate_admin_auth.py refuses otherwise (it protects
    # against accidentally migrating the remote Turso DB).
    os.environ["DATABASE_PATH"] = TEST_DB
    os.environ["FORCE_LOCAL_DB"] = "1"
    if BACKEND_DIR not in sys.path:
        sys.path.insert(0, BACKEND_DIR)
    import migrate_admin_auth
    import importlib
    importlib.reload(migrate_admin_auth)
    migrate_admin_auth.migrate()

    ADMIN_EMAIL = "pw-auth-admin@example.com"
    ADMIN_PHONE = "9800000001"
    PASSWORD = "TestPass123"

    db("INSERT INTO users (google_id, name, email, role, password_hash, admin_phone, security_question, security_answer_hash) "
       "VALUES ('pw_auth_gid', 'PW Admin', ?, 'admin', ?, ?, ?, ?)",
       (ADMIN_EMAIL, generate_password_hash(PASSWORD), ADMIN_PHONE,
        "What was the name of your first school?",
        generate_password_hash("greenpark")))

    admin_id = db("SELECT id FROM users WHERE email=?", (ADMIN_EMAIL,), fetchone=True)["id"]
    print(f"  admin #{admin_id} {ADMIN_EMAIL} phone={ADMIN_PHONE}")

    token = mint({"user_id": admin_id, "email": ADMIN_EMAIL, "role": "admin"})

    env = dict(os.environ)
    env.update({
        "DATABASE_PATH": TEST_DB,
        "FORCE_LOCAL_DB": "1",
        "FORCE_HTTPS": "0",
        "PORT": str(PORT),
        "DISABLE_RATE_LIMIT": "1",
        "FLASK_DEBUG": "",
    })
    log = open(SERVER_LOG, "w")
    proc = subprocess.Popen([sys.executable, os.path.join(BACKEND_DIR, "app.py")],
                            cwd=BACKEND_DIR, env=env, stdout=log, stderr=log,
                            start_new_session=True)
    try:
        check("server started", wait_for_server(proc))

        # --- 1. Password login (email) ---
        status, resp = api("POST", "/api/admin/login-password",
                           body={"identifier": ADMIN_EMAIL, "password": PASSWORD})
        check("password login via email (200)", status == 200 and resp.get("success"),
              f"status={status} resp={json.dumps(resp)[:150]}")
        check("login returns admin user", (resp.get("user") or {}).get("role") == "admin")

        # --- 2. Password login (mobile) ---
        status, resp = api("POST", "/api/admin/login-password",
                           body={"identifier": ADMIN_PHONE, "password": PASSWORD})
        check("password login via mobile (200)", status == 200 and resp.get("success"),
              f"status={status} resp={json.dumps(resp)[:150]}")

        # --- 3. Wrong password rejected generically ---
        status, resp = api("POST", "/api/admin/login-password",
                           body={"identifier": ADMIN_EMAIL, "password": "WrongPass999"})
        check("wrong password rejected (401)", status == 401 and resp.get("error") == "Invalid credentials",
              f"status={status} resp={json.dumps(resp)[:150]}")

        # --- 4. Unknown identifier: same generic error (no enumeration) ---
        status, resp = api("POST", "/api/admin/login-password",
                           body={"identifier": "nobody@example.com", "password": "Whatever123"})
        check("unknown identifier -> same 401 'Invalid credentials'",
              status == 401 and resp.get("error") == "Invalid credentials",
              f"status={status} resp={json.dumps(resp)[:150]}")

        # --- 5. Security status (authenticated) ---
        status, resp = api("GET", "/api/admin/security/status", token=token)
        data = resp.get("data") or {}
        check("security status (200)", status == 200)
        check("status has_password true", data.get("has_password") is True)
        check("status has_security_question true", data.get("has_security_question") is True)
        check("status exposes admin_phone", data.get("admin_phone") == ADMIN_PHONE)
        check("status lists question options", isinstance(data.get("questions"), list) and len(data["questions"]) >= 3)

        # --- 6. status-lookup: known admin returns real question ---
        status, resp = api("POST", "/api/admin/security/status-lookup",
                           body={"identifier": ADMIN_EMAIL})
        check("status-lookup returns question", status == 200 and
              (resp.get("data") or {}).get("security_question") == "What was the name of your first school?",
              f"resp={json.dumps(resp)[:150]}")

        # --- 7. status-lookup: unknown account also returns A question (decoy) ---
        status, resp = api("POST", "/api/admin/security/status-lookup",
                           body={"identifier": "ghost@example.com"})
        check("status-lookup decoy for unknown (no enumeration)",
              status == 200 and bool((resp.get("data") or {}).get("security_question")),
              f"status={status} resp={json.dumps(resp)[:150]}")

        # --- 8. reset-password with WRONG answer fails generically ---
        status, resp = api("POST", "/api/admin/security/reset-password",
                           body={"identifier": ADMIN_EMAIL, "security_answer": "wrong",
                                 "new_password": "NewPass123"})
        check("reset with wrong answer -> 401 generic", status == 401,
              f"status={status} resp={json.dumps(resp)[:150]}")
        clear_lockout(ADMIN_EMAIL)

        # --- 9. reset-password with RIGHT answer works ---
        status, resp = api("POST", "/api/admin/security/reset-password",
                           body={"identifier": ADMIN_EMAIL, "security_answer": "greenpark",
                                 "new_password": "NewPass123"})
        check("reset with correct answer (200)", status == 200 and resp.get("success"),
              f"status={status} resp={json.dumps(resp)[:150]}")

        # Old password must now fail, new must work
        status, _resp = api("POST", "/api/admin/login-password",
                            body={"identifier": ADMIN_EMAIL, "password": PASSWORD})
        check("old password invalid after reset (401)", status == 401)
        status, resp = api("POST", "/api/admin/login-password",
                           body={"identifier": ADMIN_EMAIL, "password": "NewPass123"})
        check("new password works after reset (200)", status == 200 and resp.get("success"))

        # --- 10. change-password via session: needs security answer + current password ---
        status, resp = api("POST", "/api/admin/security/change-password", token=token,
                           body={"current_password": "NewPass123", "new_password": "Changed456",
                                 "security_answer": "wrong"})
        check("change-password wrong answer rejected (401)", status == 401)
        clear_lockout(ADMIN_EMAIL)

        status, resp = api("POST", "/api/admin/security/change-password", token=token,
                           body={"current_password": "NewPass123", "new_password": "short",
                                 "security_answer": "greenpark"})
        check("change-password weak password rejected (400)", status == 400,
              f"status={status}")

        status, resp = api("POST", "/api/admin/security/change-password", token=token,
                           body={"current_password": "NewPass123", "new_password": "Changed456",
                                 "security_answer": "greenpark"})
        check("change-password success (200)", status == 200 and resp.get("success"),
              f"status={status} resp={json.dumps(resp)[:150]}")

        status, resp = api("POST", "/api/admin/login-password",
                           body={"identifier": ADMIN_EMAIL, "password": "Changed456"})
        check("login works with changed password (200)", status == 200 and resp.get("success"))

        # --- 11. update-profile: security answer required ---
        status, resp = api("POST", "/api/admin/security/update-profile", token=token,
                           body={"admin_phone": "9811111222", "security_answer": "wrong"})
        check("profile update wrong answer rejected (401)", status == 401)
        clear_lockout(ADMIN_EMAIL)

        status, resp = api("POST", "/api/admin/security/update-profile", token=token,
                           body={"admin_phone": "9811111222", "security_answer": "greenpark"})
        check("profile update phone (200)", status == 200 and resp.get("success"),
              f"status={status} resp={json.dumps(resp)[:150]}")
        check("profile update returns fresh user", (resp.get("data") or {}).get("user", {}).get("admin_phone") == "9811111222")

        # Login with the NEW phone
        status, resp = api("POST", "/api/admin/login-password",
                           body={"identifier": "9811111222", "password": "Changed456"})
        check("login works with updated mobile (200)", status == 200 and resp.get("success"),
              f"status={status}")

        # --- 12. security question replace requires CURRENT answer ---
        status, resp = api("POST", "/api/admin/security/setup", token=token,
                           body={"security_question": "What is your mother's maiden name?",
                                 "security_answer": "sharma", "current_answer": "wrong"})
        check("replace question with wrong current answer rejected (401)", status == 401)
        clear_lockout(ADMIN_EMAIL)

        status, resp = api("POST", "/api/admin/security/setup", token=token,
                           body={"security_question": "What is your mother's maiden name?",
                                 "security_answer": "sharma", "current_answer": "greenpark"})
        check("replace question with correct current answer (200)", status == 200 and resp.get("success"),
              f"status={status} resp={json.dumps(resp)[:150]}")

        # New question now works for reset
        status, resp = api("POST", "/api/admin/security/reset-password",
                           body={"identifier": ADMIN_EMAIL, "security_answer": "sharma",
                                 "new_password": "Latest789"})
        check("reset works with new question answer (200)", status == 200 and resp.get("success"),
              f"status={status} resp={json.dumps(resp)[:150]}")

        # --- 13. Audit trail exists ---
        events = db("SELECT event_type FROM admin_security_events WHERE admin_id=?", (admin_id,))
        types = {r["event_type"] for r in events}
        check("audit events recorded", {"login_password", "password_change", "profile_update",
                                        "security_question_update"} <= types, f"got={types}")

        # --- 14. OTP reauth endpoints still alive (no regression) ---
        status, resp = api("POST", "/api/admin/request-otp", body={"email": ADMIN_EMAIL})
        check("existing OTP request endpoint intact", status in (200, 423),
              f"status={status}")

        # --- 15. Defense-in-depth: non-admin token rejected on admin security endpoints ---
        db("INSERT INTO users (google_id, name, email, role) VALUES ('pw_plain_gid','Plain User','pw-plain@example.com','user')")
        plain = db("SELECT id FROM users WHERE email='pw-plain@example.com'", fetchone=True)
        plain_token = mint({"user_id": plain["id"], "email": "pw-plain@example.com", "role": "user"})
        status, resp = api("GET", "/api/admin/security/status", token=plain_token)
        check("non-admin token rejected on security/status (403)", status == 403,
              f"status={status}")
        status, resp = api("POST", "/api/admin/security/update-profile", token=plain_token,
                           body={"admin_phone": "9800000099", "security_answer": "x"})
        check("non-admin token rejected on update-profile (403)", status == 403,
              f"status={status}")

    finally:
        try:
            proc.terminate()
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        log.close()

    print(f"\n== RESULT: {len(PASS)} passed, {len(FAIL)} failed ==")
    if FAIL:
        for f in FAIL:
            print(f"  FAILED: {f}")
        sys.exit(1)
    print("ALL GREEN ✅")


if __name__ == "__main__":
    main()
