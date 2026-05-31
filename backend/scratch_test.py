import sqlite3
import time
from security.rate_limiter import get_blocked_ips

def test():
    conn = sqlite3.connect('jdlx.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM security_alerts ORDER BY created_at DESC LIMIT 20")
    suspicious = [dict(row) for row in cursor.fetchall()]
    print("Suspicious ok", len(suspicious))
    
    blocked = get_blocked_ips()
    print("Blocked ok", len(blocked))
    
    cursor.execute("SELECT * FROM login_attempts WHERE status = 'failed' ORDER BY timestamp DESC LIMIT 20")
    failed_logins = [dict(row) for row in cursor.fetchall()]
    print("Failed logins ok", len(failed_logins))
    conn.close()

try:
    test()
except Exception as e:
    print("ERROR:", str(e))
