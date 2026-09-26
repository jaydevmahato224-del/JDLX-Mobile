"""
Reproduce the warehouse inventory EDIT->SAVE crash against REAL local data:
- a normal (non-variant) product like the live inventory rows
- the variant product (product 133, has_variants=1) — the panel loads its
  variants in edit mode and PATCHes them back
Both flows use the EXACT payload shape WarehouseInventory.jsx builds.
"""
import os
import sys
import json

os.environ.setdefault("FORCE_LOCAL_DB", "1")
os.environ.setdefault("DATABASE_PATH", "jdlx.db")
os.environ.setdefault("FORCE_HTTPS", "0")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from app import app
from warehouse_routes import issue_warehouse_token
from database import get_db


def build_panel_payload(item, product_detail, variant_lines):
    """Mimic handleEditItem + handleSubmit coercion exactly."""
    images = []
    raw_images = product_detail.get("images")
    if raw_images:
        if isinstance(raw_images, str):
            try:
                parsed = json.loads(raw_images)
                images = parsed if isinstance(parsed, list) else [raw_images]
            except Exception:
                images = [raw_images]
        elif isinstance(raw_images, list):
            images = raw_images

    variants = []
    for v in product_detail.get("variants") or []:
        line = next((l for l in variant_lines if str(l["variant_id"]) == str(v["id"])), None)
        variants.append({
            "id": v["id"],
            "name": v.get("name") or "",
            "sku": v.get("sku") or "",
            "price": (line["selling_price"] if line and line["selling_price"] is not None else (v.get("price") if v.get("price") is not None else "")),
            "mrp": (line["mrp"] if line and line["mrp"] is not None else (v.get("mrp") if v.get("mrp") is not None else "")),
            "stock_quantity": line["stock_quantity"] if line else (v.get("stock") or 0),
            "options": v.get("options") or {},
        })

    return {
        "product_id": item["product_id"],
        "name": item["product_name"],
        "sku": item["sku"],
        "stock_quantity": item["stock_quantity"],
        "low_stock_threshold": item["low_stock_threshold"] or 2,
        "bin_location": item["bin_location"] or "",
        "unit": item["unit"] or "pcs",
        "cost_price": item["cost_price"] or 0,
        "price": item["selling_price"] or 0,
        "selling_price": item["selling_price"] or 0,
        "offline_price": None,
        "mrp": item["mrp"] or 0,
        "discount_pct": item["discount_pct"] or 0,
        "discount_amt": item["discount_amt"] or 0,
        "gst_pct": item["gst_pct"],
        "apply_gst": item["gst_pct"] is not None,
        "brand": item["brand"] or "",
        "category_id": None,
        "sub_category": "",
        "description": product_detail.get("description") or "",
        "units_per_pack": "",
        "material_type": "",
        "color": "",
        "weight": "",
        "dimensions": "",
        "is_fragile": 0,
        "is_temp_sensitive": 0,
        "is_perishable": 0,
        "expiry_date": "",
        "is_featured": 0,
        "has_variants": bool(product_detail.get("has_variants")),
        "variant_options": [
            {"option_name": o.get("option_name", ""), "option_values": o.get("option_values") or []}
            for o in (product_detail.get("variant_options") or [])
        ],
        "variants": variants,
        "recommendation_priority": 0,
        "recommendation_weight": 1.0,
        "recommendations": {"related": [], "upsell": [], "cross_sell": [], "frequent": []},
        "content": {
            "overview": "", "highlights": [], "specifications": {},
            "compatibility": "", "box_contents": "", "warranty_info": "",
            "usage_instructions": "",
        },
        "badges": [],
        "lifecycle_state": "live",
        "discovery": {
            "meta_title": "", "meta_description": "",
            "search_keywords": [], "product_tags": [], "search_synonyms": [],
        },
        "fulfillment": {
            "package_weight": 0.5, "length": 0, "width": 0, "height": 0,
            "shipping_tier": "standard", "dispatch_sla": 24,
            "is_cod_eligible": True, "is_fragile": False,
            "is_express_eligible": True, "return_window": 7,
        },
        "images": images,
    }


def run_case(client, H, label, item_id, payload):
    resp = client.patch(f"/api/warehouse/inventory/{item_id}", headers=H, json=payload)
    body = resp.get_json(silent=True) or {}
    status = "OK " if resp.status_code < 400 else "FAIL"
    print(f"[{status}] {label}: PATCH /{item_id} -> {resp.status_code} {json.dumps(body)[:220]}")
    return resp.status_code


def main():
    conn = get_db()
    wh = conn.execute("SELECT id FROM warehouses ORDER BY id LIMIT 1").fetchone()
    items = conn.execute(
        """SELECT wi.*, p.has_variants, p.name AS p_name
           FROM warehouse_inventory wi JOIN products p ON wi.product_id = p.id
           WHERE wi.warehouse_id = ? ORDER BY wi.id DESC""",
        (wh["id"],),
    ).fetchall()
    conn.close()

    token = issue_warehouse_token(wh["id"], "owner@jdlx.test", "owner")
    client = app.test_client()
    H = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Simulate fetchInventory() list state for variant price/stock mapping
    conn = get_db()
    inv_list = conn.execute(
        "SELECT id, variant_id, selling_price, mrp, stock_quantity FROM warehouse_inventory WHERE warehouse_id = ?",
        (wh["id"],),
    ).fetchall()
    conn.close()

    for item in items:
        # panel fetches /products/<id> for extended data
        resp = client.get(f"/api/products/{item['product_id']}", headers=H)
        detail = (resp.get_json(silent=True) or {}).get("data") or {}
        payload = build_panel_payload(item, detail, inv_list)
        # handleSubmit coerces numerics:
        payload["stock_quantity"] = int(payload["stock_quantity"] or 0)
        payload["price"] = float(payload["price"] or 0)
        payload["selling_price"] = float(payload["selling_price"] or 0)
        payload["mrp"] = float(payload["mrp"] or 0)
        label = f"{item['product_name'][:35]!r} (variants={bool(payload['variants'])})"
        run_case(client, H, label, item["id"], payload)


if __name__ == "__main__":
    main()
