from flask import Blueprint, request, jsonify
from database import get_db
from auth.role_guard import require_super_admin, require_admin
from utils.response_utils import success_response, error_response
import sqlite3

admin_db_bp = Blueprint('admin_db', __name__)

@admin_db_bp.route('/api/admin/complaints', methods=['GET'])
@require_admin()
def get_all_complaints():
    conn = get_db()
    try:
        query = """
            SELECT c.*, u.name as user_name, u.email as user_email, o.total_amount, o.order_status
            FROM complaints c
            JOIN users u ON c.user_id = u.id
            JOIN orders o ON c.order_id = o.id
            ORDER BY c.created_at DESC
        """
        rows = conn.execute(query).fetchall()
        return success_response([dict(row) for row in rows])
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/complaints/<int:complaint_id>', methods=['PATCH'])
@require_admin()
def update_complaint(complaint_id):
    data = request.get_json(silent=True) or {}
    status = data.get('status')
    admin_reply = data.get('admin_reply')

    allowed_statuses = ["Pending", "In Progress", "Resolved", "Closed"]
    
    conn = get_db()
    try:
        # Check if complaint exists
        complaint = conn.execute("SELECT id FROM complaints WHERE id = ?", (complaint_id,)).fetchone()
        if not complaint:
            return error_response("Complaint not found", 404)

        updates = []
        params = []

        if status:
            if status not in allowed_statuses:
                return error_response(f"Invalid status. Allowed: {', '.join(allowed_statuses)}", 400)
            updates.append("status = ?")
            params.append(status)
        
        if admin_reply is not None:
            updates.append("admin_reply = ?")
            params.append(admin_reply)

        if not updates:
            return error_response("No fields to update", 400)

        params.append(complaint_id)
        query = f"UPDATE complaints SET {', '.join(updates)} WHERE id = ?"
        
        conn.execute(query, params)
        conn.commit()

        # Fetch updated record
        updated_row = conn.execute("SELECT * FROM complaints WHERE id = ?", (complaint_id,)).fetchone()
        return success_response(dict(updated_row), "Complaint updated successfully")

    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/support/tickets', methods=['GET'])
