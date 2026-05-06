import sqlite3
import json

c = sqlite3.connect('jdlx.db')
c.row_factory = sqlite3.Row

def get_columns(table):
    cursor = c.execute(f"PRAGMA table_info({table})")
    return [row['name'] for row in cursor.fetchall()]

out = {
    'dark_stores': get_columns('dark_stores'),
    'warehouses': get_columns('warehouses'),
    'warehouse_applications': get_columns('warehouse_applications')
}

with open('schema_cols.json', 'w') as f:
    json.dump(out, f, indent=2)
