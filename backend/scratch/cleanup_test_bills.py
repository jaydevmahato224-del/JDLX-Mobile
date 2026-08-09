"""One-time cleanup for the LOCAL QA database (jdlx.db).

Deletes every OFFLINE counter-sale order (all are test artifacts from this QA
session) and first restores the exact stock those bills consumed, using the
same restock math as the backend (_restock_billing_item): for each order item,
(quantity - returned_qty) is added back to products.stock and the vendor's
warehouse_inventory. Cancelled/returned/exchanged bills already restocked via
the API, so their returned_qty == quantity -> nothing is double-added.

Only touches jdlx.db (FORCE_LOCAL_DB). Production Turso is not connected.
"""
import sqlite3
import shutil
import sys
import os

DB = os.path.join(os.path.dirname(__file__), "..", "jdlx.db")
DB = os.path.abspath(DB)

if not os.path.exists(DB):
    print("DB not found:", DB)
    sys.exit(1)

# Safety backup before touching anything.
backup = DB + ".backup-{0}".format(__import__("datetime").datetime.now().strftime("%Y%m%d%H%M%S"))
shutil.copy2(DB, backup)
print("Backup saved:", backup)

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
try:
    conn.execute("BEGIN")

    offline = conn.execute(
        "SELECT id, vendor_id FROM orders WHERE source = 'OFFLINE'"
    ).fetchall()
    offline_ids = [r["id"] for r in offline]
    print("OFFLINE orders to remove:", len(offline_ids))

    if not offline_ids:
        print("Nothing to clean.")
        conn.rollback()
        sys.exit(0)

    # 1. Restore stock exactly like _restock_billing_item.
    restored = {}
    items = conn.execute(
        """SELECT oi.product_id, oi.quantity, COALESCE(oi.returned_qty, 0) AS rq, o.vendor_id
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
           WHERE o.source = 'OFFLINE'"""
    ).fetchall()
    for it in items:
        back = int(it["quantity"]) - int(it["rq"])
        if back <= 0:
            continue
        conn.execute("UPDATE products SET stock = stock + ? WHERE id = ?", (back, it["product_id"]))
        conn.execute(
            """UPDATE warehouse_inventory
               SET stock_quantity = COALESCE(stock_quantity, 0) + ?,
                   available_stock = COALESCE(available_stock, 0) + ?
               WHERE warehouse_id = ? AND product_id = ?""",
            (back, back, it["vendor_id"], it["product_id"]),
        )
        restored[it["product_id"]] = restored.get(it["product_id"], 0) + back
    print("Stock restored:", restored or "none (all already returned/cancelled)")

    # 2. Delete child rows in any table that references order_id, then the
    #    order_items and the orders themselves.
    placeholders = ",".join("?" * len(offline_ids))
    tables = [r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()]
    deleted_children = {}
    for t in tables:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(%s)" % t).fetchall()]
        if "order_id" not in cols:
            continue
        try:
            cur = conn.execute(
                "DELETE FROM %s WHERE order_id IN (%s)" % (t, placeholders),
                offline_ids,
            )
        except sqlite3.OperationalError as e:
            print("  skip", t, ":", e)
            continue
        if cur.rowcount:
            deleted_children[t] = cur.rowcount
    print("Child rows deleted:", deleted_children or "none")

    conn.execute("DELETE FROM order_items WHERE order_id IN (%s)" % placeholders, offline_ids)
    conn.execute("DELETE FROM orders WHERE id IN (%s)" % placeholders, offline_ids)

    conn.commit()
    print("DONE.")
    print("Remaining orders:", conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0],
          "| remaining OFFLINE:", conn.execute("SELECT COUNT(*) FROM orders WHERE source='OFFLINE'").fetchone()[0])
finally:
    conn.close()
