"""READ-ONLY diagnostic: are OTP requests reaching the (Turso) database at all?

Only SELECTs run — nothing is inserted/updated/deleted. Run from backend/ so
.env Turso credentials load like the app does:

    python3 scratch/diag_otp_delivery.py

This shows the most recent customer_email_otps / google_link_otps rows. If the
user just requested an OTP and NO row exists, the request never reached the DB
(server down, route missing, auth error before insert). If rows exist but are
old / never updated, that tells us the send path ran (or not) server-side.
"""
import os
import sys
import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import database  # noqa: E402  (loads .env, decides Turso vs local)


def q(conn, sql, params=()):
    cur = conn.execute(sql, params)
    cols = [c[0] for c in cur.description] if cur.description else []
    rows = [dict(zip(cols, row)) if cols else row for row in cur.fetchall()]
    return rows


def main():
    print("DB mode:", "TURSO (remote)" if database.USE_TURSO else "LOCAL SQLite",
          "| url:", database.TURSO_URL or database.DATABASE_PATH)
    if not database.USE_TURSO:
        print("NOTE: no Turso creds found — showing LOCAL db rows only.")

    conn = database._open_connection()

    print("\n== customer_email_otps (last 15) ==")
    try:
        rows = q(conn, """
            SELECT id, email, substr(otp_hash,1,8) AS hash8, resend_count,
                   attempts, created_at, last_sent_at, expires_at
            FROM customer_email_otps
            ORDER BY id DESC LIMIT 15
        """)
        if not rows:
            print("  (no rows)")
        for r in rows:
            print("  ", r)
    except Exception as e:
        print("  ERROR:", e)

    print("\n== google_link_otps (last 15) ==")
    try:
        rows = q(conn, """
            SELECT id, email, substr(otp_hash,1,8) AS hash8, resend_count,
                   attempts, created_at, last_sent_at, expires_at
            FROM google_link_otps
            ORDER BY id DESC LIMIT 15
        """)
        if not rows:
            print("  (no rows)")
        for r in rows:
            print("  ", r)
    except Exception as e:
        print("  ERROR:", e)

    print("\n== email send time window (last 24h) ==")
    try:
        rows = q(conn, """
            SELECT 'customer' AS tbl, COUNT(*) AS n, MAX(last_sent_at) AS newest
            FROM customer_email_otps
            WHERE last_sent_at >= datetime('now', '-1 day')
            UNION ALL
            SELECT 'google_link' AS tbl, COUNT(*) AS n, MAX(last_sent_at) AS newest
            FROM google_link_otps
            WHERE last_sent_at >= datetime('now', '-1 day')
        """)
        for r in rows:
            print("  ", r)
    except Exception as e:
        print("  ERROR:", e)

    conn.close()
    print("\nDone (read-only).")


if __name__ == "__main__":
    main()
