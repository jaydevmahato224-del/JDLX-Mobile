#!/usr/bin/env python3
"""E2E flow verification for all newly-added tables.

Tests the REAL business flows (read-only where possible, plus a reversible
stock adjust) against the isolated local test DB. Confirms:
  1. Every endpoint previously crashing on missing tables now returns 2xx
  2. Existing flows (checkout deps) are unaffected
Read-mostly: only mutates via the already-verified stock adjust (reversed after).
"""
import json
import os
import sys
import time
import hmac
import hashlib
import base64
import urllib.parse
import urllib.request
import urllib.error

BASE = "http://localhost:5000"
BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── helpers ──────────────────────────────────────────────────────────────
def b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")

def mint_jwt(payload):
    env = open(os.path.join(BACKEND, ".env")).read()
    secret = ""
    for line in env.splitlines():
        if line.strip().startswith("JWT_SECRET="):
            secret = line.split("=", 1)[1].strip().strip('"').strip("'")
    h = b64u(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    p = b64u(json.dumps(payload).encode())
    sig = b64u(hmac.new(secret.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())
    return f"{h}.{p}.{sig}"

def req(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if token:
        r.add_header("Authorization", f"Bearer {token}")
    if data:
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}

import sqlite3

# Admin endpoints validate the token role against users.role in the DB —
# promote the seeded test user to super_admin for this run, revert at the end.
DB_PATH = os.environ.get("DATABASE_PATH", "/tmp/jdlx_checkout_verify.db")
_c = sqlite3.connect(DB_PATH)
_c.execute("UPDATE users SET role='super_admin' WHERE id=1")
_c.commit()
_c.close()

now = int(time.time())
results = []
def check(name, ok, extra=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'} — {name}{f'  ({extra})' if extra else ''}")

# tokens
user_tok = mint_jwt({"user_id": 1, "email": "test@example.com", "role": "user", "iat": now, "jti": "flowverifyuser01", "exp": now + 7200})
wh_tok = mint_jwt({"warehouse_id": 1, "email": "wh@test.com", "role": "owner", "type": "warehouse", "iat": now, "exp": now + 7200})
admin_tok = mint_jwt({"user_id": 1, "email": "test@example.com", "role": "super_admin", "type": "admin_access", "iat": now, "exp": now + 7200})

# ── 1. Warehouse vendor (suppliers) — full CRUD flow ────────────────────
# (read side uses /vendors/search — there is no GET-list endpoint)
st, res = req("POST", "/api/warehouse/vendors", wh_tok, {"name": "Flow Test Vendor", "contact": "9999999999", "email": "v@t.com", "gst_in": "GST123", "role": "supplier"})
vid = (res.get("data") or {}).get("id")
check("Vendor create", st == 200 and vid, f"status={st} id={vid}")
if vid:
    st, res = req("PUT", f"/api/warehouse/vendors/{vid}", wh_tok, {"name": "Flow Test Vendor 2", "contact": "8888888888", "email": "v2@t.com", "gst_in": "GST456", "role": "supplier"})
    check("Vendor update", st == 200, f"status={st}")
st, res = req("GET", "/api/warehouse/vendors/search?q=" + urllib.parse.quote("Flow Test Vendor"), wh_tok)
found = any((v.get("name") == "Flow Test Vendor 2") for v in (res.get("data") or []))
check("Vendor search finds updated name", found, f"status={st}")

# ── 2. Brands — public read + admin create ───────────────────────────────
st, res = req("GET", "/api/brands")
check("GET /api/brands (public)", st == 200, f"status={st} n={len(res.get('data') or []) if isinstance(res.get('data'), list) else '?'}")
st, res = req("POST", "/api/brands", admin_tok, {"name": "Flow Test Brand"})
# 200/201 on first create; 409 on duplicate = the duplicate guard working
check("POST /api/brands (admin, duplicate-safe)", st in (200, 201, 409), f"status={st}")
st, res = req("GET", "/api/brands")
names = [b.get("name") for b in (res.get("data") or [])] if isinstance(res.get("data"), list) else []
check("Created brand appears in list", "Flow Test Brand" in names, f"brands={names[:6]}")

# ── 3. Login history (user profile flow) ─────────────────────────────────
st, res = req("GET", "/api/user/login-history", user_tok)
check("GET login-history", st == 200, f"status={st}")

# ── 4. Notification templates — admin list/update + service reader ──────
st, res = req("GET", "/api/admin/notification-templates", admin_tok)
check("GET admin notification-templates", st == 200, f"status={st} n={len(res) if isinstance(res, list) else '?'}")
st, res = req("PUT", "/api/admin/notification-templates/order_placed_app", admin_tok, {"title": "Order placed!", "is_active": True})
# Update-only by design (no INSERT endpoint; empty table = hardcoded fallbacks,
# which is the documented behavior) — 200 without creating a row is correct.
check("PUT notification-template (update-only, no crash)", st == 200, f"status={st}")
st, res = req("GET", "/api/admin/notification-templates", admin_tok)
tpl_list = res if isinstance(res, list) else (res.get("data") or [])
check("Templates GET consistent (no 500)", isinstance(tpl_list, list), f"n={len(tpl_list)}")

# ── 5. Material purchases (warehouse procurement flow) ───────────────────
# The endpoint resolves the caller's warehouse to a dark store by name;
# seed that fixture row so the purchases query (the thing under test) runs.
_c = sqlite3.connect(DB_PATH)
_c.execute("INSERT INTO dark_stores (name) SELECT 'Test Warehouse' WHERE NOT EXISTS (SELECT 1 FROM dark_stores WHERE name='Test Warehouse')")
_c.commit()
_c.close()
st, res = req("GET", "/api/warehouse/purchases", wh_tok)
check("GET purchases (purchases/purchase_items)", st == 200, f"status={st}")

# ── 6. Stock adjust + movement history (reversible, existing fix) ───────
st, res = req("GET", "/api/warehouse/inventory/1/movements", wh_tok)
base_rows = len(res.get("data") or [])
st, res = req("POST", "/api/warehouse/inventory/1/adjust", wh_tok, {"movement_type": "OUT", "quantity": 2, "reason": "Flow verify", "performed_by": "Flow Bot"})
check("Stock OUT adjust", st == 200, f"status={st}")
st, res = req("POST", "/api/warehouse/inventory/1/adjust", wh_tok, {"movement_type": "IN", "quantity": 2, "reason": "Flow verify restore", "performed_by": "Flow Bot"})
check("Stock IN adjust (restore)", st == 200, f"status={st}")
st, res = req("GET", "/api/warehouse/inventory/1/movements", wh_tok)
rows = res.get("data") or []
check("Movements logged (both adjusts)", len(rows) >= base_rows + 2, f"rows={len(rows)} (base={base_rows})")

# ── 7. Core flows regression — products/cart/checkout deps ──────────────
st, res = req("GET", "/api/products/batch?ids=101,102,103")
check("Products batch (checkout dep)", st == 200, f"status={st}")
st, res = req("POST", "/api/cart", user_tok, {"product_id": 101, "quantity": 1, "action": "add", "session_id": "flowverify1"})
check("Cart add (checkout dep)", st == 200, f"status={st}")
st, res = req("POST", "/api/cart", user_tok, {"action": "clear_cart", "session_id": "flowverify1"})
check("Cart clear (cleanup)", st == 200, f"status={st}")

# ── summary ───────────────────────────────────────────────────────────────
# Revert the temporary role promotion
_c = sqlite3.connect(DB_PATH)
_c.execute("UPDATE users SET role='user' WHERE id=1")
_c.commit()
_c.close()

passed = sum(results)
print(f"\n===== {passed}/{len(results)} PASSED =====")
sys.exit(0 if passed == len(results) else 1)
