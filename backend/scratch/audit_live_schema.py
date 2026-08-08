"""
Audit: live Turso DB schema vs what the order-placement / payment-confirmation
code paths reference. READ-ONLY - no writes.
"""
import sys
sys.path.insert(0, ".")
from database import get_db

conn = get_db()

def cols(table):
    try:
        return [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    except Exception as e:
        return f"ERROR: {e}"

tables = ['orders', 'order_items', 'payments', 'wallet_transactions',
          'warehouse_inventory', 'warehouses', 'products', 'product_variants',
          'warehouse_staff', 'roles']
for t in tables:
    c = cols(t)
    if isinstance(c, list):
        print(f"\n=== {t} ({len(c)} cols) ===")
        print(", ".join(c))
    else:
        print(f"\n=== {t} ===")
        print(c)

# Key columns the checkout INSERT references
print("\n\n=== CHECKOUT-FLOW COLUMN CHECKS ===")
order_cols = set(cols('orders')) if isinstance(cols('orders'), list) else set()
check = {
    'orders.order_number': 'order_number' in order_cols,
    'orders.source': 'source' in order_cols,
    'orders.agent_id': 'agent_id' in order_cols,
    'orders.cod_advance_paid': 'cod_advance_paid' in order_cols,
    'orders.cod_remaining_amount': 'cod_remaining_amount' in order_cols,
    'orders.free_delivery_applied': 'free_delivery_applied' in order_cols,
    'orders.fitting_charge': 'fitting_charge' in order_cols,
    'orders.delivery_type': 'delivery_type' in order_cols,
}
for k, v in check.items():
    print(f"  {'OK ' if v else 'MISSING!'} {k}")

conn.close()
print("\nAudit complete (read-only).")
