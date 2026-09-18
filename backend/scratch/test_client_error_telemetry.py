"""Client error telemetry endpoint tests (isolated DB, no live Shiprocket/admin email).

Same pattern as test_multivendor_profile.py:
  - Copies backend/jdlx.db to /tmp (real DB untouched)
  - Boots the Flask app with DATABASE_PATH + FORCE_LOCAL_DB
  - Exercises capture + admin endpoints with a minted admin token
"""
import json
import os
import shutil
import sqlite3
import sys
import threading
import time
import urllib.request

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

SOURCE_DB = os.path.join(BACKEND_DIR, "jdlx.db")
TEST_DB = "/tmp/jdlx_errtest_endpoint.db"
PORT = 5577
BASE = f"http://localhost:{PORT}"
ADMIN_ID = 4

results = []


def check(name, ok, extra=""):
    results.append((name, bool(ok)))
    print(f"{'PASS' if ok else 'FAIL'} — {name}{' (' + str(extra) + ')' if extra else ''}")


def b64url(buf):
    import base64
    return base64.urlsafe_b64encode(buf).decode().rstrip('=')


def mint(secret, user_id, role, jti):
    import hmac
    from hashlib import sha256
    now = int(time.time())
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64url(json.dumps({
        "user_id": user_id, "email": "t@t.com", "role": role,
        "iat": now, "jti": jti, "exp": now + 3600,
    }).encode())
    sig = b64url(hmac.new(secret.encode(), f"{header}.{payload}".encode(), sha256).digest())
    return f"{header}.{payload}.{sig}"


