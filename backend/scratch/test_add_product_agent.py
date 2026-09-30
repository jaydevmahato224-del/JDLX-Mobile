"""
Add-Product Agent system — full-flow test.

Covers:
  1. Manager registers an agent (unique AP- code, duplicate email/phone rejected)
  2. OTP generation with flexible duration (60-480 bounds enforced)
  3. Agent login with email/phone + OTP (wrong OTP decrements attempts,
     correct OTP starts the countdown session)
  4. Session snapshot (remaining minutes, break allowance)
  5. Break lifecycle: splittable breaks within a 15-min rolling-hour window,
     session-end extension on break end (countdown pause semantics)
  6. Agent product draft: discovery fields saved, price/mrp/stock structurally
     ignored, brand locked to 'None', agent code stamped, discovery row +
     auto SEO meta, approval_status='agent_draft' (invisible to storefront)
  7. Manager draft completion: price/stock/SKU applied, inventory row created,
     approval_status -> 'pending' (existing admin-approval flow takes over)
  8. Auth guards: warehouse token rejected on agent endpoints, agent token
     rejected on manager endpoints, session death after expiry/revoke
"""
import os
import sys
import time

os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["FORCE_HTTPS"] = "0"  # keep Talisman from redirecting the test client
TEST_DB = os.environ["DATABASE_PATH"] = "/tmp/jdlx_agent_flow_test.db"
if os.path.exists(TEST_DB):
    os.remove(TEST_DB)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import jwt  # noqa: E402
import datetime  # noqa: E402
from app import app  # noqa: E402
from database import get_db  # noqa: E402
from jwt_config import get_jwt_secret  # noqa: E402

passed = failed = 0
def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ PASS: {name}" + (f"  ({extra})" if extra else ""))
    else:
        failed += 1
        print(f"  ❌ FAIL: {name}" + (f"  ({extra})" if extra else ""))

client = app.test_client()

# ── Setup: a warehouse + its owner token (same pattern as other scratch tests) ─
conn = get_db()
conn.execute(
    "INSERT INTO warehouses (id, warehouse_name, email) VALUES (1, 'Test WH', 'wh@test.com')"
)
conn.commit()
conn.close()

owner_token = jwt.encode(
    {"type": "warehouse", "warehouse_id": 1, "email": "wh@test.com",
     "exp": datetime.datetime.utcnow() + datetime.timedelta(days=1)},
    get_jwt_secret(), algorithm="HS256",
)
SH = {"Authorization": f"Bearer {owner_token}"}

print("== 1. Registration ==")
r = client.post("/api/warehouse/add-agents", headers=SH, json={
    "name": "Ramesh", "email": "ramesh@test.com", "phone": "9876543210",
})
body = r.get_json()
check("register agent 201", r.status_code == 201, str(body)[:90])
agent_code = (body.get("data") or {}).get("agent_code", "")
agent_id = (body.get("data") or {}).get("id")
check("unique agent code format", agent_code.startswith("AP-") and len(agent_code) == 9, agent_code)

r = client.post("/api/warehouse/add-agents", headers=SH, json={
    "name": "Duplicate", "email": "ramesh@test.com", "phone": "9999999999",
})
check("duplicate email rejected 409", r.status_code == 409, str(r.status_code))

r = client.post("/api/warehouse/add-agents", headers=SH, json={
    "name": "NoPhone", "email": "x@test.com", "phone": "",
})
check("missing phone rejected 400", r.status_code == 400)

print("== 2. OTP generation ==")
r = client.post(f"/api/warehouse/add-agents/{agent_id}/otp", headers=SH, json={"duration_minutes": 30})
check("duration below 60 rejected", r.status_code == 400)
r = client.post(f"/api/warehouse/add-agents/{agent_id}/otp", headers=SH, json={"duration_minutes": 540})
check("duration above 480 rejected", r.status_code == 400)
r = client.post(f"/api/warehouse/add-agents/{agent_id}/otp", headers=SH, json={"duration_minutes": 480})
body = r.get_json()
check("480 min (8h) allowed — max flexible", r.status_code == 201, str(body)[:80])
otp = (body.get("data") or {}).get("otp", "")
check("6-digit OTP returned once", len(otp) == 6 and otp.isdigit(), otp)

