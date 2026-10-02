"""Pipeline verify (isolated DB + live backend on :5011):

  agent_draft → warehouse complete → admin approve → storefront visible
  + the Active-status regression: a plain inventory edit (no toggle touch)
    must NOT flip products.status, and an explicit toggle must persist.

Checks:
  1. Inventory list exposes storefront_status (products.status) for prefill
  2. Plain PATCH edit (price only) preserves products.status ('available')
  3. Explicit toggle OFF → products.status 'unavailable'; store list hides it
  4. Toggle back ON → 'available'; store list shows it again
  5. Agent-draft complete flow: inventory row created, status 'available',
     approval_status 'pending'
  6. Admin approve → 'approved', status untouched
  7. Storefront list + detail show the approved product; detail carries
     status='available' (deep-fetch prefill source)

Run:  python3 scratch/verify_pipeline_status.py
Read-only wrt production: FORCE_LOCAL_DB=1 + DATABASE_PATH=/tmp file.
"""
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request

DB = "/tmp/jdlx_pipeline.db"
PORT = 5011
BASE = f"http://localhost:{PORT}"

if os.path.exists(DB):
    os.remove(DB)

os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["DATABASE_PATH"] = DB

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import database  # noqa: E402

database.init_db()
conn = database.get_db()
cur = conn.cursor()

# ── warehouse 1 ──────────────────────────────────────────────────────────────
cur.execute(
    "INSERT INTO warehouses (warehouse_name, email, owner_name, account_status) "
    "VALUES ('Pipeline WH', 'pwh@example.com', 'Pipe Owner', 'active')"
)

# ── add-product agent 1 ──────────────────────────────────────────────────────
cur.execute(
    "INSERT INTO add_product_agents (warehouse_id, agent_code, name, email, phone, status) "
    "VALUES (1, 'AG-PIPE1', 'Pipe Agent', 'agent@example.com', '9000000000', 'active')"
)

# ── product 1: agent_draft (like AP-840306 pre-completion) ──────────────────
cur.execute(
    """INSERT INTO products (name, description, category, price, stock, images,
                             status, lifecycle_state, approval_status, approval_source,
                             added_by_agent_id, added_by_agent_code)
       VALUES ('Pipe Draft Product', 'draft desc', 'cases', 0, 0, '[]',
               'available', 'live', 'agent_draft', 'agent', 1, 'AG-PIPE1')"""
)
draft_pid = cur.lastrowid
# agent drafts carry NO inventory row until the manager completes them

# ── product 2: already-completed + approved control (has inventory row) ─────
cur.execute(
    """INSERT INTO products (name, description, category, price, mrp, stock, images,
                             status, lifecycle_state, approval_status, approval_source,
                             approval_warehouse_id, global_sku_code)
       VALUES ('Pipe Live Product', 'live desc', 'cases', 299.0, 499.0, 10, '[]',
               'available', 'live', 'approved', 'warehouse', 1, 'AP-111111')"""
)
live_pid = cur.lastrowid
cur.execute(
    """INSERT INTO warehouse_inventory (warehouse_id, product_id, product_name, sku,
               stock_quantity, available_stock, low_stock_threshold, selling_price,
               mrp, gst_pct, status)
       VALUES (1, ?, 'Pipe Live Product', 'AP-111111', 10, 10, 2, 299.0, 499.0, 0, 'active')""",
    (live_pid,),
)

conn.commit()
conn.close()

# ── start the backend on the isolated DB ─────────────────────────────────────
env = dict(os.environ)
env.update({
    "PORT": str(PORT),
    "FORCE_HTTPS": "0",
    "FORCE_LOCAL_DB": "1",
    "DATABASE_PATH": DB,
})
proc = subprocess.Popen(
    [sys.executable, "app.py"],
    cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    env=env,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)

def api(method, path, token=None, body=None):
    req = urllib.request.Request(f"{BASE}{path}", method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=15) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

# wait for boot
for _ in range(60):
    try:
        api("GET", "/api/categories")
        break
    except Exception:
        time.sleep(0.5)
else:
    print("FAIL — backend did not boot")
    proc.kill()
    sys.exit(1)

# ── tokens (minted like the panel does; secret from backend/.env) ──────────
import base64
import hashlib
import hmac as _hmac

