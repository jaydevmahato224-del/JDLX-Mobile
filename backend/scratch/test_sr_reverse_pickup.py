"""
Shiprocket reverse-pickup integration tests
===========================================
Exercises the warehouse returns pickup trigger against a MOCKED Shiprocket
API (no network):

  1. SR configured + accepts  -> internal pickup scheduled AND SR return
     order / AWB / courier persisted on complaint_returns; response exposes
     the AWB; customer notification mentions the courier.
  2. SR rejects the return order -> pipeline still schedules self-pickup,
     complaint stays 'Pickup Scheduled', failure reason persisted.
  3. SR not configured        -> self-pickup mode, sr_request_status notes it.
  4. SR AWB rejection         -> returns order created but marked pending AWB
     (non-fatal, recorded on the row).
  5. Payload correctness      -> customer side = pickup (name/phone/address/
     pincode from the delivery address), warehouse side = shipping.
  6. Forward dispatch regression untouched (same mock harness pattern).
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_fd, _tmp_db = tempfile.mkstemp(suffix=".db")
os.close(_fd)
os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["DATABASE_PATH"] = _tmp_db

import database
from database import get_db, init_db
init_db()

from flask import Flask
from utils.response_utils import success_response, error_response

import warehouse_routes
import warehouse_returns
import shiprocket_client
import services.sr_reverse_pickup as srp

app = Flask(__name__)
app.register_blueprint(warehouse_routes.warehouse_bp)
app.register_blueprint(warehouse_returns.warehouse_returns_bp)
client = app.test_client()

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  [{detail}]" if detail and not cond else ""))


# ---------------------------------------------------------------------------
# Auth patch
# ---------------------------------------------------------------------------
warehouse_routes.decode_warehouse_token = lambda token: {"type": "warehouse", "warehouse_id": 1}
warehouse_returns._get_current_warehouse_id = lambda: 1
WH_HEADERS = {"Authorization": "Bearer test-token"}


# ---------------------------------------------------------------------------
# Mocked SR API (reverse endpoints)
# ---------------------------------------------------------------------------
class FakeSR:
    def __init__(self, payload, status_code=201):
        self.status_code = status_code
        self._payload = payload
    def json(self):
        return self._payload


class MockState:
    def __init__(self):
        self.reset()
    def reset(self):
        self.calls = []
        self.next_order_id = 7000
        self.return_ok = True
        self.awb_ok = True
        self.configured = True
        self.pickup_ok = True
    def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append({"url": url, "json": json})
        if "/auth/login" in url:
            if not self.configured:
                return FakeSR({})
            return FakeSR({"token": "t"})
        if "/orders/create/return" in url:
            if not self.return_ok:
                return FakeSR({"message": "Return window expired on SR panel"}, 400)
            oid = self.next_order_id + 1
            self.next_order_id = oid
            return FakeSR({"order_id": oid, "shipment_id": 8000 + oid})
        if "/courier/assign/awb" in url:
            if not self.awb_ok:
                return FakeSR({"response": {"data": {}}}, 200)
            return FakeSR({"response": {"data": {
                "awb_code": "REVAWB001", "courier_name": "Xpressbees Surface",
            }}})
        if "/courier/request/pickup" in url:
            if not self.pickup_ok:
                return FakeSR({"message": "pickup slot full"}, 400)
            return FakeSR({"pickup_scheduled_date": "2026-09-28 10:00:00"}, 200)
        raise AssertionError(f"unexpected POST {url}")
    def get(self, url, params=None, headers=None, timeout=None):
        raise AssertionError(f"unexpected GET {url}")


MOCK = MockState()
import requests as _real
_real.post = MOCK.post
_real.get = MOCK.get
# sr_reverse_pickup imports requests + sr_headers INTO its own namespace —
# patch there so the helper's calls hit the mock, not the network.
srp.requests = MOCK
srp.sr_headers = lambda: ({"Authorization": "Bearer t", "Content-Type": "application/json"}
                          if MOCK.configured else {})


def capture_notifications():
    sent = []
    class _Svc:
        def send_order_notification(self, *a, **k):
            sent.append(("order",) + a); return True
        def notify_user_internal(self, user_id, title, message, *a, **k):
            sent.append(("user", user_id, message)); return True
    warehouse_returns.notification_service = _Svc()
    return sent

NOTIFICATIONS = capture_notifications()


# ---------------------------------------------------------------------------
# Seed: user, warehouse, product, DELIVERED order, complaint (return, approved)
# ---------------------------------------------------------------------------
conn = get_db()
conn.execute("INSERT INTO users (id, google_id, name, email, role) VALUES (1, 'g1', 'Test User', 't@t.com', 'user')")
conn.execute("INSERT INTO warehouses (id, warehouse_name, email, owner_name, pincode) VALUES (1, 'WH-1', 'wh1@t.com', 'O', '110001')")
conn.execute("INSERT INTO products (id, name, price, stock) VALUES (1, 'Phone Case', 199, 5)")
conn.execute(
    """INSERT INTO orders (id, user_id, total_amount, order_status, order_number, customer_name,
           customer_phone, delivery_address, created_at, status_delivered_at)
       VALUES (401, 1, 199, 'DELIVERED', 'ORD-R401', 'Test User', '9876543210',
               '12 Market Rd, Karol Bagh, New Delhi 110005', datetime('now',' -3 days'), datetime('now','-3 days'))"""
)
conn.execute("INSERT INTO order_items (order_id, product_id, quantity, price, product_name) VALUES (401, 1, 1, 199, 'Phone Case')")
conn.execute("INSERT INTO warehouse_order_assignments (order_id, warehouse_id, assignment_status) VALUES (401, 1, 'dispatched')")
conn.execute(
    """INSERT INTO complaints (id, user_id, order_id, issue_type, description, status,
           warehouse_id, requested_action, return_window_end)
       VALUES (501, 1, 401, 'Damaged product', 'Corner dented', 'Approved', 1, 'return', datetime('now','+4 days'))"""
)
conn.commit(); conn.close()


def db_row(sql, params=()):
    c = get_db()
    try:
        r = c.execute(sql, params).fetchone()
        return dict(r) if r else None
    finally:
        c.close()


def trigger_pickup(cid):
    return client.post(f"/api/warehouse/returns/{cid}/pickup", headers=WH_HEADERS, json={})


print("\n== 1. SR accepts: full reverse pickup handshake ==")
resp = trigger_pickup(501)
check("trigger 200", resp.status_code == 200, f"{resp.status_code} {resp.get_data(as_text=True)[:160]}")
data = resp.get_json()["data"] if resp.status_code == 200 else {}
check("pickup scheduled internally", data.get("pickup_status") == "scheduled", str(data))
check("customer code generated", data.get("pickup_code") and len(str(data.get("pickup_code"))) == 6, str(data))
check("SR result ok in response", (data.get("shiprocket") or {}).get("ok") is True, str(data.get("shiprocket")))
check("AWB exposed", data.get("shiprocket", {}).get("sr_awb_code") == "REVAWB001", str(data.get("shiprocket")))

cr = db_row("SELECT * FROM complaint_returns WHERE complaint_id = 501")
check("sr_return_order_id persisted", cr["sr_return_order_id"] == 7001, str(cr.get("sr_return_order_id")))
check("sr_shipment_id persisted", cr["sr_shipment_id"] == 15001, str(cr.get("sr_shipment_id")))
check("sr_awb_code persisted", cr["sr_awb_code"] == "REVAWB001", str(cr.get("sr_awb_code")))
check("sr_courier persisted", cr["sr_courier_name"] == "Xpressbees Surface", str(cr.get("sr_courier_name")))
check("sr_pickup_scheduled_date persisted", cr["sr_pickup_scheduled_date"] == "2026-09-28 10:00:00", str(cr.get("sr_pickup_scheduled_date")))
check("sr_request_status = created", cr["sr_request_status"] == "created", str(cr.get("sr_request_status")))
check("internal pickup_status scheduled", cr["pickup_status"] == "scheduled", str(cr.get("pickup_status")))

create_call = next((c for c in MOCK.calls if "/orders/create/return" in c["url"]), None)
check("SR return order created once", create_call is not None, str(len([c for c in MOCK.calls if 'create/return' in c['url']])))
p = (create_call or {}).get("json") or {}
check("reference JDLX-RET-<complaint>", p.get("order_id") == "JDLX-RET-501", str(p.get("order_id")))
check("customer side = pickup (name)", p.get("pickup_customer_name") == "Test User", str(p.get("pickup_customer_name")))
check("customer pickup pincode from delivery address", p.get("pickup_pincode") == "110005", str(p.get("pickup_pincode")))
check("customer pickup address = delivery address", p.get("pickup_address") == "12 Market Rd, Karol Bagh, New Delhi 110005", str(p.get("pickup_address")))
check("warehouse side = shipping (pincode 110001)", p.get("shipping_pincode") == "110001", str(p.get("shipping_pincode")))
check("reverse leg prepaid (nothing collectible)", p.get("payment_method") == "Prepaid", str(p.get("payment_method")))
check("items carried over with units", p.get("order_items") == [
    {"name": "Phone Case", "sku": "RET-501-1", "units": 1, "selling_price": 199.0, "hsn": None}], str(p.get("order_items")))
awb_call = next((c for c in MOCK.calls if "/courier/assign/awb" in c["url"]), None)
check("AWB assigned to SR shipment", (awb_call or {}).get("json", {}).get("shipment_id") == 15001, str(awb_call))
pick_call = next((c for c in MOCK.calls if "/courier/request/pickup" in c["url"]), None)
check("pickup requested for SR shipment", (pick_call or {}).get("json", {}).get("shipment_id") == 15001, str(pick_call))
user_notifs = [n for n in NOTIFICATIONS if n[0] == "user"]
check("customer notified with courier + code", any("Xpressbees" in (n[2] or "") and n[2] for n in user_notifs), str(user_notifs[:1]))

# Double-trigger still blocked
resp = trigger_pickup(501)
check("double trigger blocked", resp.status_code == 409, str(resp.status_code))

# ===========================================================================
print("\n== 2. SR rejects return order -> self-pickup fallback ==")
MOCK.reset()
MOCK.return_ok = False   # SR panel rejects the return order
conn = get_db()
conn.execute(
    """INSERT INTO complaints (id, user_id, order_id, issue_type, description, status,
           warehouse_id, requested_action, return_window_end)
       VALUES (502, 1, 401, 'Wrong product delivered', 'Got wrong color', 'Approved', 1, 'return', datetime('now','+4 days'))"""
)
conn.commit(); conn.close()
resp = trigger_pickup(502)
check("trigger still 200", resp.status_code == 200, f"{resp.status_code} {resp.get_data(as_text=True)[:140]}")
data = resp.get_json()["data"] if resp.status_code == 200 else {}
check("internal pickup still scheduled", data.get("pickup_status") == "scheduled", str(data))
check("SR marked not-ok in response", (data.get("shiprocket") or {}).get("ok") is False, str(data.get("shiprocket")))
cr = db_row("SELECT sr_request_status, pickup_status, pickup_code FROM complaint_returns WHERE complaint_id = 502")
check("failure reason persisted on row", (cr["sr_request_status"] or "").startswith("not_created"), str(cr))
check("pickup code still generated (self mode)", cr["pickup_code"] and len(str(cr["pickup_code"])) == 6, str(cr))
check("complaint in Pickup Scheduled state",
      db_row("SELECT status FROM complaints WHERE id = 502")["status"] == "Pickup Scheduled")

# ===========================================================================
print("\n== 3. SR not configured -> clean self-pickup ==")
MOCK.reset()
MOCK.configured = False
conn = get_db()
conn.execute(
    """INSERT INTO complaints (id, user_id, order_id, issue_type, description, status,
           warehouse_id, requested_action, return_window_end)
       VALUES (503, 1, 401, 'Product not working', 'Dead on arrival', 'Approved', 1, 'return', datetime('now','+4 days'))"""
)
conn.commit(); conn.close()
resp = trigger_pickup(503)
check("trigger 200 without SR", resp.status_code == 200, str(resp.status_code))
cr = db_row("SELECT sr_request_status FROM complaint_returns WHERE complaint_id = 503")
check("not_created noted", (cr["sr_request_status"] or "").startswith("not_created"), str(cr))

# ===========================================================================
print("\n== 4. SR AWB rejection -> return created, AWB pending (non-fatal) ==")
MOCK.reset()
MOCK.awb_ok = False
conn = get_db()
conn.execute(
    """INSERT INTO complaints (id, user_id, order_id, issue_type, description, status,
           warehouse_id, requested_action, return_window_end)
       VALUES (504, 1, 401, 'Other', 'Changed mind on finish', 'Approved', 1, 'return', datetime('now','+4 days'))"""
)
conn.commit(); conn.close()
resp = trigger_pickup(504)
check("trigger 200 on AWB rejection", resp.status_code == 200, str(resp.status_code))
cr = db_row("SELECT sr_request_status, sr_awb_code, pickup_status, pickup_code FROM complaint_returns WHERE complaint_id = 504")
check("pickup still scheduled internally (self mode)", cr["pickup_status"] == "scheduled" and bool(cr["pickup_code"]), str(cr))
check("no AWB stored", cr["sr_awb_code"] is None, str(cr.get("sr_awb_code")))
check("status noted as AWB pending", "AWB" in (cr["sr_request_status"] or ""), str(cr.get("sr_request_status")))

print(f"\n{'='*60}\nRESULTS: {len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    print("FAILED:", FAIL)
    sys.exit(1)
print("ALL REVERSE-PICKUP CHECKS PASSED")