@require_admin()
def admin_get_all_tickets():
    conn = get_db()
    try:
        query = """
            SELECT t.*, u.name as customer_name, u.email as customer_email
            FROM support_tickets t
            JOIN users u ON t.user_id = u.id
            ORDER BY t.updated_at DESC
        """
        rows = conn.execute(query).fetchall()
        return success_response([dict(row) for row in rows])
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/support/tickets/<int:ticket_id>', methods=['GET'])
@require_admin()
def admin_get_ticket_details(ticket_id):
    conn = get_db()
    try:
        ticket = conn.execute("SELECT * FROM support_tickets WHERE id = ?", (ticket_id,)).fetchone()
        if not ticket:
            return error_response("Ticket not found", 404)
        
        messages = conn.execute(
            "SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC",
            (ticket_id,)
        ).fetchall()
        
        return success_response({
            "ticket": dict(ticket),
            "messages": [dict(m) for m in messages]
        })
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/support/tickets/<int:ticket_id>/reply', methods=['POST'])
@require_admin()
def admin_reply_to_ticket(ticket_id):
    data = request.get_json(silent=True) or {}
    message = data.get('message')
    status = data.get('status')

    if not message:
        return error_response("Message is required", 400)

    conn = get_db()
    try:
        # Check if ticket exists
        ticket = conn.execute("SELECT id FROM support_tickets WHERE id = ?", (ticket_id,)).fetchone()
        if not ticket:
            return error_response("Ticket not found", 404)

        cursor = conn.cursor()
        # Insert admin reply
        cursor.execute(
            "INSERT INTO ticket_messages (ticket_id, sender, message) VALUES (?, 'admin', ?)",
            (ticket_id, message)
        )

        # Build update query
        updates = ["updated_at = CURRENT_TIMESTAMP"]
        params = []

        if status:
            allowed_statuses = ["Open", "In Progress", "Resolved", "Closed"]
            if status not in allowed_statuses:
                return error_response(f"Invalid status. Allowed: {', '.join(allowed_statuses)}", 400)
            updates.append("status = ?")
            params.append(status)

        params.append(ticket_id)
        cursor.execute(f"UPDATE support_tickets SET {', '.join(updates)} WHERE id = ?", params)
        
        conn.commit()
        
        updated_ticket = conn.execute("SELECT * FROM support_tickets WHERE id = ?", (ticket_id,)).fetchone()
        return success_response(dict(updated_ticket), "Reply added and ticket updated", 201)
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/order-reports', methods=['GET'])
@require_admin()
def admin_get_all_reports():
    status_filter = request.args.get('status')
    conn = get_db()
    try:
        query = """
            SELECT r.*, u.name as customer_name, u.email as customer_email,
                   o.total_amount, o.created_at as order_date, o.order_number
            FROM order_reports r
            JOIN users u ON r.user_id = u.id
            JOIN orders o ON r.order_id = o.id
        """
        params = []
        if status_filter:
            query += " WHERE r.status = ?"
            params.append(status_filter)
        
        query += " ORDER BY r.created_at DESC"
        
        rows = conn.execute(query, params).fetchall()
        return success_response([dict(row) for row in rows])
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/order-reports/<int:report_id>', methods=['PATCH'])
@require_admin()
def admin_update_report(report_id):
    data = request.get_json(silent=True) or {}
    status = data.get('status')
    resolution = data.get('resolution')
    admin_notes = data.get('admin_notes')

    allowed_statuses = ['Submitted', 'Under Review', 'Resolved', 'Rejected']
    
    conn = get_db()
    try:
        # Check if report exists
        report = conn.execute("SELECT id FROM order_reports WHERE id = ?", (report_id,)).fetchone()
        if not report:
            return error_response("Report not found", 404)

        updates = ["updated_at = CURRENT_TIMESTAMP"]
        params = []

        if status:
            if status not in allowed_statuses:
                return error_response(f"Invalid status. Allowed: {', '.join(allowed_statuses)}", 400)
            updates.append("status = ?")
            params.append(status)
        
        if resolution is not None:
            updates.append("resolution = ?")
            params.append(resolution)
            
        if admin_notes is not None:
            updates.append("admin_notes = ?")
            params.append(admin_notes)

        params.append(report_id)
        query = f"UPDATE order_reports SET {', '.join(updates)} WHERE id = ?"
        
        conn.execute(query, params)
        conn.commit()

        # Fetch updated record
        updated_row = conn.execute("SELECT * FROM order_reports WHERE id = ?", (report_id,)).fetchone()
        return success_response(dict(updated_row), "Report updated successfully")

    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/refund-requests', methods=['GET'])
@require_admin()
def admin_get_all_refunds():
    status_filter = request.args.get('status')
    conn = get_db()
    try:
        query = """
            SELECT r.*, u.name as customer_name, u.email as customer_email,
                   o.total_amount as order_amount, o.order_number
            FROM refund_requests r
            JOIN users u ON r.user_id = u.id
            JOIN orders o ON r.order_id = o.id
        """
        params = []
        if status_filter:
            query += " WHERE r.status = ?"
            params.append(status_filter)
        
        query += " ORDER BY r.created_at DESC"
        
        rows = conn.execute(query, params).fetchall()
        return success_response([dict(row) for row in rows])
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/refund-requests/<int:request_id>', methods=['PATCH'])
@require_admin()
def admin_update_refund(request_id):
    data = request.get_json(silent=True) or {}
    status = data.get('status')
    refund_amount = data.get('refund_amount')
    admin_notes = data.get('admin_notes')
    resolution = data.get('resolution')

    allowed_statuses = ['Pending', 'Approved', 'Rejected', 'Processing', 'Completed']
    
    conn = get_db()
    try:
        # Check if request exists
        refund = conn.execute("SELECT id FROM refund_requests WHERE id = ?", (request_id,)).fetchone()
        if not refund:
            return error_response("Refund request not found", 404)

        updates = ["updated_at = CURRENT_TIMESTAMP"]
        params = []

        if status:
            if status not in allowed_statuses:
                return error_response(f"Invalid status. Allowed: {', '.join(allowed_statuses)}", 400)
            updates.append("status = ?")
            params.append(status)
        
        if refund_amount is not None:
            try:
                amt = float(refund_amount)
                if amt < 0: raise ValueError()
                updates.append("refund_amount = ?")
                params.append(amt)
            except ValueError:
                return error_response("Invalid refund amount", 400)
            
        if admin_notes is not None:
            updates.append("admin_notes = ?")
            params.append(admin_notes)
            
        if resolution is not None:
            updates.append("resolution = ?")
            params.append(resolution)

        params.append(request_id)
        query = f"UPDATE refund_requests SET {', '.join(updates)} WHERE id = ?"
        
        conn.execute(query, params)
        conn.commit()

        updated_row = conn.execute("SELECT * FROM refund_requests WHERE id = ?", (request_id,)).fetchone()
        return success_response(dict(updated_row), "Refund request updated successfully")

    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/refund-requests/summary', methods=['GET'])
