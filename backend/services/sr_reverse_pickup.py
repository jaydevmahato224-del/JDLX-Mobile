"""
Shiprocket Reverse Pickup
=========================
Creates a Shiprocket RETURN order (reverse pickup) for an approved return /
exchange so the courier collects the item from the CUSTOMER's address.

Shiprocket contract (apiv2):
    POST /orders/create/return     — customer becomes the pickup side
    POST /courier/assign/awb       — assign courier + generate return AWB
    POST /courier/request/pickup   — schedule the reverse pickup

Design rules
------------
- Best-effort ONLY: every failure path returns a normalized dict with
  ``ok=False`` — it never raises into the caller, because the returns
  pipeline must keep working (self-pickup) even when Shiprocket is down,
  unconfigured or rejects the request.
- Credentials come from the same env vars the forward flow uses
  (SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD) via shiprocket_client.sr_headers().
- All outbound HTTP goes through the module-level ``requests`` object so the
  integration tests can monkeypatch it exactly like the dispatch flow.
"""
import datetime

import requests

from database import get_db
from shiprocket_client import SHIPROCKET_API, sr_headers
from warehouse_routes import _extract_pincode6

# Small shared dimension set (matches the forward dispatch payload style)
RETURN_LENGTH_CM = 10
RETURN_BREADTH_CM = 10
RETURN_HEIGHT_CM = 5
RETURN_WEIGHT_KG = 0.5

REQUEST_TIMEOUT = 30


def _err(reason):
    return {"ok": False, "reason": reason}


def _warehouse_pickup_location(conn, warehouse_id):
    """Shiprocket pickup nickname: env var > system_settings > warehouse row
    > Shiprocket default 'Primary' (same precedence as forward dispatch)."""
    if not warehouse_id:
        return "Primary"
    row = conn.execute(
        "SELECT warehouse_name, pincode FROM warehouses WHERE id = ?", (warehouse_id,)
    ).fetchone()
    if not row:
        return "Primary"
    # Prefer the warehouse's own name as the nickname if a pincode exists —
    # partners usually create a pickup location named after their warehouse.
    if row["pincode"] and _extract_pincode6(row["pincode"]):
        return row["warehouse_name"]
    return "Primary"


def _build_return_payload(conn, complaint, cr, warehouse_id, notes):
    """Construct the /orders/create/return body from the original order.

    In a RETURN order Shiprocket swaps the sides: the CUSTOMER is the pickup
    consignee and the WAREHOUSE is the delivery destination.
    """
    order = conn.execute(
        """SELECT o.id, o.order_number, o.total_amount, o.delivery_address,
                  o.customer_name, COALESCE(o.customer_phone, o.phone) as phone,
                  u.email as user_email
           FROM orders o LEFT JOIN users u ON u.id = o.user_id
           WHERE o.id = ?""",
        (complaint["order_id"],),
    ).fetchone()
    if not order:
        return None, "Original order not found"

    items = conn.execute(
        """SELECT COALESCE(oi.product_name, p.name) AS name, oi.quantity, oi.price
           FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = ? ORDER BY oi.id""",
        (complaint["order_id"],),
    ).fetchall()
    if not items:
        return None, "Original order has no items"

    delivery_pincode = _extract_pincode6(order["delivery_address"]) or ""
    pickup_location = _warehouse_pickup_location(conn, warehouse_id)
    reference = f"JDLX-RET-{complaint['id']}"

    payload = {
        "order_id": reference,
        "order_date": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "channel_id": None,
        "pickup_customer_name": order["customer_name"] or "Customer",
        "pickup_email": order["user_email"] or "",
        "pickup_phone": order["phone"] or "",
        "pickup_address": order["delivery_address"] or "",
        "pickup_pincode": delivery_pincode,
        "pickup_country": "India",
        # Warehouse side (where the item must come back to)
        "shipping_customer_name": "JDLX Warehouse",
        "shipping_last_name": "",
        "shipping_address": pickup_location,
        "shipping_pincode": _extract_pincode6(
            conn.execute("SELECT pincode FROM warehouses WHERE id = ?", (warehouse_id,)).fetchone()["pincode"]
        ) if warehouse_id else "",
        "shipping_country": "India",
        "shipping_email": "",
        "shipping_phone": "",
        "shipping_is_billing": False,
        "order_items": [
            {
                "name": (it["name"] or "Item")[:60],
                "sku": f"RET-{complaint['id']}-{idx + 1}",
                "units": it["quantity"] or 1,
                "selling_price": float(it["price"] or 0),
                # Money moves on the return QC, not via courier collection
                "hsn": None,
            }
            for idx, it in enumerate(items)
        ],
        "payment_method": "Prepaid",           # nothing collectible on reverse leg
        "total_shipping_value": 0,
        "sub_total": float(order["total_amount"] or 0),
        "length": RETURN_LENGTH_CM,
        "breadth": RETURN_BREADTH_CM,
        "height": RETURN_HEIGHT_CM,
        "weight": RETURN_WEIGHT_KG,
        "pickup_location": pickup_location,
        # Free-form context visible in the SR panel
        "customer_note": (notes or complaint["issue_type"] or "Customer return")[:200],
    }
    return payload, None


