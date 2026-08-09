"""Removes the OFFLINE test bills created while testing the damage feature and
restores stock exactly per the backend's own restock logic.

Restock qty = quantity (billed) + COALESCE(damage_qty, 0) because damaged units
were also decremented from stock at sale time.
"""
import os
import shutil
import sqlite3
import sys

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "jdlx.db")

# Safety backup first
backup = DB + f".backup-damage-cleanup"
shutil.copy2(DB, backup)
print(f"Backup saved: {backup}")

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

offline = cur.execute(
    "SELECT id, order_number, customer_name FROM orders WHERE source = 'OFFLINE' ORDER BY id"
).fetchall()
print(f"OFFLINE test bills to remove: {len(offline)}")
for r in offline:
    print(f"  #{r['id']} {r['order_number']} ({r['customer_name']})")

restored = {}
for r in offline:
    items = cur.execute(
        "SELECT product_id, quantity, COALESCE(damage_qty, 0) AS dq FROM order_items WHERE order_id = ?",
        (r["id"],),
    ).fetchall()
    for it in items:
        qty = int(it["quantity"] or 0) + int(it["dq"] or 0)
        if qty <= 0:
            continue
        # Restock exactly like _restock_billing_item (global + warehouse inventory)
        cur.execute("UPDATE products SET stock = stock + ? WHERE id = ?", (qty, it["product_id"]))
        cur.execute(
            """UPDATE warehouse_inventory
               SET stock_quantity = COALESCE(stock_quantity, 0) + ?,
                   available_stock = COALESCE(available_stock, 0) + ?
               WHERE product_id = ?""",
            (qty, qty, it["product_id"]),
        )
        restored[it["product_id"]] = restored.get(it["product_id"], 0) + qty
    cur.execute("DELETE FROM order_items WHERE order_id = ?", (r["id"],))
    cur.execute("DELETE FROM orders WHERE id = ?", (r["id"],))

conn.commit()

print("\nStock restored per product:")
for pid, qty in restored.items():
    row = cur.execute("SELECT name, stock FROM products WHERE id = ?", (pid,)).fetchone()
    print(f"  #{pid} {row['name']} +{qty} -> stock {row['stock']}")

remaining = cur.execute("SELECT COUNT(*) FROM orders WHERE source = 'OFFLINE'").fetchone()[0]
online = cur.execute("SELECT COUNT(*) FROM orders WHERE source = 'ONLINE'").fetchone()[0]
print(f"\nOFFLINE orders left: {remaining} | ONLINE orders left: {online}")
conn.close()
print("DONE")
