"""Test the new email OTP signup/login endpoints via Flask test client.

- Fake send_individual_email / send_welcome_email (no real emails go out)
- OTP is read straight from the customer_email_otps table
- Cleans up the test user + OTP rows afterwards
"""
import sys, os, re, sqlite3
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as app_module
import database

DB_PATH = database.DATABASE_PATH

sent = []
app_module.send_individual_email = lambda to, name, subject, message: sent.append((to, subject, message)) or True
app_module.send_welcome_email = lambda to, name: sent.append((to, 'WELCOME', name)) or True

client = app_module.app.test_client()
SECURE_ENV = {'wsgi.url_scheme': 'https'}

# Unique remote IP per request so the per-IP rate limits never trip during the
# test run (rate limiting itself is Flask-Limiter's concern, not this suite's).
_IP_COUNTER = [0]
def _env():
    _IP_COUNTER[0] += 1
    return {**SECURE_ENV, 'REMOTE_ADDR': f'10.9.8.{_IP_COUNTER[0] % 250 + 1}'}

def post(url, **kw):
    kw.setdefault('environ_overrides', _env())
    return client.post(url, **kw)

def get(url, **kw):
    kw.setdefault('environ_overrides', _env())
    return client.get(url, **kw)

TEST_EMAIL = "otp_flow_test@test.local"

def db_conn():
    return sqlite3.connect(DB_PATH)

OTP_SETTING_KEYS = ('otp_resend_cooldown_base', 'otp_resend_cooldown_step', 'otp_resend_cooldown_max', 'otp_resend_max', 'otp_expiry_seconds')

def cleanup():
    conn = db_conn()
    for em in (TEST_EMAIL, "dbg@test.local", "otp_escalate@test.local"):
        conn.execute("DELETE FROM customer_email_otps WHERE email = ?", (em,))
        conn.execute("DELETE FROM google_link_otps WHERE email = ?", (em,))
        conn.execute("DELETE FROM users WHERE email = ?", (em,))
    conn.executemany("DELETE FROM system_settings WHERE key = ?", [(k,) for k in OTP_SETTING_KEYS])
    conn.commit()
    conn.close()

