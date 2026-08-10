"""Integration tests for admin-panel security controls.

Covers the 4 audit gaps:
  GAP 1: /api/admin/admins CRUD (list/create/update/status/delete) + status column
  GAP 2: analytics sub-endpoints (top-pages, traffic-sources, devices, searches, funnel, user-journeys)
  GAP 3: /api/admin/suppliers
  GAP 4: role consistency (sub-roles preserved, role->permission mapping, permission guard)

Runs against a fresh temp DB — never touches live data.
"""
import os
import sys
import json
import sqlite3
import tempfile

os.environ['FORCE_LOCAL_DB'] = '1'
os.environ['DATABASE_PATH'] = '/tmp/admin_security_test.db'
os.environ['DISABLE_RATE_LIMIT'] = '1'

if os.path.exists(os.environ['DATABASE_PATH']):
    os.remove(os.environ['DATABASE_PATH'])

sys.path.insert(0, '.')

from database import init_db, get_db
from auth.role_guard import normalize_role, ADMIN_ROLES, require_admin

PASS = []
FAIL = []


def check(name, cond, detail=''):
    if cond:
        PASS.append(name)
        print(f"  ✅ PASS: {name}")
    else:
        FAIL.append(name)
        print(f"  ❌ FAIL: {name} {detail}")


def db():
    c = sqlite3.connect(os.environ['DATABASE_PATH'])
    c.row_factory = sqlite3.Row
    return c


# ---------- init ----------
init_db()
from app import app
app.config['TESTING'] = True
client = app.test_client()

conn = db()
conn.row_factory = sqlite3.Row
# users: 1=super_admin, 2=admin, 3=manager, 4=inventory_admin, 5=delivery_admin, 6=support_admin, 7=normal user
for uid, email, role in [
    (1, 'root@test.local', 'super_admin'),
    (2, 'admin@test.local', 'admin'),
    (3, 'manager@test.local', 'manager'),
    (4, 'invadmin@test.local', 'inventory_admin'),
    (5, 'delivadmin@test.local', 'delivery_admin'),
    (6, 'supadmin@test.local', 'support_admin'),
    (7, 'user@test.local', 'user'),
]:
    conn.execute("INSERT INTO users (id, google_id, name, email, role) VALUES (?, ?, ?, ?, ?)",
                 (uid, f'g{uid}', f'User {uid}', email, role))
    if role in ADMIN_ROLES:
        conn.execute("INSERT INTO admins (id, user_id, role, status) VALUES (?, ?, ?, 'active')",
                     (uid, uid, role))
conn.commit()

# super_admin permissions (full access)
for perm in ['manage_products', 'manage_orders', 'manage_inventory', 'manage_delivery', 'manage_users', 'view_analytics', 'manage_admins', 'manage_settings']:
    conn.execute("INSERT OR IGNORE INTO admin_permissions (admin_id, permission) VALUES (1, ?)", (perm,))
conn.commit()


def make_token(uid, role, email):
    """Generate a token by calling process_google_user_login logic minimally."""
    from auth.role_guard import normalize_role as nr
    import jwt as pyjwt
    from jwt_config import get_jwt_secret
    payload = {
        'user_id': uid,
        'email': email,
        'name': f'User {uid}',
        'role': nr(role),
        'exp': 9999999999,
    }
    return pyjwt.encode(payload, get_jwt_secret(), algorithm='HS256')


TOKENS = {r: make_token(uid, r, email) for uid, email, r in [
    (1, 'root@test.local', 'super_admin'),
    (2, 'admin@test.local', 'admin'),
    (3, 'manager@test.local', 'manager'),
    (7, 'user@test.local', 'user'),
]}

H = {'Authorization': f"Bearer {TOKENS['super_admin']}"}
H_ADMIN = {'Authorization': f"Bearer {TOKENS['admin']}"}
H_MGR = {'Authorization': f"Bearer {TOKENS['manager']}"}
H_USER = {'Authorization': f"Bearer {TOKENS['user']}"}

print("\n=========== GAP 4: ROLE CONSISTENCY ===========")

# normalize_role preserves sub-roles
check("normalize_role('manager') preserved", normalize_role('manager') == 'manager')
check("normalize_role('inventory_admin') preserved", normalize_role('inventory_admin') == 'inventory_admin')
check("normalize_role('support_admin') preserved", normalize_role('support_admin') == 'support_admin')
check("normalize_role('delivery_admin') preserved", normalize_role('delivery_admin') == 'delivery_admin')
check("normalize_role('user') still user", normalize_role('user') == 'user')

# require_admin() default now allows sub-roles
check("ADMIN_ROLES includes sub-roles", ADMIN_ROLES == {'admin', 'super_admin', 'manager', 'inventory_admin', 'delivery_admin', 'support_admin'})

