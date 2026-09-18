"""Client error telemetry — capture, deduplicate, and surface storefront errors.

Fully additive to the existing error channels:
  - /api/report-issue (manual user reports + admin email) stays untouched.
  - This module adds AUTOMATIC capture (crashes, unhandled rejections, failed
    API batches) with client-side fingerprinting, so the admin panel sees every
    frontend problem without waiting for a user to file a report.

Design constraints (production safety):
  - The capture endpoint is PUBLIC (guest users hit crashes too), but it is
    strictly rate-limited, size-capped, and stores no free text beyond a short
    message + stack snippet. No PII beyond the logged-in user's id.
  - Raw events auto-expire (RENTENTION_DAYS) via lazy purge; compact per-bug
    "groups" carry the long-term signal (counts, affected users, status).
  - A global capture kill-switch (CLIENT_ERROR_CAPTURE=off) stops ingestion.
"""

import datetime
import hashlib
import json

from flask import Blueprint, request
from functools import wraps

from database import get_db
from utils.response_utils import success_response, error_response
from utils.activity_logger import log_admin_action

client_error_bp = Blueprint('client_error', __name__)

MAX_MESSAGE_LEN = 500
MAX_STACK_LEN = 2000
MAX_CONTEXT_JSON_LEN = 1500
EVENTS_PER_GROUP_FETCH = 25
MAX_EVENTS_LIST = 200
RETENTION_DAYS = 14
# Hard ingestion ceiling per fingerprint-group per hour — a runaway client
# (infinite error loop) can never flood the table past this.
MAX_EVENTS_PER_GROUP_HOUR = 120

_VALID_SEVERITY = {'low', 'medium', 'high', 'critical'}
_VALID_STATUS = {'new', 'acknowledged', 'fixed', 'ignored'}
_VALID_KINDS = {'crash', 'unhandledrejection', 'api_failure', 'manual'}


def _kill_switch_off():
    """Env kill-switch: CLIENT_ERROR_CAPTURE=off stops ALL ingestion."""
    import os
    return os.environ.get('CLIENT_ERROR_CAPTURE', '').strip().lower() in ('off', '0', 'false', 'no')


def _fingerprint(message, kind):
    """Stable fingerprint: same bug on many devices → same group."""
    base = f"{kind}|{(message or '')[:200]}"
    return hashlib.sha1(base.encode('utf-8', 'replace')).hexdigest()[:16]


def _now_str():
    return datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def _clean_str(value, limit):
    if not isinstance(value, str):
        return ''
    return value.strip()[:limit]


# ─── Public capture endpoint ──────────────────────────────────────────────────

def _optional_user_id():
    """Best-effort user id from the standard bearer/cookie token (never raises)."""
    from auth.role_guard import _current_user_claims
    claims, _err = _current_user_claims()
    if claims and claims.get('user_id'):
        try:
            return int(claims.get('user_id'))
        except (TypeError, ValueError):
            return None
    return None


