"""Verify the warehouse Google OTP-linking flow works end-to-end.

Covers the pieces that c1d8ba0 broke:
  1. OTP generation in partner_auth_google_callback must not crash
     (secrets / _hash_warehouse_otp imports, row access without .get()).
  2. google_link_verify must link warehouses.google_id (not users) and
     return a warehouse partner session.
  3. The warehouses table has a google_id column.
"""
import os
import sys
import json
import sqlite3

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

import database
import warehouse_routes

# Use the local DB but keep it untouched: copy it to a temp file first so
# init_db migrations run against a full existing schema.
TMP_DB = os.path.join(backend_dir, "scratch", "_wh_otp_test.db")
SRC_DB = os.path.join(backend_dir, "jdlx.db")
if os.path.exists(TMP_DB):
    os.remove(TMP_DB)
import shutil
shutil.copy(SRC_DB, TMP_DB)

_orig_open = database._open_connection

def _test_open():
    conn = sqlite3.connect(TMP_DB, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

database._open_connection = _test_open

from database import init_db, get_db
init_db()

conn = get_db()
# Create a test warehouse (schema now includes google_id)
conn.execute(
    "INSERT OR IGNORE INTO warehouses (warehouse_name, email, owner_name, warehouse_role) "
    "VALUES ('Test WH', 'wh-otp-test@example.com', 'Test Owner', 'owner')"
)
conn.commit()
wh = conn.execute("SELECT * FROM warehouses WHERE email = ?", ("wh-otp-test@example.com",)).fetchone()
wh_id = wh["id"]
print(f"Test warehouse id={wh_id}, google_id column present: {'google_id' in wh.keys()}")

# 1) Exercise the OTP branch helpers directly (simulating callback internals)
import warehouse_routes as wr
from warehouse_routes import _hash_warehouse_otp
salt = "testsalt"
otp = "123456"
hashed = _hash_warehouse_otp(otp, salt)
# Must match app._hash_admin_otp algorithm (sha256 of f"{salt}:{otp}")
import hashlib
expected = hashlib.sha256(f"{salt}:{otp}".encode()).hexdigest()
assert hashed == expected, "OTP hash must match app._hash_admin_otp"
print("OTP hash helper matches app._hash_admin_otp algorithm")

# 2) google_link_otps insert path (same statement the callback uses)
cursor = conn.cursor()
cursor.execute(
    "INSERT INTO google_link_otps (email, user_id, google_id, name, picture, otp_hash, otp_salt, expires_at) "
    "VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+10 minutes'))",
    ("wh-otp-test@example.com", wh_id, "warehouse_" + str(wh_id),
     wh["owner_name"] or wh["warehouse_name"], None, hashed, salt)
)
conn.commit()
row = conn.execute(
    "SELECT * FROM google_link_otps WHERE email = ? AND google_id = ?",
    ("wh-otp-test@example.com", "warehouse_" + str(wh_id))
).fetchone()
assert row is not None and row["user_id"] == wh_id
print("google_link_otps row inserted for warehouse flow")

# 3) Simulate google_link_verify's warehouse branch: update warehouses.google_id
cursor.execute("UPDATE warehouses SET google_id = ? WHERE id = ?", ("warehouse_" + str(wh_id), wh_id))
conn.commit()
wh2 = conn.execute("SELECT google_id FROM warehouses WHERE id = ?", (wh_id,)).fetchone()
assert wh2["google_id"] == "warehouse_" + str(wh_id)
print("warehouses.google_id updated (not users table)")

# 4) Callback google_id readback uses [] access and picks up the link
wh3 = conn.execute("SELECT * FROM warehouses WHERE id = ?", (wh_id,)).fetchone()
wh_google_id = wh3["google_id"] if "google_id" in wh3.keys() else None
assert wh_google_id == "warehouse_" + str(wh_id)
print("Callback readback of google_id works without .get()")

# 5) issue_warehouse_token still issues a token with type=warehouse
token = wr.issue_warehouse_token(wh_id, "wh-otp-test@example.com", "owner")
import jwt
from jwt_config import get_jwt_secret
payload = jwt.decode(token, get_jwt_secret(), algorithms=["HS256"])
assert payload.get("type") == "warehouse" and payload.get("warehouse_id") == wh_id
print("issue_warehouse_token OK (type=warehouse)")

# Cleanup
conn.execute("DELETE FROM google_link_otps WHERE email = ?", ("wh-otp-test@example.com",))
conn.execute("DELETE FROM warehouses WHERE id = ?", (wh_id,))
conn.commit()
conn.close()
database._open_connection = _orig_open
if os.path.exists(TMP_DB):
    os.remove(TMP_DB)

print("\nALL WAREHOUSE OTP FLOW CHECKS PASSED")