@require_admin()
def admin_get_refund_summary():
    conn = get_db()
    try:
        stats = {
            "total_pending": conn.execute("SELECT COUNT(*) FROM refund_requests WHERE status = 'Pending'").fetchone()[0],
            "total_approved": conn.execute("SELECT COUNT(*) FROM refund_requests WHERE status = 'Approved'").fetchone()[0],
            "total_amount_approved": conn.execute("SELECT SUM(refund_amount) FROM refund_requests WHERE status = 'Approved'").fetchone()[0] or 0,
            "total_completed": conn.execute("SELECT COUNT(*) FROM refund_requests WHERE status = 'Completed'").fetchone()[0]
        }
        return success_response(stats)
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/db/tables', methods=['GET'])
@require_super_admin()
def list_tables():
    conn = get_db()
    cursor = conn.cursor()
    try:
        # SQLite specific query to list tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
        tables = [row['name'] for row in cursor.fetchall()]
        return success_response(tables)
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/db/table/<table_name>', methods=['GET'])
@require_super_admin()
def get_table_data(table_name):
    # Basic validation to prevent SQL injection on table name
    if not table_name.isidentifier():
        return error_response("Invalid table name")

    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 50))
    offset = (page - 1) * per_page

    conn = get_db()
    cursor = conn.cursor()
    try:
        # Get schema
        cursor.execute(f"PRAGMA table_info({table_name})")
        schema = [dict(row) for row in cursor.fetchall()]

        # Get total count
        cursor.execute(f"SELECT COUNT(*) as count FROM {table_name}")
        total_count = cursor.fetchone()['count']

        # Get data
        cursor.execute(f"SELECT * FROM {table_name} LIMIT ? OFFSET ?", (per_page, offset))
        rows = [dict(row) for row in cursor.fetchall()]

        return success_response({
            "schema": schema,
            "data": rows,
            "pagination": {
                "total": total_count,
                "page": page,
                "per_page": per_page,
                "total_pages": (total_count + per_page - 1) // per_page
            }
        })
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/db/table/<table_name>', methods=['POST'])
@require_super_admin()
def insert_row(table_name):
    if not table_name.isidentifier():
        return error_response("Invalid table name")
    
    data = request.json
    if not data:
        return error_response("No data provided")

    columns = ", ".join(data.keys())
    placeholders = ", ".join(["?" for _ in data])
    values = list(data.values())

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(f"INSERT INTO {table_name} ({columns}) VALUES ({placeholders})", values)
        conn.commit()
        return success_response(None, "Row inserted successfully")
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/db/table/<table_name>/<row_id>', methods=['PUT'])
@require_super_admin()
def update_row(table_name, row_id):
    if not table_name.isidentifier():
        return error_response("Invalid table name")
    
    data = request.json
    if not data:
        return error_response("No data provided")

    # Assuming 'id' is the primary key. In a real advanced tool, we should fetch PK from schema.
    # But for this project, most tables have 'id'.
    
    set_clause = ", ".join([f"{k} = ?" for k in data.keys()])
    values = list(data.values())
    values.append(row_id)

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(f"UPDATE {table_name} SET {set_clause} WHERE id = ?", values)
        conn.commit()
        return success_response(None, "Row updated successfully")
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/db/table/<table_name>/<row_id>', methods=['DELETE'])
@require_super_admin()
def delete_row(table_name, row_id):
    if not table_name.isidentifier():
        return error_response("Invalid table name")

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(f"DELETE FROM {table_name} WHERE id = ?", (row_id,))
        conn.commit()
        return success_response(None, "Row deleted successfully")
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/db/query', methods=['POST'])
@require_super_admin()
def execute_query():
    data = request.json
    query = data.get('query')
    if not query:
        return error_response("No query provided")

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute(query)
        if query.strip().upper().startswith("SELECT"):
            rows = [dict(row) for row in cursor.fetchall()]
            return success_response(rows)
        else:
            conn.commit()
            return success_response(None, "Query executed successfully")
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/bug-reports', methods=['GET'])
@require_admin()
def admin_get_bug_reports():
    """Retrieves all bug reports with reporter info and filters."""
    status_filter = request.args.get('status')
    severity_filter = request.args.get('severity')
    
    conn = get_db()
    try:
        query = """
            SELECT b.*, u.name as reporter_name, u.email as reporter_email
            FROM bug_reports b
            JOIN users u ON b.user_id = u.id
        """
        filters = []
        params = []
        
        if status_filter:
            filters.append("b.status = ?")
            params.append(status_filter)
            
        if severity_filter:
            filters.append("b.severity = ?")
            params.append(severity_filter)
            
        if filters:
            query += " WHERE " + " AND ".join(filters)
            
        query += """
            ORDER BY 
                CASE b.severity
                    WHEN 'Critical' THEN 1
                    WHEN 'High' THEN 2
                    WHEN 'Medium' THEN 3
                    WHEN 'Low' THEN 4
                    ELSE 5
                END,
                b.created_at DESC
        """
        
        rows = conn.execute(query, params).fetchall()
        return success_response([dict(row) for row in rows])
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/bug-reports/<int:report_id>', methods=['PATCH'])
@require_admin()
def admin_update_bug_report(report_id):
    """Updates status and developer notes for a bug report."""
    data = request.get_json(silent=True) or {}
    status = data.get('status')
    developer_notes = data.get('developer_notes')
    
    valid_statuses = {'New', 'Investigating', 'Fixed', 'Closed', 'Duplicate'}
    
    if status and status not in valid_statuses:
        return error_response(f"Invalid status. Allowed: {', '.join(valid_statuses)}", 400)
        
    conn = get_db()
    try:
        # Check if report exists
        report = conn.execute("SELECT id FROM bug_reports WHERE id = ?", (report_id,)).fetchone()
        if not report:
            return error_response("Bug report not found", 404)
            
        update_fields = []
        params = []
        
        if status:
            update_fields.append("status = ?")
            params.append(status)
            
        if developer_notes is not None:
            update_fields.append("developer_notes = ?")
            params.append(developer_notes)
            
        update_fields.append("updated_at = CURRENT_TIMESTAMP")
        
        if not update_fields:
            return error_response("No fields to update", 400)
            
        query = f"UPDATE bug_reports SET {', '.join(update_fields)} WHERE id = ?"
        params.append(report_id)
        
        conn.execute(query, params)
        conn.commit()
        
        # Fetch updated record
        updated = conn.execute("SELECT * FROM bug_reports WHERE id = ?", (report_id,)).fetchone()
        return success_response(dict(updated), "Bug report updated successfully")
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

