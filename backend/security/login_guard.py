from database import get_db


FAILED_LOGIN_LIMIT = 5
LOCKOUT_MINUTES = 10


def record_login_attempt(email, ip_address, status):
    normalized_email = (email or "unknown").strip().lower()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        '''
        INSERT INTO login_attempts (email, ip_address, status)
        VALUES (?, ?, ?)
        ''',
        (normalized_email, ip_address, status),
    )
    conn.commit()
    conn.close()


def get_failed_attempt_count(email):
    normalized_email = (email or "unknown").strip().lower()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        '''
        SELECT COUNT(*) as count
        FROM login_attempts
        WHERE email = ?
          AND status = 'failed'
          AND timestamp >= datetime('now', ?)
        ''',
        (normalized_email, f"-{LOCKOUT_MINUTES} minutes"),
    )
    row = cursor.fetchone()
    count = row["count"] if row else 0
    conn.close()
    return count


def is_account_locked(email):
    failed_count = get_failed_attempt_count(email)
    return failed_count > FAILED_LOGIN_LIMIT


def get_recent_failed_logins(limit=50):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        '''
        SELECT id, email, ip_address, status, timestamp
        FROM login_attempts
        WHERE status = 'failed'
        ORDER BY timestamp DESC
        LIMIT ?
        ''',
        (limit,),
    )
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows
