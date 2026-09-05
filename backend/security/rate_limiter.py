import time
from datetime import datetime, timezone

from database import get_db

MAX_REQUESTS_PER_MINUTE = 100
BLOCK_DURATION_MINUTES = 10


def _init_rate_limit_table():
    """Create rate_limits table if not exists."""
    conn = get_db()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS rate_limits (
                ip TEXT PRIMARY KEY,
                window_start INTEGER NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                blocked_until INTEGER
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_rate_limits_blocked_until
            ON rate_limits(blocked_until)
        """)
        conn.commit()
    finally:
        conn.close()


_init_rate_limit_table()


def _utc_now_ts():
    return int(time.time())


def _cleanup_expired_blocks():
    conn = get_db()
    try:
        now = _utc_now_ts()
        conn.execute("DELETE FROM rate_limits WHERE blocked_until IS NOT NULL AND blocked_until <= ?", (now,))
        conn.commit()
    finally:
        conn.close()


def check_and_record_request(ip_address):
    """
    Returns (allowed: bool, retry_after_seconds: int).
    Uses sliding window per IP stored in SQLite.
    """
    _cleanup_expired_blocks()

    conn = get_db()
    try:
        now = _utc_now_ts()
        window_start = now - 60  # 1 minute window

        row = conn.execute(
            "SELECT window_start, count, blocked_until FROM rate_limits WHERE ip = ?",
            (ip_address,)
        ).fetchone()

        if row:
            blocked_until = row["blocked_until"]
            if blocked_until and blocked_until > now:
                return False, blocked_until - now

            # Reset window if expired
            if row["window_start"] < window_start:
                conn.execute(
                    "UPDATE rate_limits SET window_start = ?, count = 1 WHERE ip = ?",
                    (now, ip_address)
                )
                conn.commit()
                return True, 0

            # Increment count
            new_count = row["count"] + 1
            if new_count > MAX_REQUESTS_PER_MINUTE:
                blocked_until = now + (BLOCK_DURATION_MINUTES * 60)
                conn.execute(
                    "UPDATE rate_limits SET count = ?, blocked_until = ? WHERE ip = ?",
                    (new_count, blocked_until, ip_address)
                )
                conn.commit()
                return False, BLOCK_DURATION_MINUTES * 60

            conn.execute(
                "UPDATE rate_limits SET count = ? WHERE ip = ?",
                (new_count, ip_address)
            )
            conn.commit()
            return True, 0

        # First request from this IP
        conn.execute(
            "INSERT INTO rate_limits (ip, window_start, count) VALUES (?, ?, 1)",
            (ip_address, now)
        )
        conn.commit()
        return True, 0
    finally:
        conn.close()


def force_block_ip(ip_address, duration_minutes=30):
    conn = get_db()
    try:
        now = _utc_now_ts()
        blocked_until = now + (duration_minutes * 60)
        conn.execute(
            """INSERT INTO rate_limits (ip, window_start, count, blocked_until)
               VALUES (?, ?, 0, ?)
               ON CONFLICT(ip) DO UPDATE SET blocked_until = ?""",
            (ip_address, now, blocked_until, blocked_until)
        )
        conn.commit()
    finally:
        conn.close()


def get_blocked_ips():
    conn = get_db()
    try:
        now = _utc_now_ts()
        _cleanup_expired_blocks()
        rows = conn.execute(
            "SELECT ip, blocked_until FROM rate_limits WHERE blocked_until IS NOT NULL AND blocked_until > ?",
            (now,)
        ).fetchall()
        return [{
            "ip_address": row["ip"],
            "blocked_until": datetime.fromtimestamp(row["blocked_until"], tz=timezone.utc).isoformat(),
            "retry_after_seconds": row["blocked_until"] - now,
        } for row in rows]
    finally:
        conn.close()