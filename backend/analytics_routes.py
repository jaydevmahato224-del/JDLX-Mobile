from flask import Blueprint, jsonify, request
from database import get_db
import datetime

analytics_bp = Blueprint('analytics', __name__)


@analytics_bp.route('/api/user/interactions', methods=['POST'])
def post_user_interaction():
    """Records a user interaction (view/click) on the storefront.

    The storefront (Home.jsx logInteraction) posts engagement events here.
    Missing/optional fields are tolerated so tracking never breaks the UI.
    """
    data = request.get_json(force=True, silent=True) or {}
    interaction_type = data.get('interaction_type')
    target_id = data.get('target_id')
    session_id = data.get('session_id')

    # Require only the core identifying fields; everything else is optional.
    if not interaction_type or not target_id:
        return jsonify({"error": "Missing interaction_type or target_id"}), 400

    user_id = data.get('user_id')
    category = data.get('category')

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO user_interactions (
                user_id, session_id, interaction_type, target_id, category
            ) VALUES (?, ?, ?, ?, ?)
        ''', (user_id, session_id, interaction_type, str(target_id), category))
        conn.commit()
        return jsonify({"ok": True}), 200
    finally:
        conn.close()

ALLOWED_EVENT_TYPES = {
    'click', 'search', 'add_to_cart', 'purchase',
    'page_view', 'scroll', 'form_submit', 'video_play'
}

@analytics_bp.route('/api/analytics/pageview', methods=['POST'])
def post_pageview():
    data = request.get_json(force=True, silent=True) or {}
    session_id = data.get('session_id')
    page_path = data.get('page_path')
    
    if not session_id or not page_path:
        return jsonify({"error": "Missing session_id or page_path"}), 400

    user_id = data.get('user_id')
    page_title = data.get('page_title')
    referrer = data.get('referrer')
    utm_source = data.get('utm_source')
    utm_medium = data.get('utm_medium')
    utm_campaign = data.get('utm_campaign')
    device_type = data.get('device_type')
    browser = data.get('browser')
    os_name = data.get('os')
    screen_resolution = data.get('screen_resolution')
    country = data.get('country')

    conn = get_db()
    try:
        cursor = conn.cursor()
        
        # Insert page view
        cursor.execute('''
            INSERT INTO page_views (
                session_id, user_id, page_path, page_title, referrer,
                utm_source, utm_medium, utm_campaign, device_type,
                browser, os, screen_resolution, country
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            session_id, user_id, page_path, page_title, referrer,
            utm_source, utm_medium, utm_campaign, device_type,
            browser, os_name, screen_resolution, country
        ))

        # Upsert analytics session
        cursor.execute("SELECT id FROM analytics_sessions WHERE session_id = ?", (session_id,))
        session_row = cursor.fetchone()

        if session_row:
            cursor.execute('''
                UPDATE analytics_sessions 
                SET last_seen_at = CURRENT_TIMESTAMP, 
                    page_count = page_count + 1, 
                    is_bounce = 0,
                    user_id = COALESCE(?, user_id)
                WHERE session_id = ?
            ''', (user_id, session_id))
        else:
            cursor.execute('''
                INSERT INTO analytics_sessions (
                    session_id, user_id, device_type, browser, os, referrer, utm_source
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                session_id, user_id, device_type, browser, os_name, referrer, utm_source
            ))

        conn.commit()
        return jsonify({"ok": True}), 200
    finally:
        conn.close()

@analytics_bp.route('/api/analytics/event', methods=['POST'])
def post_event():
    data = request.get_json(force=True, silent=True) or {}
    session_id = data.get('session_id')
    event_type = data.get('event_type')
    event_category = data.get('event_category')

    if not session_id or not event_type or not event_category:
        return jsonify({"error": "Missing required fields"}), 400

    if event_type not in ALLOWED_EVENT_TYPES:
        return jsonify({"error": f"Invalid event_type. Allowed: {', '.join(ALLOWED_EVENT_TYPES)}"}), 400

    user_id = data.get('user_id')
    event_label = data.get('event_label')
    event_value = data.get('event_value')
    page_path = data.get('page_path')

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO analytics_events (
                session_id, user_id, event_type, event_category,
                event_label, event_value, page_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            session_id, user_id, event_type, event_category,
            event_label, event_value, page_path
        ))
        conn.commit()
        return jsonify({"ok": True}), 200
    finally:
        conn.close()

@analytics_bp.route('/api/analytics/search', methods=['POST'])
def post_search():
    data = request.get_json(force=True, silent=True) or {}
    session_id = data.get('session_id')
    query = data.get('query')

    if not session_id or not query:
        return jsonify({"error": "Missing session_id or query"}), 400

    user_id = data.get('user_id')
    results_count = data.get('results_count', 0)
    clicked_product_id = data.get('clicked_product_id')

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO search_queries (
                session_id, user_id, query, results_count, clicked_product_id
            ) VALUES (?, ?, ?, ?, ?)
        ''', (
            session_id, user_id, query, results_count, clicked_product_id
        ))
        conn.commit()
        return jsonify({"ok": True}), 200
    finally:
        conn.close()

@analytics_bp.route('/api/analytics/duration', methods=['POST'])
def post_duration():
    data = request.get_json(force=True, silent=True) or {}
    session_id = data.get('session_id')
    page_path = data.get('page_path')
    duration_seconds = data.get('duration_seconds')

    if not session_id or not page_path or duration_seconds is None:
        return jsonify({"error": "Missing session_id, page_path or duration_seconds"}), 400

    conn = get_db()
    try:
        cursor = conn.cursor()
        # Using a subquery for ORDER BY LIMIT in UPDATE if supported, 
        # but sqlite3 update doesn't support ORDER BY LIMIT by default unless compiled with SQLITE_ENABLE_UPDATE_DELETE_LIMIT
        # We can use the rowid or a subquery.
        cursor.execute('''
            UPDATE page_views 
            SET duration_seconds = ?
            WHERE id = (
                SELECT id FROM page_views 
                WHERE session_id = ? AND page_path = ?
                ORDER BY created_at DESC LIMIT 1
            )
        ''', (duration_seconds, session_id, page_path))
        
        conn.commit()
        return jsonify({"ok": True}), 200
    finally:
        conn.close()


@analytics_bp.route('/api/onboarding/source', methods=['POST'])
def post_onboarding_source():
    """Records where a new user heard about JDLX Mobile.

    Fired once from the first-run onboarding screen. All fields optional except
    source, and storage failures never surface to the UI (fire-and-forget).
    """
    data = request.get_json(force=True, silent=True) or {}
    source = (data.get('source') or '').strip().lower()
    if source not in ('friends', 'relatives', 'social_media', 'other'):
        return jsonify({"error": "Invalid source"}), 400

    conn = get_db()
    try:
        conn.execute('''
            INSERT INTO onboarding_sources (user_id, session_id, source, platform, detail)
            VALUES (?, ?, ?, ?, ?)
        ''', (
            data.get('user_id'),
            data.get('session_id'),
            source,
            (data.get('platform') or '').strip()[:50] or None,
            (data.get('detail') or '').strip()[:300] or None,
        ))
        conn.commit()
        return jsonify({"ok": True}), 200
    finally:
        conn.close()
