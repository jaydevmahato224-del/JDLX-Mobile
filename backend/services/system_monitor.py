import os
from database import get_db


def get_system_stats():
    conn = get_db()
    cursor = conn.cursor()

    # Single aggregated read for lightweight dashboard polling.
    cursor.execute(
        '''
        SELECT
            (SELECT COUNT(*) FROM users) AS total_users,
            (SELECT COUNT(*) FROM orders) AS total_orders,
            (
                SELECT COUNT(*)
                FROM delivery_partners
                WHERE status IN ('AVAILABLE', 'BUSY')
            ) AS active_delivery_partners,
            (
                SELECT COUNT(*)
                FROM products
                WHERE stock <= low_stock_threshold
            ) AS low_stock_products,
            (
                SELECT COALESCE(SUM(
                    CASE 
                        WHEN payment_type = 'PREPAID' THEN total_amount
                        ELSE cod_advance_paid
                    END
                ), 0)
                FROM orders
                WHERE DATE(created_at) = DATE('now')
                AND order_status NOT IN ('PLACED', 'CANCELLED', 'REJECTED')
            ) AS daily_revenue
        '''
    )
    row = cursor.fetchone()
    conn.close()

    return {
        "total_users": row["total_users"] or 0,
        "total_orders": row["total_orders"] or 0,
        "active_delivery_partners": row["active_delivery_partners"] or 0,
        "low_stock_products": row["low_stock_products"] or 0,
        "daily_revenue": row["daily_revenue"] or 0,
    }