# --- Analytics Dashboard Routes ---

@admin_db_bp.route('/api/admin/analytics/realtime', methods=['GET'])
@require_admin()
def get_realtime_analytics():
    conn = get_db()
    try:
        # Get count of sessions where last_seen_at > now - 5 minutes
        active_users = conn.execute(
            "SELECT COUNT(*) FROM analytics_sessions WHERE last_seen_at >= datetime('now', '-5 minutes')"
        ).fetchone()[0]

        # Get list of active pages
        active_pages = conn.execute("""
            SELECT page_path, COUNT(*) as count
            FROM page_views
            WHERE created_at >= datetime('now', '-5 minutes')
            GROUP BY page_path ORDER BY count DESC LIMIT 5
        """).fetchall()

        return success_response({
            "active_users": active_users,
            "active_pages": [dict(row) for row in active_pages]
        })
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/analytics/traffic', methods=['GET'])
@require_admin()
def get_traffic_analytics():
    period = request.args.get('period', 'today')
    conn = get_db()
    try:
        if period == 'today':
            query = """
                SELECT strftime('%H', created_at) as label,
                       COUNT(*) as visits,
                       COUNT(DISTINCT session_id) as unique_visits
                FROM page_views
                WHERE created_at >= datetime('now', '-24 hours')
                GROUP BY label ORDER BY label
            """
        elif period == 'week':
            query = """
                SELECT date(created_at) as label,
                       COUNT(*) as visits,
                       COUNT(DISTINCT session_id) as unique_visits
                FROM page_views
                WHERE created_at >= datetime('now', '-7 days')
                GROUP BY label ORDER BY label
            """
        else: # month
            query = """
                SELECT date(created_at) as label,
                       COUNT(*) as visits,
                       COUNT(DISTINCT session_id) as unique_visits
                FROM page_views
                WHERE created_at >= datetime('now', '-30 days')
                GROUP BY label ORDER BY label
            """

        rows = conn.execute(query).fetchall()
        data = {
            "labels": [row['label'] for row in rows],
            "visits": [row['visits'] for row in rows],
            "unique_visits": [row['unique_visits'] for row in rows]
        }
        return success_response(data)
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/analytics/top-pages', methods=['GET'])
@require_admin()
def get_top_pages():
    conn = get_db()
    try:
        query = """
            SELECT page_path, page_title,
                   COUNT(*) as views,
                   COUNT(DISTINCT session_id) as unique_views,
                   AVG(duration_seconds) as avg_duration
            FROM page_views
            WHERE created_at >= datetime('now', '-30 days')
            GROUP BY page_path
            ORDER BY views DESC LIMIT 10
        """
        rows = conn.execute(query).fetchall()
        return success_response([dict(row) for row in rows])
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/analytics/traffic-sources', methods=['GET'])
@require_admin()
def get_traffic_sources():
    conn = get_db()
    try:
        query = """
            SELECT
                CASE
                  WHEN utm_source IS NOT NULL AND utm_source != '' THEN utm_source
                  WHEN referrer LIKE '%google%' THEN 'Google'
                  WHEN referrer LIKE '%facebook%' THEN 'Facebook'
                  WHEN referrer LIKE '%instagram%' THEN 'Instagram'
                  WHEN referrer IS NULL OR referrer = '' THEN 'Direct'
                  ELSE 'Other'
                END as source,
                COUNT(*) as visits
            FROM page_views
            WHERE created_at >= datetime('now', '-30 days')
            GROUP BY source ORDER BY visits DESC
        """
        rows = conn.execute(query).fetchall()
        return success_response([dict(row) for row in rows])
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/analytics/devices', methods=['GET'])
@require_admin()
def get_device_analytics():
    conn = get_db()
    try:
        details = conn.execute("""
            SELECT device_type, browser, os, COUNT(*) as count
            FROM page_views
            WHERE created_at >= datetime('now', '-30 days')
            GROUP BY device_type, browser, os
            ORDER BY count DESC
        """).fetchall()

        summary = conn.execute("""
            SELECT 
                SUM(CASE WHEN device_type = 'mobile' THEN 1 ELSE 0 END) as mobile,
                SUM(CASE WHEN device_type = 'desktop' THEN 1 ELSE 0 END) as desktop,
                SUM(CASE WHEN device_type = 'tablet' THEN 1 ELSE 0 END) as tablet
            FROM page_views
            WHERE created_at >= datetime('now', '-30 days')
        """).fetchone()

        return success_response({
            "summary": dict(summary) if summary else {"mobile": 0, "desktop": 0, "tablet": 0},
            "details": [dict(row) for row in details]
        })
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/analytics/searches', methods=['GET'])
@require_admin()
def get_search_analytics():
    conn = get_db()
    try:
        query = """
            SELECT query, COUNT(*) as count,
                   AVG(results_count) as avg_results
            FROM search_queries
            WHERE created_at >= datetime('now', '-30 days')
            GROUP BY query ORDER BY count DESC LIMIT 20
        """
        rows = conn.execute(query).fetchall()
        return success_response([dict(row) for row in rows])
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/analytics/funnel', methods=['GET'])
@require_admin()
def get_funnel_analytics():
    conn = get_db()
    try:
        # Step 1 - Total sessions
        total_sessions = conn.execute(
            "SELECT COUNT(DISTINCT session_id) FROM analytics_sessions WHERE started_at >= datetime('now', '-30 days')"
        ).fetchone()[0] or 0

        # Step 2 - Product views
        product_views = conn.execute("""
            SELECT COUNT(DISTINCT session_id) FROM page_views
            WHERE page_path LIKE '/product/%'
            AND created_at >= datetime('now', '-30 days')
        """).fetchone()[0] or 0

        # Step 3 - Add to cart
        add_to_cart = conn.execute("""
            SELECT COUNT(DISTINCT session_id) FROM analytics_events
            WHERE event_type = 'add_to_cart'
            AND created_at >= datetime('now', '-30 days')
        """).fetchone()[0] or 0

        # Step 4 - Purchase
        purchase = conn.execute("""
            SELECT COUNT(DISTINCT session_id) FROM analytics_events
            WHERE event_type = 'purchase'
            AND created_at >= datetime('now', '-30 days')
        """).fetchone()[0] or 0

        steps = [
            {"name": "Total Sessions", "count": total_sessions, "percentage": 100},
            {"name": "Product Views", "count": product_views, "percentage": round((product_views / total_sessions * 100), 2) if total_sessions > 0 else 0},
            {"name": "Add to Cart", "count": add_to_cart, "percentage": round((add_to_cart / total_sessions * 100), 2) if total_sessions > 0 else 0},
            {"name": "Purchase", "count": purchase, "percentage": round((purchase / total_sessions * 100), 2) if total_sessions > 0 else 0}
        ]

        return success_response({"steps": steps})
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/analytics/user-journeys', methods=['GET'])
@require_admin()
def get_user_journeys():
    conn = get_db()
    try:
        query = """
            SELECT pv1.page_path as from_page,
                   pv2.page_path as to_page,
                   COUNT(*) as count
            FROM page_views pv1
            JOIN page_views pv2 ON pv1.session_id = pv2.session_id
              AND pv2.created_at > pv1.created_at
            WHERE pv1.created_at >= datetime('now', '-30 days')
            GROUP BY from_page, to_page
            ORDER BY count DESC LIMIT 10
        """
        rows = conn.execute(query).fetchall()
        return success_response([dict(row) for row in rows])
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()