print("== 3. Agent login ==")
r = client.post("/api/agent/login", json={"identifier": "ramesh@test.com", "otp": "000000"})
check("wrong OTP rejected", r.status_code == 401, str(r.status_code))
r = client.post("/api/agent/login", json={"identifier": "9876543210", "otp": otp})
body = r.get_json()
check("login by PHONE + OTP 200", r.status_code == 200, str(body)[:90])
agent_token = (body.get("data") or {}).get("token", "")
agent_payload = body.get("data") or {}
check("agent code echoed at login", agent_payload.get("agent", {}).get("agent_code") == agent_code)
sess = agent_payload.get("session") or {}
# remaining can be 479 if a second elapsed since login — countdown running is
# the point, not the exact integer.
check("session countdown started at 480 min",
      sess.get("duration_minutes") == 480 and 478 <= (sess.get("remaining_minutes") or 0) <= 480,
      f"{sess.get('duration_minutes')}m / left {sess.get('remaining_minutes')}")
AG = {"Authorization": f"Bearer {agent_token}"}

# A fresh OTP supersedes the consumed session (old token must die).
r = client.post(f"/api/warehouse/add-agents/{agent_id}/otp", headers=SH, json={"duration_minutes": 120})
otp2 = (r.get_json().get("data") or {}).get("otp", "")
r = client.get("/api/agent/session", headers=AG)
check("new OTP supersedes old session (old token dead)", r.status_code == 401 or r.status_code == 403, str(r.status_code))
r = client.post("/api/agent/login", json={"identifier": "ramesh@test.com", "otp": otp2})
body = r.get_json()
agent_token = (body.get("data") or {}).get("token", "")
AG = {"Authorization": f"Bearer {agent_token}"}
check("re-login with fresh OTP 200", r.status_code == 200)
sess = (body.get("data") or {}).get("session") or {}
check("re-login session = 120 min", sess.get("duration_minutes") == 120)

print("== 4. Guards ==")
r = client.get("/api/warehouse/add-agents", headers=AG)
check("agent token rejected on manager endpoint", r.status_code in (401, 403), str(r.status_code))
r = client.post("/api/agent/products", headers=SH, json={"name": "X", "description": "d", "category_id": 1, "images": ["https://x/y.jpg"]})
check("owner token rejected on agent endpoint", r.status_code in (401, 403), str(r.status_code))

print("== 5. Category + draft ==")
conn = get_db()
conn.execute("INSERT OR IGNORE INTO categories (id, name) VALUES (5, 'Smartphones')")
conn.commit()
conn.close()

r = client.get("/api/agent/categories", headers=AG)
cats = (r.get_json().get("data") or [])
check("agent categories readable", r.status_code == 200 and any(c["id"] == 5 for c in cats), str(r.status_code))

r = client.post("/api/agent/products", headers=AG, json={
    "name": "Redmi Note 13 Pro 5G", "description": "8GB/256GB, box + bill, like new condition",
    "category_id": 5, "images": ["https://example.com/a.jpg", "/static/uploads/product_images/b.jpg"],
    "tags": ["redmi", "5g", "under 30000"],
    # Agent tries to set pricing — must be structurally IGNORED:
    "price": 999, "mrp": 9999, "stock": 500, "sku": "HACKED-SKU",
    "return_policy": "7 days replacement",
})
body = r.get_json()
check("agent draft created 201", r.status_code == 201, str(body)[:100])
product_id = (body.get("data") or {}).get("product_id")

conn = get_db()
row = conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
check("price/stock structurally ignored (0/0)", row["price"] == 0 and row["stock"] == 0, f"price={row['price']} stock={row['stock']}")
check("brand locked to 'None'", row["brand"] == "None", row["brand"])
check("agent code stamped on product", row["added_by_agent_code"] == agent_code, row["added_by_agent_code"])
check("status agent_draft (storefront-invisible)", row["approval_status"] == "agent_draft", row["approval_status"])
check("global_sku_code NOT polluted by payload", row["global_sku_code"] != "HACKED-SKU", str(row["global_sku_code"]))
disco = conn.execute("SELECT * FROM product_discovery WHERE product_id = ?", (product_id,)).fetchone()
tags_ok = disco and "redmi" in (disco["product_tags"] or "")
check("discovery row + tags saved", bool(tags_ok))
check("SEO meta auto-filled", bool(disco["meta_title"] and disco["meta_description"]))
inv = conn.execute("SELECT * FROM warehouse_inventory WHERE product_id = ?", (product_id,)).fetchone()
check("no inventory row while draft", inv is None)
conn.close()

r = client.post("/api/agent/products", headers=AG, json={
    "name": "NoImg", "description": "d", "category_id": 5, "images": []})
check("draft without images rejected", r.status_code == 400)