def set_otp_settings(values):
    conn = db_conn()
    for k, v in values.items():
        conn.execute("INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (k, str(v)))
    conn.commit()
    conn.close()

def backdate_last_sent(table, email, minutes=2, google_id=None):
    conn = db_conn()
    if table == 'customer_email_otps':
        conn.execute("UPDATE customer_email_otps SET last_sent_at = datetime('now', ?) WHERE email = ?", (f'-{minutes} minutes', email))
    else:
        conn.execute("UPDATE google_link_otps SET last_sent_at = datetime('now', ?) WHERE email = ? AND google_id = ?", (f'-{minutes} minutes', email, google_id))
    conn.commit()
    conn.close()

def latest_otp(email):
    conn = db_conn()
    row = conn.execute(
        "SELECT otp_hash, otp_salt FROM customer_email_otps WHERE email = ? ORDER BY id DESC LIMIT 1",
        (email,)
    ).fetchone()
    conn.close()
    if not row:
        return None
    # brute-force the 6-digit OTP from hash/salt (test-only)
    import hashlib
    for i in range(1000000):
        if hashlib.sha256(f"{row[1]}:{i:06d}".encode()).hexdigest() == row[0]:
            return f"{i:06d}"
    return None

failures = []

def check(name, cond, extra=""):
    status = "PASS" if cond else "FAIL"
    if not cond:
        failures.append(name)
    print(f"  [{status}] {name} {extra}")

cleanup()
try:
    print("== 1. send-otp for new email ==")
    r = post('/api/auth/email/send-otp', json={"email": TEST_EMAIL})
    check("send-otp returns 200", r.status_code == 200, f"({r.status_code})")
    otp = latest_otp(TEST_EMAIL)
    check("otp stored in DB", otp is not None)
    check("otp email was 'sent'", any(to == TEST_EMAIL for to, _, _ in sent))

    print("== 2. verify-otp wrong OTP ==")
    r = post('/api/auth/email/verify-otp', json={"email": TEST_EMAIL, "otp": "000000"})
    check("wrong otp -> 401", r.status_code == 401, f"({r.status_code})")

    print("== 3. verify-otp correct OTP (signup) ==")
    r = post('/api/auth/email/verify-otp', json={"email": TEST_EMAIL, "otp": otp})
    check("correct otp -> 200", r.status_code == 200, f"({r.status_code})")
    data = r.get_json()
    check("user created + returned", data and data.get('user') and data['user'].get('email') == TEST_EMAIL)
    check("auth cookie set", 'token' in (r.headers.get('Set-Cookie') or ''))
    check("welcome email sent", any(to == TEST_EMAIL and subj == 'WELCOME' for to, subj, _ in sent))

    print("== 4. existing user login via OTP ==")
    sent.clear()
    r = post('/api/auth/email/send-otp', json={"email": TEST_EMAIL})
    check("resend otp -> 200", r.status_code == 200, f"({r.status_code})")
    otp2 = latest_otp(TEST_EMAIL)
    check("new otp stored", otp2 is not None)
    r = post('/api/auth/email/verify-otp', json={"email": TEST_EMAIL, "otp": otp2})
    check("existing user login -> 200", r.status_code == 200, f"({r.status_code})")
    data = r.get_json()
    check("same user id returned", data and data['user'] and data['user'].get('id') is not None)

    print("== 5. invalid email rejected ==")
    r = post('/api/auth/email/send-otp', json={"email": "not-an-email"})
    check("invalid email -> 400", r.status_code == 400, f"({r.status_code})")

    print("== 6. otp one-time use (replay blocked) ==")
    r = post('/api/auth/email/verify-otp', json={"email": TEST_EMAIL, "otp": otp2})
    check("replayed otp -> 401", r.status_code == 401, f"({r.status_code})")

    print("== 7. process_google_user_login require_otp for existing user ==")
    with app_module.app.test_request_context('/google/callback?flow=user'):
        result = app_module.process_google_user_login('google_test_1', TEST_EMAIL, 'Test', None, '127.0.0.1', require_otp=True)
    check("existing google login -> link_required", isinstance(result, dict) and result.get('link_required') is True)
    conn = db_conn()
    row = conn.execute("SELECT * FROM google_link_otps WHERE email = ? ORDER BY id DESC LIMIT 1", (TEST_EMAIL,)).fetchone()
    conn.close()
    check("google otp row inserted", row is not None)
    # clean the google otp row created by this check
    conn = db_conn()
    conn.execute("DELETE FROM google_link_otps WHERE email = ?", (TEST_EMAIL,))
    conn.commit()
    conn.close()

    print("== 7b. google link-resend replaces the OTP (after cooldown elapses) ==")
    with app_module.app.test_request_context('/google/callback?flow=user'):
        app_module.process_google_user_login('google_resend_1', TEST_EMAIL, 'Test', None, '127.0.0.1', require_otp=True)
    conn = db_conn()
    row1 = conn.execute("SELECT otp_hash FROM google_link_otps WHERE email = ? AND google_id = 'google_resend_1' ORDER BY id DESC LIMIT 1", (TEST_EMAIL,)).fetchone()
    conn.close()
    # Immediate resend must be blocked by the cooldown
    r = post('/api/auth/google/link-resend', json={"email": TEST_EMAIL, "google_id": "google_resend_1"})
    check("immediate link-resend -> 429 cooldown", r.status_code == 429, f"({r.status_code})")
    data = r.get_json()
    check("429 carries cooldown_seconds", data and data.get('data', {}).get('cooldown_seconds', 0) > 0)
    # Backdate last_sent_at so the cooldown has elapsed, then resend works
    backdate_last_sent('google_link_otps', TEST_EMAIL, minutes=2, google_id='google_resend_1')
    r = post('/api/auth/google/link-resend', json={"email": TEST_EMAIL, "google_id": "google_resend_1"})
    check("link-resend after cooldown -> 200", r.status_code == 200, f"({r.status_code})")
    data = r.get_json()
    check("resend_count=1", data and data['data'].get('resend_count') == 1)
    check("next cooldown escalated (base+step)", data and data['data'].get('cooldown_seconds') == 120, f"({data and data['data'].get('cooldown_seconds')})")
    check("resend email sent", any(to == TEST_EMAIL and 'OTP' in subj for to, subj, _ in sent))
    conn = db_conn()
    row2 = conn.execute("SELECT otp_hash FROM google_link_otps WHERE email = ? AND google_id = 'google_resend_1' ORDER BY id DESC LIMIT 1", (TEST_EMAIL,)).fetchone()
    check("otp replaced (new hash)", row1 and row2 and row1[0] != row2[0])
    check("only one active row", conn.execute("SELECT COUNT(*) FROM google_link_otps WHERE email = ? AND google_id = 'google_resend_1'", (TEST_EMAIL,)).fetchone()[0] == 1)
    conn.execute("DELETE FROM google_link_otps WHERE email = ?", (TEST_EMAIL,))
    conn.commit()
    conn.close()

    print("== 8. require_otp=False (admin path) still instant-logins existing user ==")
    # Link TEST_EMAIL's user to google_test_1 first (same-google-id scenario)
    conn = db_conn()
    conn.execute("UPDATE users SET google_id = 'google_test_1' WHERE email = ?", (TEST_EMAIL,))
    conn.commit()
    conn.close()
    with app_module.app.test_request_context('/admin/auth/google/callback'):
        result = app_module.process_google_user_login('google_test_1', TEST_EMAIL, 'Test', None, '127.0.0.1', require_otp=False)
    check("admin path returns user tuple", isinstance(result, tuple) and len(result) == 2)
    # and require_otp=True for the SAME google id now forces OTP
    with app_module.app.test_request_context('/google/callback?flow=user'):
        result = app_module.process_google_user_login('google_test_1', TEST_EMAIL, 'Test', None, '127.0.0.1', require_otp=True)
    check("same-google-id with require_otp -> link_required", isinstance(result, dict) and result.get('link_required') is True)
    conn = db_conn()
    conn.execute("DELETE FROM google_link_otps WHERE email = ?", (TEST_EMAIL,))
    conn.commit()
    conn.close()

    print("== 9. require_otp True for NEW google user still auto-creates (no OTP) ==")
    new_email = "otp_new_google@test.local"
    with app_module.app.test_request_context('/google/callback?flow=user'):
        result = app_module.process_google_user_login('google_test_new', new_email, 'New', None, '127.0.0.1', require_otp=True)
    check("new google user auto-created", isinstance(result, tuple) and len(result) == 2)
    conn = db_conn()
    conn.execute("DELETE FROM users WHERE email = ?", (new_email,))
    conn.commit()
    conn.close()

    print("== 10. verify-token works with the cookie (session intact) ==")
    r = post('/api/auth/email/send-otp', json={"email": TEST_EMAIL})
    otp3 = latest_otp(TEST_EMAIL)
    r = post('/api/auth/email/verify-otp', json={"email": TEST_EMAIL, "otp": otp3})
    cookie = r.headers.get('Set-Cookie', '').split(';')[0]
    r2 = get('/api/auth/verify-token', headers={'Cookie': cookie})
    check("verify-token -> 200", r2.status_code == 200, f"({r2.status_code})")

    print("== 11. escalating resend cooldown + admin settings override ==")
    sent.clear()
    ESC = "otp_escalate@test.local"
    set_otp_settings({'otp_resend_cooldown_base': 1, 'otp_resend_cooldown_step': 1, 'otp_resend_cooldown_max': 3, 'otp_resend_max': 2, 'otp_expiry_seconds': 600})
    r = post('/api/auth/email/send-otp', json={"email": ESC})
    check("fresh send -> 200", r.status_code == 200, f"({r.status_code})")
    d = r.get_json()['data']
    check("fresh send resend_count=0, cooldown=base(1)", d['resend_count'] == 0 and d['cooldown_seconds'] == 1, f"{d}")
    r = post('/api/auth/email/send-otp', json={"email": ESC})
    check("immediate resend -> 429", r.status_code == 429, f"({r.status_code})")
    backdate_last_sent('customer_email_otps', ESC, minutes=1)
    r = post('/api/auth/email/send-otp', json={"email": ESC})
    d = r.get_json()['data']
    check("resend #1 -> 200, resend_count=1, cooldown=base+step(2)", r.status_code == 200 and d['resend_count'] == 1 and d['cooldown_seconds'] == 2, f"{r.status_code} {d}")
    backdate_last_sent('customer_email_otps', ESC, minutes=1)
    r = post('/api/auth/email/send-otp', json={"email": ESC})
    d = r.get_json()['data']
    check("resend #2 -> 200, resend_count=2, cooldown capped(3)", r.status_code == 200 and d['resend_count'] == 2 and d['cooldown_seconds'] == 3, f"{r.status_code} {d}")
    backdate_last_sent('customer_email_otps', ESC, minutes=1)
    r = post('/api/auth/email/send-otp', json={"email": ESC})
    check("resend beyond max -> 429 blocked", r.status_code == 429, f"({r.status_code})")
    conn = db_conn()
    conn.executemany("DELETE FROM system_settings WHERE key = ?", [(k,) for k in OTP_SETTING_KEYS])
    conn.commit()
    conn.close()

except Exception as e:
    import traceback
    traceback.print_exc()
    failures.append(f"EXCEPTION: {e}")
finally:
    cleanup()

print()
if failures:
    print(f"❌ {len(failures)} FAILURE(S): {failures}")
    sys.exit(1)
print("✅ ALL TESTS PASSED")