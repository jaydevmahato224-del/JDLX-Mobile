import os
import random
import datetime
from flask import Blueprint, request, current_app
from functools import wraps
from auth.role_guard import _current_user_claims
from database import get_db
from utils.response_utils import success_response, error_response

support_bp = Blueprint('support', __name__)

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user_claims, error = _current_user_claims()
        if error:
            message, code = error
            return error_response(message, code)
        return f(*args, **kwargs)
    return decorated

def generate_ticket_number(conn):
    year = datetime.datetime.now().year
    while True:
        num = random.randint(10000, 99999)
        tkt_no = f"TKT-{year}-{num}"
        # Check for collision
        exists = conn.execute("SELECT 1 FROM support_tickets WHERE ticket_number = ?", (tkt_no,)).fetchone()
        if not exists:
            return tkt_no

@support_bp.route('/api/support/ticket', methods=['POST'])
@token_required
def create_ticket():
    user_id = request.user.get('user_id')
    data = request.get_json(silent=True) or {}
    subject = data.get('subject')
    message = data.get('message')

    if not subject or not message:
        return error_response("Subject and message are required", 400)

    conn = get_db()
    try:
        ticket_number = generate_ticket_number(conn)
        cursor = conn.cursor()
        
        # Insert Ticket
        cursor.execute(
            """INSERT INTO support_tickets (user_id, subject, message, status, ticket_number) 
               VALUES (?, ?, ?, 'Open', ?)""",
            (user_id, subject, message, ticket_number)
        )
        ticket_id = cursor.lastrowid

        # Insert first message
        cursor.execute(
            "INSERT INTO ticket_messages (ticket_id, sender, message) VALUES (?, 'customer', ?)",
            (ticket_id, message)
        )
        
        conn.commit()
        return success_response({
            "ticket_id": ticket_id,
            "ticket_number": ticket_number
        }, "Ticket created successfully", 201)
    finally:
        conn.close()

@support_bp.route('/api/support/tickets', methods=['GET'])
@token_required
def list_tickets():
    user_id = request.user.get('user_id')
    conn = get_db()
    try:
        # Fetch tickets with the most recent message text
        query = """
            SELECT t.id, t.ticket_number, t.subject, t.status, t.created_at, t.updated_at,
                   (SELECT message FROM ticket_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message
            FROM support_tickets t
            WHERE t.user_id = ?
            ORDER BY t.created_at DESC
        """
        rows = conn.execute(query, (user_id,)).fetchall()
        
        tickets = []
        for row in rows:
            last_msg = row['last_message'] or ""
            tickets.append({
                "id": row['id'],
                "ticket_number": row['ticket_number'],
                "subject": row['subject'],
                "status": row['status'],
                "created_at": row['created_at'],
                "updated_at": row['updated_at'],
                "last_message": (last_msg[:80] + '...') if len(last_msg) > 80 else last_msg
            })
            
        return success_response(tickets)
    finally:
        conn.close()

@support_bp.route('/api/support/tickets/<int:ticket_id>', methods=['GET'])
@token_required
def get_ticket_details(ticket_id):
    user_id = request.user.get('user_id')
    conn = get_db()
    try:
        # Verify ownership
        ticket = conn.execute(
            "SELECT * FROM support_tickets WHERE id = ? AND user_id = ?",
            (ticket_id, user_id)
        ).fetchone()

        if not ticket:
            return error_response("Ticket not found or access denied", 403)

        # Fetch thread
        messages = conn.execute(
            "SELECT id, sender, message, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC",
            (ticket_id,)
        ).fetchall()

        return success_response({
            "ticket": dict(ticket),
            "messages": [dict(m) for m in messages]
        })
    finally:
        conn.close()

@support_bp.route('/api/support/tickets/<int:ticket_id>/reply', methods=['POST'])
@token_required
def reply_to_ticket(ticket_id):
    user_id = request.user.get('user_id')
    data = request.get_json(silent=True) or {}
    message = data.get('message')

    if not message:
        return error_response("Message text is required", 400)

    conn = get_db()
    try:
        # Verify ownership and status
        ticket = conn.execute(
            "SELECT id, status FROM support_tickets WHERE id = ? AND user_id = ?",
            (ticket_id, user_id)
        ).fetchone()

        if not ticket:
            return error_response("Ticket not found or access denied", 403)
        
        if ticket['status'].lower() == 'closed':
            return error_response("Yeh ticket closed hai, naya ticket banayein", 400)

        cursor = conn.cursor()
        # Insert Message
        cursor.execute(
            "INSERT INTO ticket_messages (ticket_id, sender, message) VALUES (?, 'customer', ?)",
            (ticket_id, message)
        )
        msg_id = cursor.lastrowid

        # Update Ticket
        cursor.execute(
            "UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP, status = 'Open' WHERE id = ?",
            (ticket_id,)
        )
        
        conn.commit()
        
        return success_response({
            "id": msg_id,
            "sender": "customer",
            "message": message,
            "created_at": datetime.datetime.now().isoformat()
        }, "Reply added successfully", 201)
    finally:
        conn.close()