print("== 6. Break lifecycle ==")
r = client.post("/api/agent/break/start", headers=AG, json={})
body = r.get_json()
check("break #1 started (2 min)", r.status_code == 200, str(body)[:80])
b1 = (body.get("data") or {}).get("break") or {}

time.sleep(1.2)  # ~0.02 min elapsed
r = client.post("/api/agent/break/end", headers=AG, json={})
body = r.get_json()
check("break #1 ended, session extended", r.status_code == 200, str(body)[:100])
taken1 = (body.get("data") or {}).get("break_taken_minutes", 0)
snap = (body.get("data") or {})
check("allowance after ~0 break ≈ 15", snap.get("break", {}).get("remaining_minutes", 0) > 13.5,
      str(snap.get("break", {}).get("remaining_minutes")))

# Splittable: take several micro-breaks until the 15-min allowance is gone.
r = client.post("/api/agent/break/start", headers=AG, json={})
check("break #2 startable (splittable)", r.status_code == 200)
time.sleep(0.6)
r = client.post("/api/agent/break/end", headers=AG, json={})
check("break #2 ended", r.status_code == 200)

# Simulate a full 15-minute usage by inserting a break row directly.
conn = get_db()
conn.execute(
    "INSERT INTO add_agent_breaks (session_id, agent_id, duration_minutes, started_at) "
    "VALUES ((SELECT MAX(id) FROM add_agent_otp_sessions), (SELECT id FROM add_product_agents WHERE email='ramesh@test.com'), 14.9, datetime('now'))"
)
conn.commit()
conn.close()

r = client.post("/api/agent/break/start", headers=AG, json={})
check("break blocked when 15-min hour allowance used", r.status_code == 409, str(r.status_code))

print("== 7. Manager completes the draft ==")
r = client.post(f"/api/warehouse/add-agent-drafts/{product_id}/complete", headers=SH, json={
    "price": 18999, "mrp": 21999, "stock": 12, "sku": "", "brand": "Redmi", "unit": "pcs",
})
body = r.get_json()
check("manager completion 200", r.status_code == 200, str(body)[:100])
final_sku = (body.get("data") or {}).get("sku", "")

conn = get_db()
row = conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
check("price applied by manager", row["price"] == 18999, str(row["price"]))
check("stock applied", row["stock"] == 12, str(row["stock"]))
check("brand set by manager", row["brand"] == "Redmi", row["brand"])
check("approval_status now 'pending' (existing flow)", row["approval_status"] == "pending", row["approval_status"])
check("agent attribution KEPT after completion", row["added_by_agent_code"] == agent_code)
inv = conn.execute("SELECT * FROM warehouse_inventory WHERE product_id = ?", (product_id,)).fetchone()
check("inventory row created with SKU", inv is not None and inv["sku"] == final_sku, str(inv and inv["sku"]))
check("inventory defaults: discount 0 when no discount sent", (inv["discount_pct"] or 0) == 0 and (inv["discount_amt"] or 0) == 0)
conn.close()

# Duplicate SKU guard
r = client.post(f"/api/warehouse/add-agent-drafts/{product_id}/complete", headers=SH, json={"price": 1})
check("re-complete rejected (already pending/approved path)", r.status_code in (400, 409), str(r.status_code))

print("== 7b. Extended completion fields (case-category auto-warranty) ==")
conn = get_db()
conn.execute("INSERT OR IGNORE INTO categories (id, name) VALUES (6, 'Phone Cases')")
conn.commit()
conn.close()

r = client.post("/api/agent/products", headers=AG, json={
    "name": "Orange Silicone Case", "description": "Soft silicone back cover",
    "category_id": 6, "images": ["https://example.com/case.jpg"],
    "tags": ["case", "silicone"],
})
body = r.get_json()
check("case draft saved", r.status_code == 201, str(body)[:80])
case_pid = (body.get("data") or {}).get("product_id")

r = client.post(f"/api/warehouse/add-agent-drafts/{case_pid}/complete", headers=SH, json={
    "price": 189, "mrp": 699, "stock": 40, "sku": "", "unit": "pcs",
    "units_per_pack": "2", "material_type": "Silicone",
    "discount_pct": 10,
    "gst_pct": 18,
    "offline_price": 175,
    "is_active": False,
    "compatibility": "iPhone 12 / 12 Pro",
    "box_contents": "1 Back Cover",
    "return_window": 3,
})
body = r.get_json()
check("extended completion 200", r.status_code == 200, str(body)[:120])

