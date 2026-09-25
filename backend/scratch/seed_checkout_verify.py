#!/usr/bin/env python3
"""Seed the ISOLATED local test DB used by the checkout browser verification.

Test-only helper — never touches product code or the real Turso DB.
Idempotent: safe to run multiple times.
"""
import sqlite3
from datetime import datetime

DB = "/tmp/jdlx_checkout_verify.db"

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

# ── User id=1 (matches the JWT minted in the browser test) ──────────────
cur.execute("""
    INSERT INTO users (id, google_id, name, email, role, account_status, email_verified, created_at)
    VALUES (1, 'seed-google-1', 'Test User', 'test@example.com', 'user', 'active', 1, ?)
    ON CONFLICT(id) DO UPDATE SET name='Test User', email='test@example.com'
""", (now,))

# ── Warehouse (needed for store selection + auto-COD-protection queries) ─
cur.execute("""
    INSERT INTO warehouses (id, warehouse_name, email, operations_status, account_status, warehouse_role, created_at)
    VALUES (1, 'Test Warehouse', 'wh@test.com', 'open', 'active', 'owner', ?)
    ON CONFLICT(id) DO UPDATE SET operations_status='open', account_status='active', warehouse_role='owner'
""", (now,))

# ── Category + products: 101 in-stock ₹200/50, 102 OOS, 103 in-stock ₹100/3 ─
cur.execute("SELECT COUNT(*) FROM categories")
if cur.fetchone()[0] == 0:
    cur.execute("INSERT INTO categories (id, name, device_customization_enabled) VALUES (1, 'Accessories', 0)")
cur.execute("""
    INSERT INTO products (id, name, price, stock, category_id, category, status, images, description, created_at)
    VALUES (101, 'Test Tempered Glass A', 200.0, 50, 1, 'Accessories', 'active', '[]', 'Seed product', ?)
    ON CONFLICT(id) DO UPDATE SET name='Test Tempered Glass A', price=200.0, stock=50, status='active', images='[]'
""", (now,))
cur.execute("""
    INSERT INTO products (id, name, price, stock, category_id, category, status, images, description, created_at)
    VALUES (102, 'Verify Product OOS', 150.0, 0, 1, 'Accessories', 'active', '[]', 'Seed product OOS', ?)
    ON CONFLICT(id) DO UPDATE SET name='Verify Product OOS', price=150.0, stock=0, status='active', images='[]'
""", (now,))
cur.execute("""
    INSERT INTO products (id, name, price, stock, category_id, category, status, images, description, created_at)
    VALUES (103, 'Verify Product Gamma', 100.0, 3, 1, 'Accessories', 'active', '[]', 'Seed product clamp', ?)
    ON CONFLICT(id) DO UPDATE SET name='Verify Product Gamma', price=100.0, stock=3, status='active', images='[]'
""", (now,))

cur.execute("INSERT OR IGNORE INTO warehouse_inventory (id, warehouse_id, product_id, product_name, stock_quantity, available_stock, status) VALUES (1, 1, 101, 'Test Tempered Glass A', 50, 50, 'active')")

# ── Wallet: ₹600 balance for user 1 ─────────────────────────────────────
cur.execute("SELECT COUNT(*) FROM wallet WHERE user_id=1")
if cur.fetchone()[0] == 0:
    cur.execute("INSERT INTO wallet (user_id, balance) VALUES (1, 600.0)")
else:
    cur.execute("UPDATE wallet SET balance = 600.0 WHERE user_id = 1")

# ── 10% coupon CODE10 (min order ₹100) — discount_type MUST be 'percentage' ─
cur.execute("SELECT COUNT(*) FROM offers WHERE coupon_code='CODE10'")
if cur.fetchone()[0] == 0:
    cur.execute("""
        INSERT INTO offers (title, description, offer_type, discount_type, discount_value,
                            min_order_amount, target_type, applicable_on, coupon_code,
                            start_date, end_date, is_active)
        VALUES ('Test 10% Off', 'Seed coupon', 'coupon', 'percentage', 10,
                100, 'all_users', 'all', 'CODE10', '2026-01-01 00:00:00', '2027-12-31 23:59:59', 1)
    """)
else:
    cur.execute("UPDATE offers SET discount_type='percentage', is_active=1 WHERE coupon_code='CODE10'")

# ── Unserviceable pincode rule so the hard-block path is testable ───────
cur.execute("INSERT OR REPLACE INTO pincode_rules (pincode, cod_allowed, prepaid_only, created_at) VALUES ('999999', 0, 0, ?)", (now,))

# ── Clean slate for order-flow assertions from previous runs ────────────
for t in ('orders', 'order_items', 'wallet_transactions', 'offer_usage', 'cart', 'rate_limits'):
    try:
        cur.execute(f"DELETE FROM {t}")
    except Exception:
        pass
cur.execute("UPDATE wallet SET balance = 600.0 WHERE user_id = 1")

conn.commit()
print("users:", cur.execute("SELECT id,email FROM users").fetchall() and "ok")
print("products:", [(r["id"], r["stock"]) for r in cur.execute("SELECT id, stock FROM products").fetchall()])
print("wallet:", dict(cur.execute("SELECT user_id, balance FROM wallet").fetchone()))
print("coupon rows:", cur.execute("SELECT COUNT(*) FROM offers WHERE coupon_code='CODE10'").fetchone()[0])
conn.close()
print("SEEDED OK")