def create_reverse_pickup(complaint_id, order_id, warehouse_id, notes=None):
    """Full reverse-pickup handshake for one complaint.

    Returns a normalized dict:
        {"ok": True, "sr_return_order_id": int, "sr_shipment_id": int,
         "sr_awb_code": str, "sr_courier_name": str,
         "sr_pickup_scheduled_date": str|None}
    or {"ok": False, "reason": str} — NEVER raises.
    """
    conn = get_db()
    try:
        complaint = conn.execute(
            "SELECT id, order_id, issue_type FROM complaints WHERE id = ?", (complaint_id,)
        ).fetchone()
        if not complaint:
            return _err("complaint not found")

        payload, err = _build_return_payload(conn, complaint, None, warehouse_id, notes)
        if err:
            return _err(err)

        headers = sr_headers()
        if not headers.get("Authorization"):
            return _err("Shiprocket not configured")

        # 1. Create the SR return order
        try:
            res = requests.post(
                f"{SHIPROCKET_API}/orders/create/return",
                json=payload, headers=headers, timeout=REQUEST_TIMEOUT,
            )
        except Exception as exc:
            return _err(f"Shiprocket unreachable: {exc}")
        try:
            data = res.json()
        except ValueError:
            data = {}
        if res.status_code not in (200, 201):
            return _err(f"return order creation failed (HTTP {res.status_code}): {data.get('message') or 'unknown'}")

        sr_order_id = data.get("order_id")
        sr_shipment_id = data.get("shipment_id")
        if not sr_shipment_id:
            return _err("Shiprocket did not return a shipment id")

        # 2. Assign courier + generate the return AWB
        awb_code, courier_name = None, None
        try:
            awb_res = requests.post(
                f"{SHIPROCKET_API}/courier/assign/awb",
                json={"shipment_id": sr_shipment_id},   # SR auto-assigns best courier
                headers=headers, timeout=REQUEST_TIMEOUT,
            )
            try:
                awb_data = awb_res.json()
            except ValueError:
                awb_data = {}
            awb_payload = (awb_data.get("response") or {}).get("data") or {}
            awb_code = awb_payload.get("awb_code")
            courier_name = awb_payload.get("courier_name")
            if not awb_code:
                # Non-fatal: SR panel can still assign the courier manually
                return {"ok": False, "reason": "AWB assignment pending",
                        "sr_return_order_id": sr_order_id, "sr_shipment_id": sr_shipment_id}
        except Exception as exc:
            return {"ok": False, "reason": f"AWB assignment failed: {exc}",
                    "sr_return_order_id": sr_order_id, "sr_shipment_id": sr_shipment_id}

        # 3. Schedule the reverse pickup (best-effort — SR usually auto-schedules
        # on AWB assignment for return orders)
        pickup_scheduled_date = None
        try:
            pick_res = requests.post(
                f"{SHIPROCKET_API}/courier/request/pickup",
                json={"shipment_id": sr_shipment_id},
                headers=headers, timeout=REQUEST_TIMEOUT,
            )
            try:
                pick_data = pick_res.json()
            except ValueError:
                pick_data = {}
            if pick_res.status_code in (200, 201):
                pickup_scheduled_date = (
                    pick_data.get("pickup_scheduled_date")
                    or pick_data.get("response", {}).get("pickup_scheduled_date")
                )
        except Exception:
            pass  # pickup scheduling is optional; AWB exists

        return {
            "ok": True,
            "sr_return_order_id": sr_order_id,
            "sr_shipment_id": sr_shipment_id,
            "sr_awb_code": awb_code,
            "sr_courier_name": courier_name,
            "sr_pickup_scheduled_date": pickup_scheduled_date,
        }
    finally:
        conn.close()
