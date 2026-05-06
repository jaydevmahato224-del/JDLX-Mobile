import sqlite3

from security.login_guard import get_failed_attempt_count, LOCKOUT_MINUTES
from security.rate_limiter import force_block_ip


DATABASE_PATH = "jdlx.db"


def create_security_alert(alert_type, message, severity="medium", admin_id=None, ip_address=None):
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    cursor.execute(
        '''
        INSERT INTO security_alerts (alert_type, message, severity, admin_id, ip_address)
        VALUES (?, ?, ?, ?, ?)
        ''',
        (alert_type, message, severity, admin_id, ip_address),
    )
    conn.commit()
    conn.close()


def detect_failed_login_anomaly(email, ip_address):
    failed_count = get_failed_attempt_count(email)
    if failed_count > 5:
        create_security_alert(
            "multiple_failed_logins",
            f"Email {email} exceeded 5 failed login attempts in {LOCKOUT_MINUTES} minutes.",
            severity="high",
            ip_address=ip_address,
        )
        if ip_address:
            force_block_ip(ip_address, duration_minutes=30)


def detect_admin_activity_anomaly(admin_id, action_type, ip_address=None):
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute(
        '''
        SELECT COUNT(*) as count
        FROM admin_audit_logs
        WHERE admin_id = ?
          AND timestamp >= datetime('now', '-5 minutes')
        ''',
        (admin_id,),
    )
    recent_actions = cursor.fetchone()["count"]
    if recent_actions >= 30:
        create_security_alert(
            "suspicious_admin_activity",
            f"Admin #{admin_id} performed {recent_actions} actions in 5 minutes.",
            severity="high",
            admin_id=admin_id,
            ip_address=ip_address,
        )
        if ip_address:
            force_block_ip(ip_address, duration_minutes=15)

    if action_type == "admin_cancelled_order":
        cursor.execute(
            '''
            SELECT COUNT(*) as count
            FROM admin_audit_logs
            WHERE admin_id = ?
              AND action_type = 'admin_cancelled_order'
              AND timestamp >= datetime('now', '-30 minutes')
            ''',
            (admin_id,),
        )
        cancel_count = cursor.fetchone()["count"]
        if cancel_count >= 5:
            create_security_alert(
                "unusual_order_cancellations",
                f"Admin #{admin_id} cancelled {cancel_count} orders in 30 minutes.",
                severity="high",
                admin_id=admin_id,
                ip_address=ip_address,
            )

    if action_type == "admin_changed_inventory":
        cursor.execute(
            '''
            SELECT COUNT(*) as count
            FROM admin_audit_logs
            WHERE admin_id = ?
              AND action_type = 'admin_changed_inventory'
              AND timestamp >= datetime('now', '-15 minutes')
            ''',
            (admin_id,),
        )
        inventory_changes = cursor.fetchone()["count"]
        if inventory_changes >= 20:
            create_security_alert(
                "inventory_abuse",
                f"Admin #{admin_id} changed inventory {inventory_changes} times in 15 minutes.",
                severity="medium",
                admin_id=admin_id,
                ip_address=ip_address,
            )

    if action_type == "admin_login" and ip_address:
        cursor.execute(
            '''
            SELECT COUNT(DISTINCT admin_id) as count
            FROM admin_audit_logs
            WHERE action_type = 'admin_login'
              AND ip_address = ?
              AND timestamp >= datetime('now', '-30 minutes')
            ''',
            (ip_address,),
        )
        distinct_admin_logins = cursor.fetchone()["count"]
        if distinct_admin_logins >= 3:
            create_security_alert(
                "multiple_admin_logins",
                f"Multiple admin logins detected from IP {ip_address}.",
                severity="high",
                admin_id=admin_id,
                ip_address=ip_address,
            )
            force_block_ip(ip_address, duration_minutes=60)

    conn.close()


def get_security_overview(blocked_ips, failed_login_limit=20, alert_limit=50):
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute(
        '''
        SELECT id, alert_type, message, severity, admin_id, ip_address, created_at
        FROM security_alerts
        ORDER BY created_at DESC
        LIMIT ?
        ''',
        (alert_limit,),
    )
    alerts = [dict(row) for row in cursor.fetchall()]

    cursor.execute(
        '''
        SELECT id, email, ip_address, status, timestamp
        FROM login_attempts
        WHERE status = 'failed'
        ORDER BY timestamp DESC
        LIMIT ?
        ''',
        (failed_login_limit,),
    )
    failed_logins = [dict(row) for row in cursor.fetchall()]

    conn.close()
    return {
        "blocked_ips": blocked_ips,
        "suspicious_activity": alerts,
        "failed_login_attempts": failed_logins,
    }