@admin_db_bp.route('/api/admin/analytics/summary', methods=['GET'])
@require_admin()
def get_analytics_summary():
    conn = get_db()
    try:
        total_visits_today = conn.execute(
            "SELECT COUNT(*) FROM page_views WHERE created_at >= date('now')"
        ).fetchone()[0] or 0

        total_visits_week = conn.execute(
            "SELECT COUNT(*) FROM page_views WHERE created_at >= datetime('now', '-7 days')"
        ).fetchone()[0] or 0

        unique_visitors_today = conn.execute(
            "SELECT COUNT(DISTINCT session_id) FROM page_views WHERE created_at >= date('now')"
        ).fetchone()[0] or 0

        total_sessions = conn.execute("SELECT COUNT(*) FROM analytics_sessions").fetchone()[0] or 0
        bounced_sessions = conn.execute("SELECT COUNT(*) FROM analytics_sessions WHERE is_bounce = 1").fetchone()[0] or 0
        bounce_rate = round((bounced_sessions / total_sessions * 100), 2) if total_sessions > 0 else 0

        avg_session_duration = conn.execute("""
            SELECT AVG(session_duration) FROM (
                SELECT session_id, SUM(duration_seconds) as session_duration
                FROM page_views
                GROUP BY session_id
            )
        """).fetchone()[0] or 0

        top_product_search = conn.execute("""
            SELECT query FROM search_queries
            WHERE created_at >= date('now')
            GROUP BY query ORDER BY COUNT(*) DESC LIMIT 1
        """).fetchone()

        summary = {
            "total_visits_today": total_visits_today,
            "total_visits_week": total_visits_week,
            "unique_visitors_today": unique_visitors_today,
            "bounce_rate": bounce_rate,
            "avg_session_duration": round(avg_session_duration, 2),
            "top_product_search": top_product_search[0] if top_product_search else None
        }

        return success_response(summary)
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()
