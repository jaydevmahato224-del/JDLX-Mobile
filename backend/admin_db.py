from flask import Blueprint, request, jsonify
from database import get_db
from auth.role_guard import require_super_admin
from utils.response_utils import success_response, error_response
import sqlite3

admin_db_bp = Blueprint('admin_db', __name__)

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
