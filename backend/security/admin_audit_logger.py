import sqlite3

from flask import request

from utils.logger import logger


DATABASE_PATH = "jdlx.db"


def log_admin_event(admin_id, action_type, entity, entity_id=None, description=""):
    if not admin_id or not action_type or not entity:
        return

    ip_address = None
    try:
        ip_address = request.headers.get("X-Forwarded-For", request.remote_addr)
    except Exception:
        ip_address = None

    try:
        conn = sqlite3.connect(DATABASE_PATH)
        cursor = conn.cursor()
        cursor.execute(
            '''
            INSERT INTO admin_audit_logs
            (admin_id, action_type, target_entity, target_id, description, ip_address)
            VALUES (?, ?, ?, ?, ?, ?)
            ''',
            (admin_id, action_type, entity, entity_id, description, ip_address),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to write admin audit log: {str(e)}")