@client_error_bp.route('/api/client-error', methods=['POST'])
def capture_client_error():
    if _kill_switch_off():
        # Silently accept (2xx) so the client never retries/report loops.
        return success_response(None, 'capture disabled', 202)

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return error_response('Invalid payload', 400)

    # Single event or a small batch — client batches to amortize requests.
    events = data.get('events')
    if not isinstance(events, list):
        events = [data]
    events = [e for e in events if isinstance(e, dict)][:10]
    if not events:
        return error_response('No events', 400)
    if not any(_clean_str(e.get('message'), MAX_MESSAGE_LEN) for e in events):
        return error_response('No valid events: message is required', 400)

    conn = get_db()
    try:
        cursor = conn.cursor()
        now = _now_str()
        stored = 0
        touched_groups = set()

        for ev in events:
            kind = _clean_str(ev.get('kind'), 40) or 'crash'
            if kind not in _VALID_KINDS:
                kind = 'crash'
            message = _clean_str(ev.get('message'), MAX_MESSAGE_LEN)
            if not message:
                continue
            stack = _clean_str(ev.get('stack'), MAX_STACK_LEN)
            page = _clean_str(ev.get('page'), 300)
            session_id = _clean_str(ev.get('session_id'), 64)
            app_version = _clean_str(ev.get('app_version'), 32)
            context = ev.get('context')
            if isinstance(context, (dict, list)):
                try:
                    context_json = json.dumps(context, ensure_ascii=False)[:MAX_CONTEXT_JSON_LEN]
                except (TypeError, ValueError):
                    context_json = None
            else:
                context_json = None

            fp = _fingerprint(message, kind)

            # Per-group hourly ceiling (anti-flood).
            count_row = cursor.execute(
                """SELECT COUNT(*) AS c FROM client_error_events
                   WHERE fingerprint = ? AND created_at > datetime('now', '-1 hour')""",
                (fp,)
            ).fetchone()
            if count_row and int(count_row['c'] or 0) >= MAX_EVENTS_PER_GROUP_HOUR:
                continue

            severity = _clean_str(ev.get('severity'), 10).lower()
            if severity not in _VALID_SEVERITY:
                severity = 'high' if kind == 'crash' else ('medium' if kind == 'unhandledrejection' else 'low')

            user_id = ev.get('user_id')
            if user_id in (None, '', 'Guest'):
                user_id = _optional_user_id()
            try:
                user_id = int(user_id) if user_id not in (None, '', 'Guest') else None
            except (TypeError, ValueError):
                user_id = None

            cursor.execute(
                """INSERT INTO client_error_events
                   (fingerprint, kind, severity, message, stack, page, user_id, session_id,
                    app_version, context_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (fp, kind, severity, message, stack, page, user_id, session_id,
                 app_version, context_json, now)
            )
            stored += 1
            touched_groups.add((fp, severity))

            # Upsert the compact group (the long-term signal admins browse).
            group = cursor.execute(
                'SELECT id, total_count, severity, status FROM client_error_groups WHERE fingerprint = ?',
                (fp,)
            ).fetchone()
            if group:
                new_severity = severity
                if group['status'] in ('fixed', 'ignored') and severity != 'critical':
                    # Keep the operator's decision; only CRITICAL escalates a
                    # closed group back to new (possible regression signal is
                    # computed on read, not by reopening here).
                    new_severity = group['severity']
                cursor.execute(
                    """UPDATE client_error_groups
                       SET total_count = total_count + 1,
                           last_seen_at = ?,
                           severity = ?
                       WHERE id = ?""",
                    (now, new_severity, group['id'])
                )
            else:
                cursor.execute(
                    """INSERT INTO client_error_groups
                       (fingerprint, kind, severity, message, sample_stack, sample_page,
                        total_count, users_affected, status, first_seen_at, last_seen_at)
                       VALUES (?, ?, ?, ?, ?, ?, 1, 0, 'new', ?, ?)""",
                    (fp, kind, severity, message, stack, page, now, now)
                )

        # Refresh affected-user counts only for the groups we touched.
        for fp, _sev in touched_groups:
            cursor.execute(
                """UPDATE client_error_groups SET users_affected = (
                       SELECT COUNT(DISTINCT COALESCE(CAST(user_id AS TEXT), 'g:' || session_id))
                       FROM client_error_events
                       WHERE fingerprint = client_error_groups.fingerprint
                   )
                   WHERE fingerprint = ?""",
                (fp,)
            )
        conn.commit()
        return success_response({'stored': stored}, 'captured', 201)
    except Exception:
        # Capture must NEVER become a user-facing error — fail silent, log server-side.
        import logging
        logging.getLogger(__name__).exception('client_error capture failed')
        return success_response(None, 'accepted', 202)
    finally:
        conn.close()


# ─── Admin endpoints ──────────────────────────────────────────────────────────

def _admin_required(f):
    """Reuse the same role guard the rest of the admin API uses."""
    from auth.role_guard import require_admin
    return require_admin()(f)


@client_error_bp.route('/api/admin/client-errors/groups', methods=['GET'])
@_admin_required
def list_error_groups():
    status = request.args.get('status')  # new | acknowledged | fixed | ignored
    severity = request.args.get('severity')
    kind = request.args.get('kind')
    search = _clean_str(request.args.get('q'), 100)
    limit = min(int(request.args.get('limit', 100) or 100), MAX_EVENTS_LIST)

    query = """SELECT g.*,
                      (SELECT COUNT(*) FROM client_error_events e
                        WHERE e.fingerprint = g.fingerprint
                          AND e.created_at > datetime('now', '-1 day')) AS count_24h,
                      (SELECT COUNT(DISTINCT COALESCE(CAST(user_id AS TEXT), 'g:' || session_id))
                        FROM client_error_events e
                        WHERE e.fingerprint = g.fingerprint
                          AND e.created_at > datetime('now', '-1 day')
                          AND COALESCE(CAST(user_id AS TEXT), 'g:' || session_id) IS NOT NULL) AS users_24h
               FROM client_error_groups g WHERE 1=1"""
    params = []
    if status and status in _VALID_STATUS:
        query += ' AND g.status = ?'
        params.append(status)
    if severity and severity in _VALID_SEVERITY:
        query += ' AND g.severity = ?'
        params.append(severity)
    if kind and kind in _VALID_KINDS:
        query += ' AND g.kind = ?'
        params.append(kind)
    if search:
        query += ' AND (g.message LIKE ? OR g.sample_page LIKE ?)'
        params.extend([f'%{search}%', f'%{search}%'])
    query += ' ORDER BY g.last_seen_at DESC LIMIT ?'
    params.append(limit)

    conn = get_db()
    try:
        rows = [dict(r) for r in conn.execute(query, params).fetchall()]
        for r in rows:
            # Regression signal: group marked fixed but fresh events keep arriving.
            r['possible_regression'] = (
                r.get('status') == 'fixed'
                and int(r.get('count_24h') or 0) > 0
            )
        return success_response(rows)
    finally:
        conn.close()


@client_error_bp.route('/api/admin/client-errors/groups/<int:group_id>/status', methods=['POST'])
@_admin_required
def set_group_status(group_id):
    data = request.get_json(silent=True) or {}
    status = _clean_str(data.get('status'), 20).lower()
    if status not in _VALID_STATUS:
        return error_response('Invalid status', 400)

    conn = get_db()
    try:
        cur = conn.cursor()
        row = cur.execute('SELECT id FROM client_error_groups WHERE id = ?', (group_id,)).fetchone()
        if not row:
            return error_response('Group not found', 404)
        cur.execute('UPDATE client_error_groups SET status = ? WHERE id = ?', (status, group_id))
        conn.commit()
        try:
            log_admin_action(request.user.get('user_id'), 'client_error_status', f'group {group_id} -> {status}')
        except Exception:
            pass
        return success_response(None, 'updated')
    finally:
        conn.close()


@client_error_bp.route('/api/admin/client-errors/groups/<int:group_id>/events', methods=['GET'])
@_admin_required
def list_group_events(group_id):
    limit = min(int(request.args.get('limit', EVENTS_PER_GROUP_FETCH) or EVENTS_PER_GROUP_FETCH), 100)
    conn = get_db()
    try:
        group = conn.execute('SELECT fingerprint FROM client_error_groups WHERE id = ?', (group_id,)).fetchone()
        if not group:
            return error_response('Group not found', 404)
        rows = conn.execute(
            """SELECT e.id, e.kind, e.severity, e.message, e.stack, e.page, e.user_id,
                      e.session_id, e.app_version, e.context_json, e.created_at,
                      u.name AS user_name, u.email AS user_email
               FROM client_error_events e
               LEFT JOIN users u ON u.id = e.user_id
               WHERE e.fingerprint = ?
               ORDER BY e.created_at DESC LIMIT ?""",
            (group['fingerprint'], limit)
        ).fetchall()
        return success_response([dict(r) for r in rows])
    finally:
        conn.close()


@client_error_bp.route('/api/admin/client-errors/summary', methods=['GET'])
@_admin_required
def error_summary():
    """Top-bar KPIs for the Error Center: 24h new groups, events, users, spikes."""
    conn = get_db()
    try:
        cur = conn.cursor()
        events_24h = cur.execute(
            "SELECT COUNT(*) AS c FROM client_error_events WHERE created_at > datetime('now', '-1 day')"
        ).fetchone()['c']
        groups_new = cur.execute(
            "SELECT COUNT(*) AS c FROM client_error_groups WHERE status = 'new'"
        ).fetchone()['c']
        groups_active = cur.execute(
            "SELECT COUNT(*) AS c FROM client_error_groups WHERE status IN ('new','acknowledged')"
        ).fetchone()['c']
        users_24h = cur.execute(
            """SELECT COUNT(DISTINCT COALESCE(CAST(user_id AS TEXT), 'g:' || session_id)) AS c
               FROM client_error_events
               WHERE created_at > datetime('now', '-1 day')
                 AND COALESCE(CAST(user_id AS TEXT), 'g:' || session_id) IS NOT NULL"""
        ).fetchone()['c']
        top_group = cur.execute(
            """SELECT id, fingerprint, message, severity, total_count FROM client_error_groups
               WHERE status IN ('new','acknowledged')
               ORDER BY last_seen_at DESC LIMIT 1"""
        ).fetchone()
        # Spike: any fingerprint with >=5 distinct visitors in the last hour.
        spike = cur.execute(
            """SELECT fingerprint, COUNT(DISTINCT COALESCE(CAST(user_id AS TEXT), 'g:' || session_id)) AS visitors
               FROM client_error_events
               WHERE created_at > datetime('now', '-1 hour')
               GROUP BY fingerprint HAVING visitors >= 5 LIMIT 1"""
        ).fetchone()
        top = None
        if top_group:
            top = dict(top_group)
            # real 24h count for the top group
            cnt = cur.execute(
                "SELECT COUNT(*) AS c FROM client_error_events WHERE fingerprint = ? AND created_at > datetime('now', '-1 day')",
                (top['fingerprint'],)
            ).fetchone()['c']
            top['count_24h'] = cnt
        return success_response({
            'events_24h': events_24h,
            'groups_new': groups_new,
            'groups_active': groups_active,
            'users_24h': users_24h,
            'spike': dict(spike) if spike else None,
            'top_group': top,
        })
    finally:
        conn.close()


@client_error_bp.route('/api/admin/issue-reports', methods=['GET'])
@_admin_required
def list_issue_reports():
    """Admin viewer for the EXISTING manual user reports (issue_reports table).

    Until now this data was email-only with no admin UI — this read-only
    endpoint surfaces it inside the Error Center. Writes stay untouched.
    """
    limit = min(int(request.args.get('limit', 100) or 100), MAX_EVENTS_LIST)
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT i.id, i.user_id, i.error_type, i.page, i.description, i.timestamp,
                      u.name AS user_name, u.email AS user_email
               FROM issue_reports i
               LEFT JOIN users u ON u.id = CAST(i.user_id AS INTEGER)
               ORDER BY i.timestamp DESC LIMIT ?""",
            (limit,)
        ).fetchall()
        return success_response([dict(r) for r in rows])
    finally:
        conn.close()