def req(method, path, body=None, token=None, expect_status=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if body is not None:
        r.add_header('Content-Type', 'application/json')
    if token:
        r.add_header('Authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            return resp.status, json.loads(resp.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}')


def main():
    shutil.copyfile(SOURCE_DB, TEST_DB)
    conn = sqlite3.connect(TEST_DB)
    conn.execute("DELETE FROM rate_limits")
    conn.commit()
    conn.close()

    os.environ["DATABASE_PATH"] = TEST_DB
    os.environ["FORCE_LOCAL_DB"] = "1"
    os.environ["FORCE_HTTPS"] = "0"
    os.environ["DISABLE_RATE_LIMIT"] = "1"
    os.environ["PORT"] = str(PORT)

    # No real emails during tests (report-issue sends admin mail on success).
    import notifier
    notifier.send_individual_email = lambda *a, **k: True

    from app import app  # noqa: E402
    from database import get_db  # noqa: E402

    # Mint admin token with the SAME secret the app resolved.
    from jwt_config import get_jwt_secret
    admin_token = mint(get_jwt_secret(), ADMIN_ID, "super_admin", "errtest000000000001")

    client = app.test_client()

    def creq(method, path, body=None):
        headers = {"Authorization": f"Bearer {admin_token}"}
        if body is not None:
            return client.open(path, method=method, json=body, headers=headers)
        return client.open(path, method=method, headers=headers)

    # ── 1. Public capture: single crash event ──
    r = client.post('/api/client-error', json={
        "kind": "crash",
        "message": "TypeError: Cannot read properties of undefined (reading 'map')",
        "stack": "at ProductList (ProductList.jsx:42:18)",
        "page": "/",
        "session_id": "sess-abc",
        "app_version": "0.0.0",
        "context": {"cart_items": 2},
    })
    check("capture: single crash → 201", r.status_code == 201, r.status_code)
    body = r.get_json()
    check("capture: stored=1", (body.get('data') or {}).get('stored') == 1, body)

    # ── 2. Dedup: same error again → same group, count increments ──
    client.post('/api/client-error', json={
        "kind": "crash",
        "message": "TypeError: Cannot read properties of undefined (reading 'map')",
        "page": "/",
        "session_id": "sess-def",
    })
    r = creq('GET', '/api/admin/client-errors/groups')
    groups = r.get_json().get('data') or []
    check("groups: list returns 1 group after dedup", len(groups) == 1, len(groups))
    g = groups[0] if groups else {}
    check("groups: total_count=2", g.get('total_count') == 2, g.get('total_count'))
    check("groups: users_affected=2 (two sessions)", g.get('users_affected') == 2, g.get('users_affected'))
    check("groups: severity=high (crash default)", g.get('severity') == 'high', g.get('severity'))
    check("groups: status=new", g.get('status') == 'new', g.get('status'))
    group_id = g.get('id')

    # ── 3. Different message → different group ──
    client.post('/api/client-error', json={
        "kind": "unhandledrejection",
        "message": "Failed to fetch /api/products: network timeout",
        "page": "/cart",
        "session_id": "sess-abc",
    })
    r = creq('GET', '/api/admin/client-errors/groups')
    groups = r.get_json().get('data') or []
    check("groups: 2 distinct groups", len(groups) == 2, len(groups))

    # ── 4. Batch capture (client batches events) ──
    r = client.post('/api/client-error', json={"events": [
        {"kind": "api_failure", "message": "GET /api/settings 503 after 3 tries", "page": "/", "session_id": "sess-abc"},
        {"kind": "manual", "message": "User described: checkout button spin forever", "page": "/checkout", "session_id": "sess-abc", "severity": "medium"},
    ]})
    check("capture: batch of 2 → 201 stored=2", r.status_code == 201 and (r.get_json().get('data') or {}).get('stored') == 2, r.get_json())

    # ── 5. Filters ──
    r = creq('GET', '/api/admin/client-errors/groups?kind=crash')
    check("groups: filter kind=crash → 1", len(r.get_json().get('data') or []) == 1)
    r = creq('GET', '/api/admin/client-errors/groups?severity=medium')
    check("groups: filter severity=medium → 2", len(r.get_json().get('data') or []) == 2, len(r.get_json().get('data') or []))
    r = creq('GET', '/api/admin/client-errors/groups?q=checkout')
    check("groups: search q=checkout → 1", len(r.get_json().get('data') or []) == 1)

    # ── 6. Status workflow + auth ──
    r = creq('POST', f'/api/admin/client-errors/groups/{group_id}/status', {"status": "acknowledged"})
    check("status: acknowledge → 200", r.status_code == 200)
    r = creq('GET', '/api/admin/client-errors/groups?status=acknowledged')
    check("status: filter acknowledged → 1", len(r.get_json().get('data') or []) == 1)
    r = creq('POST', f'/api/admin/client-errors/groups/{group_id}/status', {"status": "bogus"})
    check("status: invalid → 400", r.status_code == 400)
    r = client.post(f'/api/admin/client-errors/groups/{group_id}/status', json={"status": "fixed"})
    check("status: non-admin → 401/403", r.status_code in (401, 403), r.status_code)

    # ── 7. Regression signal: fixed group receives new events ──
    creq('POST', f'/api/admin/client-errors/groups/{group_id}/status', {"status": "fixed"})
    client.post('/api/client-error', json={
        "kind": "crash",
        "message": "TypeError: Cannot read properties of undefined (reading 'map')",
        "page": "/",
        "session_id": "sess-ghi",
    })
    r = creq('GET', '/api/admin/client-errors/groups?status=fixed')
    fixed = r.get_json().get('data') or []
    check("regression: fixed group re-flagged", len(fixed) == 1 and fixed[0].get('possible_regression') is True,
          fixed[0].get('possible_regression') if fixed else None)

    # ── 8. Group events (instances with context) ──
    r = creq('GET', f'/api/admin/client-errors/groups/{group_id}/events')
    evs = r.get_json().get('data') or []
    check("events: 3 instances for group", len(evs) == 3, len(evs))
    check("events: has stack/session fields", bool(evs) and 'stack' in evs[0] and 'session_id' in evs[0])

    # ── 9. Summary KPIs ──
    r = creq('GET', '/api/admin/client-errors/summary')
    s = (r.get_json().get('data') or {})
    check("summary: events_24h >= 6", (s.get('events_24h') or 0) >= 6, s.get('events_24h'))
    check("summary: groups_active >= 2", (s.get('groups_active') or 0) >= 2, s.get('groups_active'))
    check("summary: users_24h >= 3", (s.get('users_24h') or 0) >= 3, s.get('users_24h'))
    check("summary: top_group present", bool(s.get('top_group')))

    # ── 10. Anti-flood: same fingerprint hammered → capped ──
    for i in range(8):
        client.post('/api/client-error', json={
            "kind": "unhandledrejection",
            "message": "Failed to fetch /api/products: network timeout",
            "page": "/cart",
            "session_id": f"flood-{i}",
        })
    conn = sqlite3.connect(TEST_DB)
    cnt = conn.execute(
        "SELECT COUNT(*) FROM client_error_events WHERE message LIKE 'Failed to fetch /api/products%'"
    ).fetchone()[0]
    conn.close()
    check("anti-flood: events capped (<=120/hr, stored all here)", 0 < cnt < 20, cnt)

    # ── 11. Invalid payload rejected ──
    r = client.post('/api/client-error', json={"kind": "crash", "message": ""})
    check("capture: empty message → 400", r.status_code == 400, r.status_code)
    r = client.post('/api/client-error', data=b'not-json', content_type='application/json')
    check("capture: garbage body → 400", r.status_code == 400, r.status_code)

    # ── 12. Legacy issue_reports viewer (read-only additive) ──
    conn = sqlite3.connect(TEST_DB)
    conn.execute("INSERT INTO issue_reports (user_id, error_type, page, description) VALUES ('1', 'API Connection Failed', '/cart', 'test report')")
    conn.commit()
    conn.close()
    r = creq('GET', '/api/admin/issue-reports')
    reports = r.get_json().get('data') or []
    check("issue-reports: viewer returns seeded row", len(reports) >= 1 and reports[0].get('error_type') == 'API Connection Failed')
    check("issue-reports: joined user name", bool(reports) and reports[0].get('user_name') is not None)
    r = client.get('/api/admin/issue-reports')
    check("issue-reports: non-admin → 401/403", r.status_code in (401, 403), r.status_code)

    # ── 13. Manual report endpoint still works (regression; email mocked) ──
    r = client.post('/api/report-issue', json={
        "error_type": "API Connection Failed", "page": "/", "timestamp": "2026-09-15T10:00:00Z",
        "user_id": "1", "description": "regression check",
    })
    check("legacy /api/report-issue still works", r.status_code == 201, r.status_code)

    passed = sum(1 for _, ok in results if ok)
    print(f"\n===== {passed}/{len(results)} PASSED =====")
    return 0 if passed == len(results) else 1


if __name__ == '__main__':
    sys.exit(main())
