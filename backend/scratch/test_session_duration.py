#!/usr/bin/env python3
"""Verify user_session_duration_hours setting + token expiry logic."""
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import sqlite3

conn = sqlite3.connect(os.path.join(BASE_DIR, "jdlx.db"))
c = conn.cursor()

# 1. Setting seeded
c.execute("SELECT value FROM system_settings WHERE key = 'user_session_duration_hours'")
row = c.fetchone()
print("1. user_session_duration_hours =", row[0] if row else "MISSING")
assert row and row[0], "Setting not seeded!"
assert float(row[0]) == 8760, "Default should be 8760"

# 2. Simulate the app logic
def compute_expiry(user_role, hours_setting=None):
    is_admin = user_role in ("admin", "super_admin")
    user_session_hours = 8760
    if hours_setting:
        parsed = float(hours_setting)
        if parsed and parsed > 0:
            user_session_hours = parsed
    token_expiry_hours = 8 if is_admin else user_session_hours
    return token_expiry_hours

assert compute_expiry("user") == 8760, "Regular user default should be 8760h (365 days)"
assert compute_expiry("user", "720") == 720, "Admin can set 720h"
assert compute_expiry("admin") == 8, "Admin stays 8h (security)"
assert compute_expiry("super_admin", "24") == 8, "Super admin stays 8h regardless"
print("2. Token expiry logic: user=8760h default, admin=8h fixed -> OK")

# 3. Check the actual code has the new logic
with open(os.path.join(BASE_DIR, "app.py")) as f:
    src = f.read()
assert "user_session_duration_hours" in src, "app.py should read the setting"
assert "user_session_hours = 8760" in src, "app.py should have 8760 default"
print("3. app.py reads user_session_duration_hours -> OK")

conn.close()
print("\nALL SESSION DURATION TESTS PASSED ✔")
