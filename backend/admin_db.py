from flask import Blueprint, request, jsonify
from database import get_db
from auth.role_guard import require_super_admin, require_admin
from utils.response_utils import success_response, error_response
from utils.activity_logger import log_admin_action
import re
import sqlite3

admin_db_bp = Blueprint('admin_db', __name__)


def _notify_admins(title, message, ntype='INFO', report_id=None, product_id=None):
    """Drop a row into the adminNotifications feed (admin panel bell/pulse).

    Own-connection insert + commit: never rides a request-scoped connection
    that could roll back on teardown (same class of bug fixed earlier in the
    complaint route).
    """
    try:
        conn = get_db()
        try:
            conn.execute(
                """INSERT INTO admin_notifications (title, message, type, report_id, product_id)
                   VALUES (?, ?, ?, ?, ?)""",
                (title, message, ntype, report_id, product_id),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass  # notification must never break the main flow


def _clear_storefront_cache():
    """Bust the storefront product-list cache so approval/reject decisions are
    visible immediately (get_products is @cache.cached 60s by query string)."""
    try:
        from flask import current_app
        import app as _app_module
        c = getattr(_app_module, 'cache', None)
        if c:
            with _app_module.app.app_context():
                c.clear()
    except Exception:
        pass  # cache bust is best-effort


def _admin_approval_counts():
    """Pending catalog approvals + unreviewed reports for the pulse badge."""
    conn = get_db()
    try:
        pending_products = conn.execute(
            "SELECT COUNT(*) FROM products WHERE approval_status = 'pending'"
        ).fetchone()[0]
        pending_reports = conn.execute(
            "SELECT COUNT(*) FROM order_reports WHERE status IN ('Submitted', 'Under Review')"
        ).fetchone()[0]
        return pending_products, pending_reports
    finally:
        conn.close()

_SQL_IDENTIFIER_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')


def _validate_column_names(data):
    """Column keys are interpolated into SQL — enforce strict identifier format."""
    for key in data.keys():
        if not isinstance(key, str) or not _SQL_IDENTIFIER_RE.match(key):
            return False
    return True


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

    # Statuses owned by the warehouse returns pipeline (warehouse_returns.py).
    # The warehouse is the DECISION authority; admin support can still reply,
    # but must not yank a live return/exchange/refund back to a generic label.
    PIPELINE_STATUSES = {"Approved", "Pickup Scheduled", "Picked Up",
                         "In Review", "Exchange Pending", "Refund Requested"}

    conn = get_db()
    try:
        # Check if complaint exists
        complaint = conn.execute("SELECT id, status, handled_by_warehouse FROM complaints WHERE id = ?", (complaint_id,)).fetchone()
        if not complaint:
            return error_response("Complaint not found", 404)

        updates = []
        params = []

        if status:
            if status not in allowed_statuses:
                return error_response(f"Invalid status. Allowed: {', '.join(allowed_statuses)}", 400)
            current_status = complaint["status"] or "Pending"
            if current_status in PIPELINE_STATUSES:
                return error_response(
                    "This request is in the warehouse returns pipeline ("
                    f"{current_status}). Its status is managed by the warehouse; "
                    "you can still post a reply.",
                    409,
                )
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
                   o.total_amount, o.created_at as order_date, o.order_number,
                   o.order_status,
                   w.warehouse_name AS transferred_warehouse_name,
                   (SELECT GROUP_CONCAT(COALESCE(oi.product_name, p.name), ', ')
                      FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
                     WHERE oi.order_id = r.order_id) AS product_names
            FROM order_reports r
            JOIN users u ON r.user_id = u.id
            JOIN orders o ON r.order_id = o.id
            LEFT JOIN warehouses w ON w.id = r.warehouse_id
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


@admin_db_bp.route('/api/admin/order-reports/<int:report_id>/transfer', methods=['POST'])
@require_admin()
def admin_transfer_report_to_warehouse(report_id):
    """Fraud-review gate: transfer a reviewed report to the responsible warehouse.

    Flow: customer reports an order-level issue (possible fraud etc.) → admin
    reviews it → if it looks legitimate (no fraud found), the report is
    TRANSFERRED to the warehouse that packed the order, which is then FORCED
    to record the directed action (refund/exchange/investigation) — the
    warehouse action endpoint rejects closing the report without doing the
    directed action.

    Optional harassment flag issues a formal warning to the warehouse (stored
    in warehouse_warnings; visible in the panel and counted for suspension).

    Body: { note: str?, action_required: 'refund'|'exchange'|'investigate'|str?,
            directive_deadline_hours: int?, harassment_warning: bool? }
    """
    data = request.get_json(silent=True) or {}
    note = (data.get('note') or '').strip() or None
    admin_id = request.user.get('user_id')

    DIRECTIVE_ACTIONS = {'refund', 'exchange', 'investigate', 'refund_or_exchange'}
    action_required = (data.get('action_required') or '').strip().lower() or None
    if action_required and action_required not in DIRECTIVE_ACTIONS:
        return error_response(
            f"Invalid action_required. Allowed: {', '.join(sorted(DIRECTIVE_ACTIONS))}", 400
        )

    deadline_hours = data.get('directive_deadline_hours')
    if deadline_hours is not None:
        try:
            deadline_hours = max(1, min(int(deadline_hours), 720))
        except (TypeError, ValueError):
            deadline_hours = None

    harassment_warning = bool(data.get('harassment_warning'))

    conn = get_db()
    try:
        report = conn.execute(
            "SELECT id, order_id, status, warehouse_id, user_id, report_type FROM order_reports WHERE id = ?",
            (report_id,),
        ).fetchone()
        if not report:
            return error_response("Report not found", 404)
        if report['warehouse_id']:
            return error_response("This report is already transferred to a warehouse", 409)
        if (report['status'] or 'Submitted') in ('Resolved', 'Rejected'):
            return error_response(f"Report is already {report['status']}", 409)

        # Resolve the fulfilling warehouse from the order's latest assignment
        assignment = conn.execute(
            """SELECT warehouse_id FROM warehouse_order_assignments
               WHERE order_id = ? ORDER BY id DESC LIMIT 1""",
            (report['order_id'],),
        ).fetchone()
        if not assignment or not assignment['warehouse_id']:
            return error_response(
                "No warehouse assignment found for this order — it cannot be transferred",
                409,
            )

        warehouse_id = assignment['warehouse_id']
        now = "CURRENT_TIMESTAMP"
        deadline_sql = (
            f"datetime('now', '+{int(deadline_hours)} hours')" if deadline_hours else "NULL"
        )
        conn.execute(
            f"""UPDATE order_reports
                SET status = 'Transferred to Warehouse',
                    warehouse_id = ?,
                    transferred_by = ?,
                    transferred_at = {now},
                    transfer_note = COALESCE(?, transfer_note),
                    action_required = ?,
                    directive_deadline = {deadline_sql},
                    updated_at = {now}
                WHERE id = ?""",
            (warehouse_id, admin_id, note, action_required, report_id),
        )

        directive_label = {
            'refund': 'Issue a REFUND to the customer',
            'exchange': 'Arrange an EXCHANGE/REPLACEMENT',
            'investigate': 'Investigate and record findings',
            'refund_or_exchange': 'Issue a refund OR arrange an exchange',
        }.get(action_required)

        # Notify the warehouse (bell notification)
        try:
            msg = f"Admin reviewed and transferred report #{report_id} (order #{report['order_id']}) for processing action."
            if directive_label:
                msg += f" Required action: {directive_label}."
            if deadline_hours:
                msg += f" Deadline: {deadline_hours}h."
            if harassment_warning:
                msg += " FORMAL WARNING issued: repeated customer harassment leads to account action."
            conn.execute(
                """INSERT INTO warehouse_notifications (warehouse_id, title, message, type)
                   VALUES (?, ?, ?, 'REPORT')""",
                (warehouse_id, "Order report transferred to you", msg),
            )
        except Exception:
            pass

        # Formal harassment warning — persisted record + counted for suspension
        if harassment_warning:
            try:
                conn.execute(
                    """INSERT INTO warehouse_warnings (warehouse_id, report_id, reason, issued_by)
                       VALUES (?, ?, ?, ?)""",
                    (warehouse_id, report_id,
                     note or f"Customer harassment flagged on report #{report_id}", admin_id),
                )
            except Exception:
                pass

        # Notify the customer that the report moved to processing
        try:
            from notifications.notification_service import notification_service
            notification_service.notify_user_internal(
                report['user_id'], "Report under processing",
                f"Your report #{report_id} passed the review and has been sent to the "
                "fulfilling warehouse for action.",
                'ORDER', url=f"/profile/my-reports",
            )
        except Exception:
            pass

        conn.commit()
        updated = conn.execute(
            """SELECT r.*, w.warehouse_name AS transferred_warehouse_name
               FROM order_reports r LEFT JOIN warehouses w ON w.id = r.warehouse_id
               WHERE r.id = ?""",
            (report_id,),
        ).fetchone()
        return success_response(dict(updated), "Report transferred to warehouse")
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()


@admin_db_bp.route('/api/admin/order-reports/<int:report_id>/escalate', methods=['POST'])
@require_admin()
def admin_escalate_report_against_warehouse(report_id):
    """Escalate a report AGAINST the warehouse after its action (or inaction).

    Used when the admin finds the warehouse's handling unsatisfactory: pulls
    the report back into the admin-owned state, issues a formal warning
    record, and notifies the warehouse that further action will be taken.

    Body: { note: str (required) }
    """
    data = request.get_json(silent=True) or {}
    note = (data.get('note') or '').strip()
    if not note:
        return error_response("An escalation note is required", 400)
    admin_id = request.user.get('user_id')

    conn = get_db()
    try:
        report = conn.execute(
            "SELECT id, order_id, status, warehouse_id, user_id FROM order_reports WHERE id = ?",
            (report_id,),
        ).fetchone()
        if not report:
            return error_response("Report not found", 404)
        if not report['warehouse_id']:
            return error_response("Report was never transferred to a warehouse", 409)
        if (report['status'] or '') in ('Resolved', 'Rejected'):
            return error_response("Report is already closed", 409)

        now = "CURRENT_TIMESTAMP"
        conn.execute(
            f"""UPDATE order_reports
                SET status = 'Escalated to Admin',
                    escalated_from_warehouse_id = warehouse_id,
                    escalated_at = {now},
                    escalation_note = ?,
                    updated_at = {now}
                WHERE id = ?""",
            (note, report_id),
        )
        try:
            conn.execute(
                """INSERT INTO warehouse_warnings (warehouse_id, report_id, reason, issued_by)
                   VALUES (?, ?, ?, ?)""",
                (report['warehouse_id'], report_id, f"Escalation: {note}", admin_id),
            )
        except Exception:
            pass
        try:
            conn.execute(
                """INSERT INTO warehouse_notifications (warehouse_id, title, message, type)
                   VALUES (?, ?, ?, 'REPORT')""",
                (report['warehouse_id'],
                 "Report escalated against you",
                 f"Report #{report_id} was escalated to the admin. Further action may be taken "
                 "against repeated offenses."),
            )
        except Exception:
            pass
        conn.commit()

        try:
            from notifications.notification_service import notification_service
            notification_service.notify_user_internal(
                report['user_id'], "Report escalated",
                f"Your report #{report_id} has been escalated to senior admins for direct action.",
                'ORDER', url=f"/profile/my-reports",
            )
        except Exception:
            pass

        _notify_admins(
            "Report escalated",
            f"Report #{report_id} escalated against warehouse #{report['warehouse_id']}: {note}",
            'REPORT', report_id=report_id,
        )

        updated = conn.execute("SELECT * FROM order_reports WHERE id = ?", (report_id,)).fetchone()
        return success_response(dict(updated), "Report escalated — formal warning recorded")
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()


@admin_db_bp.route('/api/admin/warehouse-warnings', methods=['GET'])
@require_admin()
def admin_list_warehouse_warnings():
    """Warning records per warehouse — feeds the suspension decision."""
    warehouse_id = request.args.get('warehouse_id', type=int)
    conn = get_db()
    try:
        query = """
            SELECT ww.*, w.warehouse_name, r.order_id
            FROM warehouse_warnings ww
            LEFT JOIN warehouses w ON w.id = ww.warehouse_id
            LEFT JOIN order_reports r ON r.id = ww.report_id
        """
        params = []
        if warehouse_id:
            query += " WHERE ww.warehouse_id = ?"
            params.append(warehouse_id)
        query += " ORDER BY ww.created_at DESC LIMIT 200"
        rows = conn.execute(query, params).fetchall()
        return success_response([dict(r) for r in rows])
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
    # Statuses owned by the warehouse / escalation flow after a transfer —
    # admin must not yank a live investigation back to a generic label.
    WAREHOUSE_OWNED_STATUSES = {'Transferred to Warehouse', 'In Warehouse Review', 'Action Taken', 'Escalated to Admin'}

    conn = get_db()
    try:
        # Check if report exists
        report = conn.execute("SELECT id, status, warehouse_id FROM order_reports WHERE id = ?", (report_id,)).fetchone()
        if not report:
            return error_response("Report not found", 404)

        current_status = report['status'] or 'Submitted'
        admin_override_close = status in ('Resolved', 'Rejected')
        if current_status in WAREHOUSE_OWNED_STATUSES and status and not admin_override_close:
            # Admin may still close (Resolve/Reject) a transferred report as an
            # override, but cannot set generic in-progress labels on it.
            return error_response(
                f"This report was transferred to a warehouse (status: {current_status}). "
                "Its processing status is managed there; you can still Resolve or Reject it as an override.",
                409,
            )

        updates = ["updated_at = CURRENT_TIMESTAMP"]
        params = []

        if status:
            if status not in allowed_statuses:
                return error_response(f"Invalid status. Allowed: {', '.join(allowed_statuses)}", 400)
            updates.append("status = ?")
            params.append(status)
            # Closing as admin override also notifies the customer below via
            # the resolution field; the warehouse's action_taken stays intact.
        
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

# =============================================================================
# CATALOG APPROVAL — warehouse-created products go live only after admin approval
# =============================================================================

@admin_db_bp.route('/api/admin/product-approvals', methods=['GET'])
@require_admin()
def admin_list_pending_products():
    """Products waiting for catalog approval.

    Query: ?status=pending|approved|rejected|all  (default: pending)
    """
    status = (request.args.get('status') or 'pending').strip().lower()
    conn = get_db()
    try:
        query = """
            SELECT p.id, p.name, p.price, p.mrp, p.category, p.category_id, p.images,
                   p.description, p.brand, p.stock, p.lifecycle_state, p.approval_status,
                   p.approval_source, p.approval_warehouse_id, p.approval_requested_at,
                   p.approval_decided_at, p.approval_decided_by, p.approval_note,
                   p.has_variants, p.is_parent,
                   w.warehouse_name AS submitted_by_warehouse,
                   c.name AS category_name
            FROM products p
            LEFT JOIN warehouses w ON w.id = p.approval_warehouse_id
            LEFT JOIN categories c ON c.id = p.category_id
        """
        params = []
        if status == 'pending':
            query += " WHERE p.approval_status = 'pending'"
        elif status == 'approved':
            query += " WHERE p.approval_status = 'approved'"
        elif status == 'rejected':
            query += " WHERE p.approval_status = 'rejected'"
        elif status != 'all':
            return error_response("Invalid status filter", 400)
        query += " ORDER BY COALESCE(p.approval_requested_at, p.created_at) DESC LIMIT 300"
        rows = conn.execute(query, params).fetchall()
        items = []
        for r in rows:
            d = dict(r)
            # Variants of a pending parent ride the same decision — show the count
            d['variant_count'] = conn.execute(
                "SELECT COUNT(*) FROM products WHERE variant_group_id = ? AND id != ?",
                (d['id'], d['id']),
            ).fetchone()[0]
            items.append(d)
        pending, _reports = _admin_approval_counts()
        return success_response({"items": items, "pending": pending})
    finally:
        conn.close()


@admin_db_bp.route('/api/admin/products/<int:product_id>/approve', methods=['POST'])
@require_admin()
def admin_approve_product(product_id):
    """Approve a warehouse-submitted product (and its variants) for the storefront."""
    admin_id = request.user.get('user_id')
    data = request.get_json(silent=True) or {}
    note = (data.get('note') or '').strip() or None
    conn = get_db()
    try:
        product = conn.execute(
            "SELECT id, name, approval_status, approval_source, approval_warehouse_id, variant_group_id FROM products WHERE id = ?",
            (product_id,),
        ).fetchone()
        if not product:
            return error_response("Product not found", 404)
        if product['approval_status'] == 'approved':
            return error_response("Product is already approved", 409)

        now = "CURRENT_TIMESTAMP"
        # Approve the product and (when it is a parent) its whole variant group
        group_id = product['variant_group_id'] or product_id
        conn.execute(
            f"""UPDATE products
                SET approval_status = 'approved',
                    approval_decided_at = {now}, approval_decided_by = ?,
                    approval_note = COALESCE(?, approval_note)
                WHERE id = ? OR variant_group_id = ?""",
            (admin_id, note, product_id, group_id),
        )
        conn.commit()

        if product['approval_warehouse_id']:
            try:
                conn.execute(
                    """INSERT INTO warehouse_notifications (warehouse_id, title, message, type)
                       VALUES (?, ?, ?, 'PRODUCT')""",
                    (product['approval_warehouse_id'],
                     "Product approved",
                     f"\"{product['name']}\" is now live on the storefront." +
                     (f" Note: {note}" if note else "")),
                )
                conn.commit()
            except Exception:
                pass
        _clear_storefront_cache()
        _notify_admins(
            "Product approved",
            f"Product #{product_id} ({product['name']}) approved and published to the storefront.",
            'PRODUCT', product_id=product_id,
        )
        try:
            log_admin_action(admin_id, 'approve_product', f"product:{product_id}")
        except Exception:
            pass

        updated = conn.execute(
            "SELECT id, name, approval_status, approval_decided_at FROM products WHERE id = ?",
            (product_id,),
        ).fetchone()
        return success_response(dict(updated), "Product approved and published")
    except Exception as e:
        return error_response(str(e))
    finally:
        conn.close()


@admin_db_bp.route('/api/admin/products/<int:product_id>/reject', methods=['POST'])
@require_admin()
def admin_reject_product(product_id):
    """Reject a warehouse-submitted product — it stays invisible on the storefront.

    Body: { note: str (required — the warehouse needs to know why) }
    """
    admin_id = request.user.get('user_id')
    data = request.get_json(silent=True) or {}
    note = (data.get('note') or '').strip()
    if not note:
        return error_response("A rejection note is required so the warehouse can fix the listing", 400)
    conn = get_db()
    try:
        product = conn.execute(
            "SELECT id, name, approval_status, approval_warehouse_id, variant_group_id FROM products WHERE id = ?",
            (product_id,),
        ).fetchone()
        if not product:
            return error_response("Product not found", 404)
        if product['approval_status'] == 'rejected':
            return error_response("Product is already rejected", 409)

        now = "CURRENT_TIMESTAMP"
        group_id = product['variant_group_id'] or product_id
        conn.execute(
            f"""UPDATE products
                SET approval_status = 'rejected',
                    approval_decided_at = {now}, approval_decided_by = ?,
                    approval_note = ?
                WHERE id = ? OR variant_group_id = ?""",
            (admin_id, note, product_id, group_id),
        )
        conn.commit()

        if product['approval_warehouse_id']:
            try:
                conn.execute(
                    """INSERT INTO warehouse_notifications (warehouse_id, title, message, type)
                       VALUES (?, ?, ?, 'PRODUCT')""",
                    (product['approval_warehouse_id'],
                     "Product rejected",
                     f"\"{product['name']}\" was not approved for the store. Reason: {note}"),
                )
                conn.commit()
            except Exception:
                pass
        _clear_storefront_cache()
        _notify_admins(
            "Product rejected",
            f"Product #{product_id} ({product['name']}) rejected. Reason: {note}",
            'PRODUCT', product_id=product_id,
        )
        try:
            log_admin_action(admin_id, 'reject_product', f"product:{product_id}")
        except Exception:
            pass

        updated = conn.execute(
            "SELECT id, name, approval_status, approval_note, approval_decided_at FROM products WHERE id = ?",
            (product_id,),
        ).fetchone()
        return success_response(dict(updated), "Product rejected")
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
    """RETIRED endpoint.

    This route used to update refund rows directly WITHOUT the money side-effects
    (wallet credit, customer notifications, referral settlement) that the canonical
    endpoint performs. To guarantee refunds always go through the full business
    flow, this path now refuses the mutation and points callers at the canonical
    endpoint (app.py: PATCH /api/admin/refund/<id>, UPPERCASE status enum).
    """
    return error_response(
        "This refund endpoint is retired. Use PATCH /api/admin/refund/<id> "
        "with status in ['APPROVED', 'REJECTED', 'PROCESSED'] so wallet credit, "
        "notifications and referral settlement are applied.",
        410,
    )


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
    if not _validate_column_names(data):
        return error_response("Invalid column name")

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
    if not _validate_column_names(data):
        return error_response("Invalid column name")

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
            result = success_response(rows)
        else:
            conn.commit()
            result = success_response(None, "Query executed successfully")
        # Audit trail: this is the most powerful endpoint in the system — every
        # execution (read or write) must be attributable to an admin account.
        try:
            admin_user = getattr(request, 'user', None) or {}
            log_admin_action(
                admin_user.get('user_id'),
                f"db_query_{query.strip().split(None, 1)[0].lower() if query.strip() else 'unknown'}",
                "database",
                None,
            )
        except Exception:
            pass
        return result
    except Exception as e:
        try:
            admin_user = getattr(request, 'user', None) or {}
            log_admin_action(admin_user.get('user_id'), "db_query_failed", "database", None)
        except Exception:
            pass
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