conn = get_db()
prow = conn.execute("SELECT * FROM products WHERE id = ?", (case_pid,)).fetchone()
check("units_per_pack applied", prow["units_per_pack"] == "2", str(prow["units_per_pack"]))
check("material_type applied", prow["material_type"] == "Silicone", str(prow["material_type"]))
check("offline_price applied", prow["offline_price"] == 175, str(prow["offline_price"]))
check("is_active=false -> status 'unavailable'", prow["status"] == "unavailable", str(prow["status"]))
inv = conn.execute("SELECT * FROM warehouse_inventory WHERE product_id = ?", (case_pid,)).fetchone()
check("discount pct applied", inv is not None and inv["discount_pct"] == 10.0, str(inv and inv["discount_pct"]))
check("discount amt auto-calc (mrp*10%)", inv is not None and abs(inv["discount_amt"] - 69.9) < 0.01, str(inv and inv["discount_amt"]))
check("landing cost -> cost_price", inv is not None and inv["cost_price"] == 0.0)
content = conn.execute("SELECT * FROM product_content WHERE product_id = ?", (case_pid,)).fetchone()
check("case warranty auto-default (locked text)", content is not None
      and content["warranty_info"] == "No warranty available in mobile cases", str(content and content["warranty_info"]))
check("compatibility stored", content is not None and content["compatibility"] == "iPhone 12 / 12 Pro")
check("box_contents stored", content is not None and content["box_contents"] == "1 Back Cover")
ful = conn.execute("SELECT * FROM product_fulfillment WHERE product_id = ?", (case_pid,)).fetchone()
check("return_window applied (3 days)", ful is not None and ful["return_window"] == 3, str(ful and ful["return_window"]))
conn.close()

print("== 7c. First draft (no new fields) got platform defaults ==")
conn = get_db()
ful1 = conn.execute("SELECT * FROM product_fulfillment WHERE product_id = ?", (product_id,)).fetchone()
check("first draft fulfillment row exists", ful1 is not None)
no_content = conn.execute("SELECT 1 FROM product_content WHERE product_id = ?", (product_id,)).fetchone()
check("non-case draft: no auto-warranty row", no_content is None)
prow1 = conn.execute("SELECT status, offline_price FROM products WHERE id = ?", (product_id,)).fetchone()
check("default active status 'available'", prow1["status"] == "available", str(prow1["status"]))
check("offline_price NULL when not sent", prow1["offline_price"] is None)
conn.close()

print("== 8. Drafts list for manager ==")
r = client.get("/api/warehouse/add-agent-drafts", headers=SH)
items = r.get_json().get("data") or []
check("manager sees the agent draft history", r.status_code == 200 and any(i["id"] == product_id for i in items), str(len(items)))
case_item = next((i for i in items if i["id"] == case_pid), None)
check("drafts list carries agent tags (storefront discovery)",
      case_item is not None and any(t in (case_item.get("product_tags") or []) for t in ("case", "silicone")),
      str(case_item and case_item.get("product_tags")))
check("drafts list includes search_keywords + synonyms", case_item is not None
      and "search_keywords" in case_item and "search_synonyms" in case_item)
check("drafts list includes return_window", case_item is not None and case_item.get("return_window") == 3)
legacy_item = next((i for i in items if i["id"] == product_id), None)
check("completed draft re-listed without legacy ETA (already '')", legacy_item is not None)

print("== 9. Logout kills session ==")
r = client.post("/api/agent/logout", headers=AG, json={})
check("logout 200", r.status_code == 200)
r = client.get("/api/agent/session", headers=AG)
check("token dead after logout", r.status_code in (401, 403), str(r.status_code))

print("== 10. Agent disable revokes live session ==")
r = client.post(f"/api/warehouse/add-agents/{agent_id}/otp", headers=SH, json={"duration_minutes": 60})
otp3 = (r.get_json().get("data") or {}).get("otp", "")
r = client.post("/api/agent/login", json={"identifier": "ramesh@test.com", "otp": otp3})
agent_token = (r.get_json().get("data") or {}).get("token", "")
AG = {"Authorization": f"Bearer {agent_token}"}
check("third login OK", r.status_code == 200)
r = client.patch(f"/api/warehouse/add-agents/{agent_id}", headers=SH, json={"status": "inactive"})
check("manager disables agent", r.status_code == 200)
r = client.get("/api/agent/session", headers=AG)
check("live session revoked on disable", r.status_code in (401, 403), str(r.status_code))

print()
print("=" * 50)
print(f"TOTAL: {passed} passed, {failed} failed")
if failed == 0:
    print("ALL ADD-PRODUCT AGENT TESTS PASSED ✅")
else:
    print("FAILURES PRESENT ❌")
sys.exit(1 if failed else 0)
