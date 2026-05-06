import sqlite3

from utils.logger import logger


DATABASE_PATH = "jdlx.db"


def log_admin_action(admin_id, action, entity_type, entity_id=None):
    if not admin_id or not action or not entity_type:
        return

    try:
        conn = sqlite3.connect(DATABASE_PATH)
        cursor = conn.cursor()
        cursor.execute(
            '''
            INSERT INTO activity_logs (admin_id, action, entity_type, entity_id)
            VALUES (?, ?, ?, ?)
            ''',
            (admin_id, action, entity_type, entity_id),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to log admin activity: {str(e)}")
