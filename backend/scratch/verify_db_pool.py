"""Pool-logic verification for database.py — runs WITHOUT touching real Turso.

Stubs libsql_experimental before importing database, forcing USE_TURSO=True with
a fake in-memory connection. Verifies:
  1. Sequential get_db/close reuses ONE pooled connection (no new connects).
  2. Distinct concurrent connections are handed out; each returns to the pool.
  3. A failing execute marks the connection unhealthy -> destroyed, not pooled.
  4. Write without commit + close => rollback called, next borrower is clean.
  5. Commit resets dirty; pristine (read-only) release skips rollback.
  6. Local SQLite path still returns fresh, working connections.
"""
import sys
import types
import os

os.environ["FORCE_LOCAL_DB"] = ""  # we drive USE_TURSO via the stub below
os.environ["TURSO_DATABASE_URL"] = "libsql://fake.example.turso.io"
os.environ["TURSO_AUTH_TOKEN"] = "fake-token-for-pool-test"

# ── Stub libsql_experimental BEFORE database import ─────────────────────────
class FakeRawConnection:
    connects = 0
    destroyed = 0
    def __init__(self):
        FakeRawConnection.connects += 1
        self.closed = False
        self.commits = 0
        self.rollbacks = 0
        self.executed = []
        self.fail_next_execute = False
        self.description = []
        self._rows = []
    def execute(self, sql, parameters=()):
        if self.fail_next_execute:
            raise RuntimeError("simulated connection failure")
        self.executed.append(sql)
        # Behave like a cursor: state updates in place, fetchone/fetchall read it.
        self.description = []
        self._rows = []
        return self
    def cursor(self): return self
    def fetchone(self):
        return self._rows.pop(0) if self._rows else None
    def fetchall(self):
        rows, self._rows = self._rows, []
        return rows
    def commit(self): self.commits += 1
    def rollback(self): self.rollbacks += 1
    def close(self):
        if not self.closed:
            FakeRawConnection.destroyed += 1
        self.closed = True

class _Row:
    def __init__(self, cursor, tuple_row):
        self._keys = [col[0] for col in cursor.description] if cursor.description else []
    def __getitem__(self, k): return None
    def keys(self): return self._keys

fake_libsql = types.ModuleType("libsql_experimental")
def _fake_connect(url, auth_token=None):
    return FakeRawConnection()  # __init__ owns the connects counter
fake_libsql.connect = _fake_connect
sys.modules["libsql_experimental"] = fake_libsql

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import database  # noqa: E402

assert database.USE_TURSO is True, "stub must force USE_TURSO=True"
database.LibsqlRow = _Row  # cursor.description is empty in the stub

failures = []
def check(name, ok, extra=""):
    print(f"{'PASS' if ok else 'FAIL'} — {name}" + (f"  ({extra})" if extra else ""))
    if not ok: failures.append(name)

# ── 1. Sequential reuse ─────────────────────────────────────────────────────
FakeRawConnection.connects = 0
c1 = database.get_db(); c1.execute("SELECT 1").fetchone(); c1.close()
c2 = database.get_db(); c2.execute("SELECT 1").fetchone(); c2.close()
check("sequential reuse: 1 connect for 2 get/close cycles", FakeRawConnection.connects == 1,
      f"connects={FakeRawConnection.connects}")
check("sequential reuse: same underlying raw connection", c1._conn is c2._conn)

# ── 2. Concurrent distinct connections ──────────────────────────────────────
a = database.get_db(); b = database.get_db()
check("concurrent: distinct connections", a._conn is not b._conn)
a.close(); b.close()
check("concurrent: both returned to pool", database._get_pool().qsize() == 2,
      f"pool={database._get_pool().qsize()}")

# ── 3. Failing execute -> destroyed, never pooled ───────────────────────────
bad = database.get_db()
pool_after_acquire = database._get_pool().qsize()
bad._conn.fail_next_execute = True
try:
    bad.execute("INSERT INTO x VALUES (1)")
except RuntimeError:
    pass
bad.close()
check("failed execute: connection destroyed (consumed + not re-pooled)",
      database._get_pool().qsize() == pool_after_acquire and FakeRawConnection.destroyed > 0,
      f"pool={database._get_pool().qsize()} after_acquire={pool_after_acquire} destroyed={FakeRawConnection.destroyed}")

# ── 4. Uncommitted write + close => rollback, next borrower clean ───────────
FakeRawConnection.connects = 0
w = database.get_db()
w.execute("UPDATE t SET x = 1")   # write -> dirty, NOT committed
w.close()                          # release -> must rollback
raw = w._conn
check("uncommitted write: release triggered rollback", raw.rollbacks >= 1, f"rollbacks={raw.rollbacks}")
nxt = database.get_db()
check("next borrower reuses rolled-back connection", nxt._conn is raw, f"connects={FakeRawConnection.connects}")
nxt.close()

# ── 5. Commit resets dirty; pristine release skips rollback ─────────────────
# (delta-based: the pooled connection carries rollback counts from earlier blocks)
FakeRawConnection.connects = 0
w2 = database.get_db()
base_r = w2._conn.rollbacks
w2.execute("UPDATE t SET x = 2")
w2.commit()      # committed -> dirty reset
w2.close()       # must NOT rollback again
check("committed write: no rollback at release", w2._conn.rollbacks == base_r,
      f"delta={w2._conn.rollbacks - base_r}")

p = database.get_db()
base_p = p._conn.rollbacks
p.execute("SELECT 1").fetchone()  # read-only -> stays pristine
p.close()
check("read-only release: no rollback round-trip", p._conn.rollbacks == base_p,
      f"delta={p._conn.rollbacks - base_p}")

# ── 6. Local SQLite path still fresh + working ──────────────────────────────
saved = database.USE_TURSO
database.USE_TURSO = False
try:
    lc = database._open_connection()
    lc.execute("SELECT 1")
    check("local sqlite: fresh connection works", lc is not None)
finally:
    database.USE_TURSO = True

print()
print(f"{len(failures)} failed" if failures else "ALL POOL CHECKS PASSED")
sys.exit(1 if failures else 0)