# Same resolution the server does (jwt_config.get_jwt_secret): env var
# first, then the persisted .jwt_secret file. app.py loads backend/.env via
# dotenv before any request, so mirror that order here.
from dotenv import load_dotenv as _ld
_ld(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
from jwt_config import get_jwt_secret as _gjs
_secret = _gjs()

def _mint(payload):
    b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64(json.dumps(payload).encode())
    sig = b64(_hmac.new(_secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest())
    return f"{head}.{body}.{sig}"

now = int(time.time())
WH_TOKEN = _mint({"warehouse_id": 1, "email": "pwh@example.com", "role": "owner", "type": "warehouse", "iat": now, "exp": now + 86400})
ADMIN_TOKEN = _mint({"user_id": 1, "email": "admin@example.com", "role": "admin", "iat": now, "exp": now + 86400})


# ── checks ───────────────────────────────────────────────────────────────────
passed, failed = 0, 0
def check(name, ok, extra_info=""):
    global passed, failed
    if ok: passed += 1
    else: failed += 1
    print(f"{'PASS' if ok else 'FAIL'} — {name}" + (f"  ({extra_info})" if extra_info else ""))

def db_one(sql, args=()):
    c = database.get_db()
    try:
        row = c.execute(sql, args).fetchone()
        return dict(row) if row else None
    finally:
        c.close()

# 1. Inventory list exposes storefront_status for prefill
st, inv = api("GET", "/api/warehouse/inventory", WH_TOKEN)
inv_list = inv if isinstance(inv, list) else (inv.get("data") or [])
live_row = next((r for r in inv_list if isinstance(r, dict) and r.get("product_id") == live_pid), None)
check("inventory list returns storefront_status", bool(live_row) and live_row.get("storefront_status") == "available",
      f"storefront_status={live_row and live_row.get('storefront_status')!r}")
if not live_row:
    print(f"DEBUG http={st} resp_type={type(inv).__name__} head={str(inv)[:400]}")

# 2. Plain edit (no toggle touch) must preserve products.status
#    Simulates the panel payload with is_active correctly prefilled True.
st2, _ = api("PATCH", f"/api/warehouse/inventory/{live_row['id']}", WH_TOKEN,
             {"price": 309.0, "selling_price": 309.0, "status": "available"})
p2 = db_one("SELECT status, price FROM products WHERE id = ?", (live_pid,))
check("plain edit preserves products.status='available'", st2 == 200 and p2["status"] == "available",
      f"http={st2} status={p2['status']}")

# 3. Toggle OFF → 'unavailable'; storefront hides it
st3, _ = api("PATCH", f"/api/warehouse/inventory/{live_row['id']}", WH_TOKEN, {"status": "unavailable"})
p3 = db_one("SELECT status FROM products WHERE id = ?", (live_pid,))
st3b, store3 = api("GET", "/api/products?_cb=3b")  # unique query key: /api/products is cached 60s
store_data3 = (store3.get("data") or []) if isinstance(store3, dict) else store3
ids3 = [x["id"] for x in store_data3]
check("toggle OFF → products.status='unavailable'", st3 == 200 and p3["status"] == "unavailable", f"http={st3} status={p3['status']}")
check("storefront list hides unavailable product", live_pid not in ids3, f"visible={live_pid in ids3}")

# 4. Toggle back ON → 'available'; storefront shows it again
st4, _ = api("PATCH", f"/api/warehouse/inventory/{live_row['id']}", WH_TOKEN, {"status": "available"})
p4 = db_one("SELECT status FROM products WHERE id = ?", (live_pid,))
st4b, store4 = api("GET", "/api/products?_cb=4b")
store_data4 = (store4.get("data") or []) if isinstance(store4, dict) else store4
ids4 = [x["id"] for x in store_data4]
check("toggle ON → products.status='available'", st4 == 200 and p4["status"] == "available", f"http={st4} status={p4['status']}")
check("storefront list shows product again", live_pid in ids4, f"visible={live_pid in ids4}")

# 5. Agent draft → warehouse complete
st5, comp = api("POST", f"/api/warehouse/add-agent-drafts/{draft_pid}/complete", WH_TOKEN, {
    "price": 259.0, "selling_price": 259.0, "mrp": 449.0, "stock_quantity": 7, "sku": "AP-840306",
    "gst_pct": 0, "is_active": True, "discount_pct": 42.32, "discount_amt": 190.0,
})
inv2 = db_one("SELECT * FROM warehouse_inventory WHERE product_id = ?", (draft_pid,))
p5 = db_one("SELECT status, approval_status, price, mrp, stock FROM products WHERE id = ?", (draft_pid,))
check("agent draft completes → inventory row created", st5 in (200, 201) and bool(inv2), f"http={st5} row={'yes' if inv2 else 'no'}")
check("completed draft: products.status='available' + approval 'pending'",
      p5 and p5["status"] == "available" and p5["approval_status"] == "pending",
      f"status={p5 and p5['status']} approval={p5 and p5['approval_status']}")
check("completed draft pricing sane (discount <= mrp_eff)", p5 and p5["mrp"] == 449.0 and p5["price"] == 259.0,
      f"price={p5 and p5['price']} mrp={p5 and p5['mrp']}")

# 6. Admin approve
st6, appr = api("POST", f"/api/admin/products/{draft_pid}/approve", ADMIN_TOKEN, {})
p6 = db_one("SELECT status, approval_status FROM products WHERE id = ?", (draft_pid,))
check("admin approve → approval_status='approved'", st6 == 200 and p6["approval_status"] == "approved",
      f"http={st6} approval={p6['approval_status']}")
check("approve does NOT touch products.status", p6["status"] == "available", f"status={p6['status']}")

# 7. Storefront list + detail show the approved product
st7, store7 = api("GET", "/api/products?_cb=7")
plist = (store7.get("data") or []) if isinstance(store7, dict) else store7
ids7 = [x["id"] for x in plist]
check("storefront list shows approved agent product", draft_pid in ids7, f"visible={draft_pid in ids7}")
st7d, detail = api("GET", f"/api/products/{draft_pid}")
d = detail.get("data") or detail
check("storefront detail reachable + status for deep-fetch prefill",
      st7d == 200 and d.get("status") == "available", f"http={st7d} status={d.get('status')!r}")

print()
print(f"{passed} passed, {failed} failed")
proc.send_signal(signal.SIGINT)
try:
    proc.wait(timeout=10)
except Exception:
    proc.kill()
sys.exit(1 if failed else 0)