# regular user still blocked from admin APIs
r = client.get('/api/admin/orders', headers=H_USER)
check("normal user -> admin API 403", r.status_code == 403, f"(got {r.status_code})")

# manager can hit an admin route that has no extra permission requirement
r = client.get('/api/admin/reviews', headers=H_MGR)
check("manager -> /api/admin/reviews accessible (role gate)", r.status_code in (200, 500), f"(got {r.status_code})")

# manager without manage_products permission blocked from product management
conn = db()
conn.execute("DELETE FROM admin_permissions WHERE admin_id = 3")
conn.commit()
conn.close()
r = client.get('/api/admin/device-models', headers=H_MGR)
check("manager w/o manage_products -> 403 on device-models", r.status_code == 403, f"(got {r.status_code})")

# grant manager manage_products -> now allowed
conn = db()
conn.execute("INSERT OR IGNORE INTO admin_permissions (admin_id, permission) VALUES (3, 'manage_products')")
conn.commit()
conn.close()
r = client.get('/api/admin/device-models', headers=H_MGR)
check("manager WITH manage_products -> device-models accessible", r.status_code in (200, 500), f"(got {r.status_code})")

print("\n=========== GAP 1: ADMINS CRUD + STATUS ===========")

# admins table has status column
cols = [c[1] for c in db().execute('PRAGMA table_info(admins)').fetchall()]
check("admins.status column exists", 'status' in cols, f"(got {cols})")

# LIST admins
r = client.get('/api/admin/admins', headers=H)
check("GET /api/admin/admins -> 200", r.status_code == 200, f"(got {r.status_code} {r.get_json()})")
body = r.get_json() or []
check("list includes status field", all('status' in a for a in body), f"(got {body[:1]})")
check("list has 6 admins", len(body) == 6, f"(got {len(body)})")

# normal user blocked
r = client.get('/api/admin/admins', headers=H_USER)
check("normal user -> admins list 403", r.status_code == 403, f"(got {r.status_code})")

# admin (not super) blocked — manage_admins permission check
conn = db()
conn.execute("INSERT OR IGNORE INTO admin_permissions (admin_id, permission) VALUES (2, 'manage_admins')")
conn.commit()
conn.close()
r = client.get('/api/admin/admins', headers=H_ADMIN)
check("plain admin -> admins list 403 (requires super_admin)", r.status_code == 403, f"(got {r.status_code})")

# CREATE admin (promote user 7 -> manager)
r = client.post('/api/admin/admins', json={'email': 'user@test.local', 'name': 'New Mgr', 'role': 'manager'}, headers=H)
check("POST /api/admin/admins promote user -> 201", r.status_code == 201, f"(got {r.status_code} {r.get_json()})")

# invalid role rejected
r = client.post('/api/admin/admins', json={'email': 'user@test.local', 'role': 'hacker'}, headers=H)
check("POST invalid role -> 400", r.status_code == 400, f"(got {r.status_code})")

# list now 7; user 7 role = manager
conn = db()
row = conn.execute("SELECT role FROM users WHERE id = 7").fetchone()
conn.close()
check("user 7 promoted to manager", row['role'] == 'manager', f"(got {row['role']})")

# UPDATE role (admins.id = 7 for user 7)
r = client.put('/api/admin/admins/7', json={'name': 'Renamed', 'role': 'inventory_admin'}, headers=H)
check("PUT /api/admin/admins/7 -> 200", r.status_code == 200, f"(got {r.status_code} {r.get_json()})")
conn = db()
row = conn.execute("SELECT role FROM users WHERE id = 7").fetchone()
conn.close()
check("user 7 role updated to inventory_admin", row['role'] == 'inventory_admin', f"(got {row['role']})")

# STATUS toggle: disable admin 6
r = client.patch('/api/admin/admins/6/status', json={'status': 'disabled'}, headers=H)
check("PATCH disable admin 6 -> 200", r.status_code == 200, f"(got {r.status_code} {r.get_json()})")
conn = db()
row = conn.execute("SELECT status FROM admins WHERE id = 6").fetchone()
conn.close()
check("admin 6 status = disabled", row['status'] == 'disabled', f"(got {row['status']})")

# super_admin cannot disable self
r = client.patch('/api/admin/admins/1/status', json={'status': 'disabled'}, headers=H)
check("super_admin cannot disable self -> 400", r.status_code == 400, f"(got {r.status_code} {r.get_json()})")

