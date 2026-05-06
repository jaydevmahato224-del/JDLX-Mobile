import sqlite3


DATABASE_PATH = "jdlx.db"
FAILED_LOGIN_LIMIT = 5
LOCKOUT_MINUTES = 10


def record_login_attempt(email, ip_address, status):
    normalized_email = (email or "unknown").strip().lower()
    conn = sqlite3.connect(DATABASE_PATH)
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
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
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
    count = cursor.fetchone()["count"]
    conn.close()
    return count


def is_account_locked(email):
    failed_count = get_failed_attempt_count(email)
    return failed_count > FAILED_LOGIN_LIMIT


def get_recent_failed_logins(limit=50):
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
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
