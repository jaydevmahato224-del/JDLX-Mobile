"""Verify the pool's idle-age guard (DB_POOL_MAX_IDLE_SECONDS).

Turso's Hrana server expires streams that sit idle ("stream expired due to
inactivity" — libsql-python#41). A pooled connection older than
DB_POOL_MAX_IDLE_SECONDS must be destroyed and re-created instead of handed to
the next request — that reuse was the root cause of random one-off 500s on
/api/brands, /api/products etc. that succeeded on retry.

Uses the same FakeRawConnection stub approach as verify_db_pool.py (no network).
Run from backend/:  PYTHONPATH=. python3 scratch/verify_pool_idle_aging.py
"""
import os
import sys
import types

DB = "/tmp/jdlx_pool_aging.db"
if os.path.exists(DB):
    os.remove(DB)
os.environ["FORCE_LOCAL_DB"] = "0"          # exercise the TURSO pool path
os.environ["DATABASE_PATH"] = DB
os.environ["TURSO_DATABASE_URL"] = "http://stub.turso.internal"
os.environ["TURSO_AUTH_TOKEN"] = "stub-token"
os.environ["DB_POOL_MAX_SIZE"] = "8"
os.environ["DB_POOL_IDLE_KEEP"] = "4"
os.environ["DB_POOL_MAX_IDLE_SECONDS"] = "45"

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ── stub libsql_experimental BEFORE importing database ───────────────────────
connects = {"n": 0}
closes = {"n": 0}

class FakeRawCursor:
    def __init__(self, conn):
        self._conn = conn
        self.description = None
    def execute(self, sql, parameters=()):
        self._conn.executes.append(sql)
        self.description = []
    def fetchall(self): return []
    def fetchone(self): return None

class FakeRawConnection:
    def __init__(self):
        connects["n"] += 1
        self.id = connects["n"]
        self.executes = []
    def cursor(self): return FakeRawCursor(self)
    def execute(self, sql, parameters=()):
        self.executes.append(sql)
        return FakeRawCursor(self)
    def commit(self): pass
    def rollback(self): self.executes.append("ROLLBACK")
    def close(self): closes["n"] += 1

fake_libsql = types.ModuleType("libsql_experimental")
fake_libsql.connect = lambda url, auth_token=None: FakeRawConnection()
sys.modules["libsql_experimental"] = fake_libsql

import database  # noqa: E402

assert database.USE_TURSO is True, "stub must force USE_TURSO=True"
assert database._POOL_MAX_IDLE_SECONDS == 45.0, "env override must be read"
database.LibsqlRow = lambda cursor, row: row  # description is empty in the stub

failures = []
def check(name, ok, extra=""):
    print(f"{'PASS' if ok else 'FAIL'} — {name}" + (f"  ({extra})" if extra else ""))
    if not ok: failures.append(name)

def fresh_pool():
    database._POOL = None  # reset the module-level singleton between scenarios
    return database._get_pool()

# ── 1. fresh (recently released) connection IS reused ────────────────────────
fresh_pool()
c1 = database._acquire_connection()
c1.close()
assert database._POOL.qsize() == 1
c2 = database._acquire_connection()
check("fresh pooled connection is reused (no re-handshake)", c2 is c1 and connects["n"] == 1,
      f"connects={connects['n']}")
c2.close()

# ── 2. aged-out connection is NOT reused — a new one is created ──────────────
import time
c3 = database._acquire_connection()
c3.close()
# backdate AFTER release: close() stamps _released_at = now, then we simulate
# the connection having sat idle in the pool for 46s (> the 45s limit)
c3._released_at = time.monotonic() - 46.0
before = connects["n"]
c4 = database._acquire_connection()
check("aged-out pooled connection is destroyed, not reused", c4 is not c3 and connects["n"] == before + 1,
      f"connects {before}->{connects['n']}")
check("aged-out connection's raw handle was closed", closes["n"] >= 1)
c4.close()

# ── 3. backdated stamp does not poison the new connection ────────────────────
c5 = database._acquire_connection()
c5.close()
c6 = database._acquire_connection()
check("newly released connection back in the pool is reusable", c6 is c5,
      f"connects={connects['n']}")
c6.close()

# ── 4. just-under-the-limit connection is still reused ──────────────────────
database._POOL = None
c7 = database._acquire_connection()
c7._released_at = time.monotonic() - 44.0  # 44s < 45s limit
c7.close()
c8 = database._acquire_connection()
check("connection idle 44s (< 45s limit) is still reused", c8 is c7, f"connects={connects['n']}")
c8.close()

print()
print(f"{'ALL IDLE-AGING CHECKS PASSED' if not failures else 'FAILURES: ' + ', '.join(failures)}")
sys.exit(1 if failures else 0)
