"""Synthetic benchmark: order-history query (WHERE user_id ORDER BY created_at DESC)
with and without the new composite index. Honest numbers for the index change."""
import sqlite3
import time

N_ROWS = 100_000
TARGET_USER = 42  # user with a moderate number of orders

def build_db(indexed):
    conn = sqlite3.connect(":memory:")
    cur = conn.cursor()
    cur.execute("CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, created_at TEXT, order_status TEXT)")
    cur.execute("CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER)")
    # ~120 orders for the target user, rest spread over 50k users
    rows = []
    for i in range(1, N_ROWS + 1):
        uid = TARGET_USER if i <= 120 else 1 + (i % 50000)
        rows.append((i, uid, f"2026-08-{(i % 28) + 1:02d} 10:00:00", "PLACED"))
    cur.executemany("INSERT INTO orders VALUES (?, ?, ?, ?)", rows)
    # order_items: 3 items per order for the target user (the join-style lookup)
    item_id = 0
    items = []
    for oid in range(1, 121):
        for _ in range(3):
            item_id += 1
            items.append((item_id, oid, 1))
    cur.executemany("INSERT INTO order_items VALUES (?, ?, ?)", items)
    if indexed:
        cur.execute("CREATE INDEX idx_orders_user_created ON orders(user_id, created_at)")
        cur.execute("CREATE INDEX idx_order_items_order ON order_items(order_id)")
    conn.commit()
    return conn

def run(conn, label):
    cur = conn.cursor()
    # Warm cache then time best-of-5
    for _ in range(3):
        cur.execute("SELECT id, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC", (TARGET_USER,)).fetchall()
    best = float("inf")
    for _ in range(5):
        t0 = time.perf_counter()
        cur.execute("SELECT id, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC", (TARGET_USER,)).fetchall()
        best = min(best, time.perf_counter() - t0)
    print(f"{label:28s} {best * 1000:8.3f} ms")

print(f"rows={N_ROWS}, target user has 120 orders")
run(build_db(False), "without index (scan)")
run(build_db(True), "with composite index")
