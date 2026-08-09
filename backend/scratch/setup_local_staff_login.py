"""Local-only helper: give staff_id=1 a password + billing role for manual QA."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from werkzeug.security import generate_password_hash
from database import get_db

conn = get_db()
cur = conn.cursor()
r = cur.execute(
    "SELECT role_id FROM roles WHERE vendor_id=1 AND role_name=?",
    ('Billing Agent',),
).fetchone()
if not r:
    cur.execute(
        "INSERT INTO roles (vendor_id, role_name, permissions) VALUES (1, 'Billing Agent', ?)",
        ('["billing"]',),
    )
    rid = cur.lastrowid
else:
    rid = r['role_id']

cur.execute(
    "UPDATE warehouse_staff SET role_id=?, password_hash=?, status=? WHERE staff_id=1",
    (rid, generate_password_hash('TestPass@123'), 'active'),
)
conn.commit()
print('role_id:', rid)
st = cur.execute(
    "SELECT staff_id, name, login_email, status FROM warehouse_staff WHERE staff_id=1"
).fetchone()
print(dict(st))
conn.close()
