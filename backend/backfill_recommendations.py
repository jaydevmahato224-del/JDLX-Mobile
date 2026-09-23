"""
One-time backfill: generate smart recommendations for products that have
none yet (all legacy products + any created before the engine existed).

Safe by design:
  - Only fills products with ZERO existing recommendation rows
    (manually mapped products are never touched).
  - Idempotent: re-running fills nothing new.
  - Read-only for everything except INSERTs into product_recommendations.

Usage (from backend/):   python3 backfill_recommendations.py [--dry-run]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# --- SAFETY GUARD ------------------------------------------------------------
# When Turso credentials exist in .env, the app connects to the REMOTE database
# and silently ignores DATABASE_PATH. Running this script with only
# DATABASE_PATH set ("I mean this local file") would therefore write to the
# PRODUCTION remote DB instead. If the operator points at a local file they
# must also say FORCE_LOCAL_DB=1 — otherwise refuse to run.
if os.environ.get("DATABASE_PATH") and os.environ.get("FORCE_LOCAL_DB", "").strip().lower() not in ("1", "true", "yes"):
    print("REFUSING to run: DATABASE_PATH is set but FORCE_LOCAL_DB is not.")
    print("With Turso credentials present, DATABASE_PATH alone is IGNORED and this")
    print("script would write to the remote/production DB. For a local file run:")
    print("  FORCE_LOCAL_DB=1 DATABASE_PATH=/path/to/file.db python3 backfill_recommendations.py")
    print("For the remote DB intentionally, unset DATABASE_PATH and run with FORCE_LOCAL_DB unset.")
    sys.exit(2)

from database import DATABASE_PATH, init_db  # noqa: E402
from utils.recommendation_engine import autofill_recommendations  # noqa: E402


def main():
    dry_run = "--dry-run" in sys.argv
    init_db()
    import sqlite3
    conn = sqlite3.connect(DATABASE_PATH)
    try:
        rows = conn.execute(
            """SELECT p.id FROM products p
               WHERE p.status = 'available'
                 AND NOT EXISTS (
                     SELECT 1 FROM product_recommendations pr
                     WHERE pr.product_id = p.id
                 )
               ORDER BY p.id"""
        ).fetchall()
        product_ids = [r[0] for r in rows]
        print(f"Products with no recommendations: {len(product_ids)}")
        if dry_run:
            print("dry-run: nothing written")
            return

        done = 0
        for pid in product_ids:
            filled = autofill_recommendations(conn, pid)
            done += 1
            if done % 50 == 0 or done == len(product_ids):
                print(f"  processed {done}/{len(product_ids)}")
        conn.commit()
        print(f"Backfill complete: {done} products processed")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