# disabled admin's EXISTING session is revoked at the guard (not only at login)
r = client.patch('/api/admin/admins/5/status', json={'status': 'disabled'}, headers=H)
check("PATCH disable admin 5 -> 200", r.status_code == 200, f"(got {r.status_code} {r.get_json()})")
H_DELIV = {'Authorization': f"Bearer {make_token(5, 'delivery_admin', 'delivadmin@test.local')}"}
r = client.get('/api/admin/delivery-partners', headers=H_DELIV)
check("disabled admin's live JWT rejected by guard (403)", r.status_code == 403, f"(got {r.status_code} {r.get_json()})")
# delivery-partners is now protected (was public before this fix)
r = client.get('/api/admin/delivery-partners', headers=H_USER)
check("delivery-partners no longer public (normal user 403)", r.status_code == 403, f"(got {r.status_code} {r.get_json()})")
r = client.get('/api/admin/delivery-partners')
check("delivery-partners requires auth (no token 401/403)", r.status_code in (401, 403), f"(got {r.status_code})")
# re-enable for later role tests
r = client.patch('/api/admin/admins/5/status', json={'status': 'active'}, headers=H)
check("PATCH re-enable admin 5 -> 200", r.status_code == 200, f"(got {r.status_code})")

# role change revokes stale permissions (admin 2: demote admin->support_admin loses manage_products)
conn = db()
conn.execute("INSERT OR IGNORE INTO admin_permissions (admin_id, permission) VALUES (2, 'manage_products')")
conn.commit()
conn.close()
r = client.put('/api/admin/admins/2', json={'role': 'support_admin'}, headers=H)
check("PUT demote admin 2 -> support_admin -> 200", r.status_code == 200, f"(got {r.status_code} {r.get_json()})")
conn = db()
perms = {row[0] for row in conn.execute("SELECT permission FROM admin_permissions WHERE admin_id = 2").fetchall()}
conn.close()
check("stale manage_products revoked on role change", 'manage_products' not in perms, f"(got {perms})")
check("support_admin defaults present after demote", 'manage_orders' in perms and 'manage_users' in perms, f"(got {perms})")

# DELETE admin 7
r = client.delete('/api/admin/admins/7', headers=H)
check("DELETE /api/admin/admins/7 -> 200", r.status_code == 200, f"(got {r.status_code} {r.get_json()})")
conn = db()
row = conn.execute("SELECT role FROM users WHERE id = 7").fetchone()
conn.close()
check("user 7 demoted to user", row['role'] == 'user', f"(got {row['role']})")

print("\n=========== GAP 2: ANALYTICS SUB-ENDPOINTS ===========")
for ep in ['top-pages', 'traffic-sources', 'devices', 'searches', 'funnel', 'user-journeys']:
    r = client.get(f'/api/admin/analytics/{ep}', headers=H)
    ok = r.status_code == 200 and (r.get_json() or {}).get('success') is not False
    check(f"GET /api/admin/analytics/{ep} -> success", ok, f"(got {r.status_code} {r.get_json()})")

# protected: normal user blocked
r = client.get('/api/admin/analytics/top-pages', headers=H_USER)
check("normal user -> analytics 403", r.status_code == 403, f"(got {r.status_code})")

print("\n=========== GAP 3: SUPPLIERS ===========")
conn = db()
conn.execute('''CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, contact TEXT, email TEXT, gst_in TEXT, role TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)''')
conn.execute("INSERT INTO suppliers (name, contact, email) VALUES ('Test Supplier', '999', 's@test.local')")
conn.commit()
conn.close()
r = client.get('/api/admin/suppliers', headers=H)
check("GET /api/admin/suppliers -> 200 with data", r.status_code == 200 and len(r.get_json() or []) >= 1, f"(got {r.status_code} {r.get_json()})")
r = client.get('/api/admin/suppliers', headers=H_USER)
check("normal user -> suppliers 403", r.status_code == 403, f"(got {r.status_code})")

print("\n=========== WAREHOUSE BLUEPRINT ROUTES (in-body _require_admin_token) ===========")
# These routes are guarded via _require_admin_token() inside the function body.
# They must reject normal users AND accept admin sub-roles (GAP 4 consistency).
r = client.get('/api/admin/warehouses', headers=H_USER)
check("normal user -> /api/admin/warehouses 403", r.status_code == 403, f"(got {r.status_code})")
r = client.get('/api/admin/warehouses')
check("no token -> /api/admin/warehouses 401", r.status_code == 401, f"(got {r.status_code})")
r = client.get('/api/admin/warehouses', headers=H_MGR)
check("manager (sub-role) -> /api/admin/warehouses accessible", r.status_code in (200, 500), f"(got {r.status_code})")
r = client.get('/api/admin/warehouse/applications', headers=H_MGR)
check("manager (sub-role) -> /api/admin/warehouse/applications accessible", r.status_code in (200, 500), f"(got {r.status_code})")
r = client.get('/api/admin/warehouse/applications', headers=H_USER)
check("normal user -> warehouse applications 403", r.status_code == 403, f"(got {r.status_code})")

print("\n" + "=" * 50)
print(f"TOTAL: {len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    print("FAILED:", FAIL)
    sys.exit(1)
print("ALL ADMIN SECURITY TESTS PASSED ✅")
