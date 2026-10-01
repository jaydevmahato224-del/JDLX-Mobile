"""Seed an isolated store-e2e DB — user id 1 + 4 live products.

Usage:
  python3 scratch/seed_store_e2e.py           -> /tmp/jdlx_verify.db (core flows)
  python3 scratch/seed_store_e2e.py --checkout -> /tmp/jdlx_gcheck.db (full checkout:
      adds ₹1,00,000 wallet balance, stock 50 per product, and a warehouse with
      inventory rows so order confirmation can decrement stock)

Read-only with respect to production: FORCE_LOCAL_DB=1 + DATABASE_PATH to a
/tmp file. No business logic touched — plain INSERTs using the existing schema
(via init_db). Also writes 3 tiny 1x1 PNGs into backend/static/uploads/ that
the seeded products reference (cleaned up by the caller after the test).
"""
import os
import struct
import sys
import zlib

CHECKOUT_MODE = "--checkout" in sys.argv
DB = "/tmp/jdlx_gcheck.db" if CHECKOUT_MODE else "/tmp/jdlx_verify.db"
STOCK = 50 if CHECKOUT_MODE else 10
if os.path.exists(DB):
    os.remove(DB)

os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["DATABASE_PATH"] = DB

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import database  # noqa: E402

database.init_db()
conn = database.get_db()
cur = conn.cursor()

# ── user id 1 (JWT in the e2e test is minted for user_id=1) ─────────────────
cur.execute(
    """INSERT INTO users (id, google_id, name, email, role, account_status)
       VALUES (1, 'e2e-store-test-google-id', 'Test User', 'test@example.com', 'user', 'active')"""
)

# ── categories ──────────────────────────────────────────────────────────────
cat_ids = []
for name in ("E2E Category A", "E2E Category B"):
    cur.execute("INSERT INTO categories (name) VALUES (?)", (name,))
    cat_ids.append(cur.lastrowid)

# ── tiny 1x1 PNGs the products reference ────────────────────────────────────
def png_bytes():
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00\xff\x00\x00")
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", idat) + chunk(b"IEND", b""))

uploads_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "uploads")
os.makedirs(uploads_dir, exist_ok=True)
png = png_bytes()
for i in (1, 2, 3):
    with open(os.path.join(uploads_dir, f"e2e_seed_{i}.png"), "wb") as f:
        f.write(png)

# ── 4 live products (home needs >3 product images to render) ────────────────
products = [
    ("E2E Product One", 199.0, STOCK, cat_ids[0], ["e2e_seed_1.png"]),
    ("E2E Product Two", 299.0, STOCK, cat_ids[0], ["e2e_seed_2.png"]),
    ("E2E Product Three", 399.0, STOCK, cat_ids[1], ["e2e_seed_3.png"]),
    ("E2E Product Four", 499.0, STOCK, cat_ids[1], ["e2e_seed_1.png", "e2e_seed_2.png"]),
]
import json
product_ids = []
for name, price, stock, cat, imgs in products:
    cur.execute(
        """INSERT INTO products (name, price, stock, category_id, description, images,
                                 status, lifecycle_state, approval_status, approval_source)
           VALUES (?, ?, ?, ?, 'E2E seeded product', ?, 'available', 'live', 'approved', 'admin')""",
        (name, price, stock, cat, json.dumps([f"/static/uploads/{p}" for p in imgs])),
    )
    product_ids.append(cur.lastrowid)

if CHECKOUT_MODE:
    # Wallet balance covers the whole order -> ₹0 pay-now path (no gateway).
    cur.execute("INSERT INTO wallet (user_id, balance) VALUES (1, 100000.0)")
    # Warehouse + inventory so order confirmation can assign & decrement stock.
    cur.execute(
        """INSERT INTO warehouses (warehouse_name, email, owner_name, account_status)
           VALUES ('E2E Warehouse', 'e2e-wh@example.com', 'E2E Owner', 'active')"""
    )
    wh_id = cur.lastrowid
    for pid in product_ids:
        cur.execute(
            """INSERT INTO warehouse_inventory (warehouse_id, product_id, product_name,
                   stock_quantity, reserved_stock, status)
               VALUES (?, ?, 'E2E seeded inventory', ?, 0, 'active')""",
            (wh_id, pid, STOCK),
        )

conn.commit()
conn.close()

print(f"Seeded {DB}:")
print("  users=1 (id=1 test@example.com), categories=2, products=4 (all live/approved)")
if CHECKOUT_MODE:
    print("  wallet=100000, warehouse=1, inventory rows=4 (stock 50 each)")
print("  images: static/uploads/e2e_seed_{1,2,3}.png")
