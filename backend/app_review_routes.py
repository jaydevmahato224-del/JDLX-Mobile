from flask import Blueprint, request, jsonify
from functools import wraps
from database import get_db
import datetime
from auth.role_guard import _current_user_claims, require_admin
from utils.response_utils import success_response, error_response

app_review_bp = Blueprint('app_review', __name__)

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user_claims, error = _current_user_claims()
        if error:
            message, code = error
            return error_response(message, code)
        request.user = user_claims
        return f(*args, **kwargs)
    return decorated

def check_and_trigger_review(cursor, user_id):
    """
    Checks if a user has become eligible for a review prompt.
    Called when order status changes or order is placed.
    """
    try:
        # Check if already in app_reviews
        cursor.execute("SELECT id, prompt_shown_at FROM app_reviews WHERE user_id = ?", (user_id,))
        review = cursor.fetchone()
        
        if review and review['prompt_shown_at']:
            return # Already shown, no need to pre-mark

        # Check eligibility criteria
        cursor.execute("SELECT COUNT(*) as count FROM orders WHERE user_id = ? AND order_status = 'DELIVERED'", (user_id,))
        delivered_count = cursor.fetchone()['count']
        
        cursor.execute("SELECT COUNT(*) as count FROM orders WHERE user_id = ?", (user_id,))
        total_orders = cursor.fetchone()['count']
        
        if delivered_count >= 1 or total_orders >= 3:
            # Pre-mark by ensuring the user exists in the table (if not already)
            # This doesn't set prompt_shown_at yet.
            if not review:
                cursor.execute("INSERT OR IGNORE INTO app_reviews (user_id) VALUES (?)", (user_id,))
    except Exception as e:
        print(f"Error in check_and_trigger_review: {e}")

@app_review_bp.route('/api/app-review/should-prompt', methods=['GET'])
@token_required
def should_prompt():
    user_id = request.user.get('user_id')
    if not user_id:
        return error_response("User not authenticated", 401)

    conn = get_db()
    try:
        cursor = conn.cursor()
        
        # Check if already shown or submitted
        cursor.execute("SELECT prompt_shown_at, submitted_at FROM app_reviews WHERE user_id = ?", (user_id,))
        review = cursor.fetchone()
        
        if review and (review['prompt_shown_at'] or review['submitted_at']):
            return success_response({"show": False, "reason": "already_shown_or_submitted"})

        # Check eligibility
        cursor.execute("SELECT COUNT(*) as count FROM orders WHERE user_id = ? AND order_status = 'DELIVERED'", (user_id,))
        delivered_count = cursor.fetchone()['count']
        
        cursor.execute("SELECT COUNT(*) as count FROM orders WHERE user_id = ?", (user_id,))
        total_orders = cursor.fetchone()['count']
        
        show = False
        reason = None
        
        if delivered_count >= 1:
            show = True
            reason = "first_delivery"
        elif total_orders >= 3:
            show = True
            reason = "three_orders"
            
        if show:
            now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            if review:
                cursor.execute("UPDATE app_reviews SET prompt_shown_at = ? WHERE user_id = ?", (now, user_id))
            else:
                cursor.execute("INSERT INTO app_reviews (user_id, prompt_shown_at) VALUES (?, ?)", (user_id, now))
            conn.commit()
            
        return success_response({"show": show, "reason": reason})
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()

@app_review_bp.route('/api/app-review/submit', methods=['POST'])
@token_required
def submit_review():
    user_id = request.user.get('user_id')
    data = request.get_json() or {}
    
    rating = data.get('rating')
    review_text = data.get('review_text')
    went_to_google = 1 if data.get('went_to_google') else 0
    submitted_at = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn = get_db()
    try:
        cursor = conn.cursor()
        
        cursor.execute("SELECT id FROM app_reviews WHERE user_id = ?", (user_id,))
        review = cursor.fetchone()
        
        if review:
            cursor.execute('''
                UPDATE app_reviews 
                SET rating = ?, review_text = ?, went_to_google = ?, submitted_at = ?
                WHERE user_id = ?
            ''', (rating, review_text, went_to_google, submitted_at, user_id))
        else:
            cursor.execute('''
                INSERT INTO app_reviews (user_id, rating, review_text, went_to_google, submitted_at, prompt_shown_at)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (user_id, rating, review_text, went_to_google, submitted_at, submitted_at))
            
        conn.commit()
        return success_response({"message": "Review submitted successfully"})
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()

@app_review_bp.route('/api/admin/app-reviews', methods=['GET'])
@token_required
@require_admin()
def get_admin_reviews():
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT ar.*, u.full_name, u.email 
            FROM app_reviews ar
            JOIN users u ON ar.user_id = u.id
            WHERE ar.submitted_at IS NOT NULL OR ar.rating IS NOT NULL
            ORDER BY ar.submitted_at DESC
        ''')
        reviews = [dict(row) for row in cursor.fetchall()]
        
        # Summary stats
        cursor.execute("SELECT AVG(rating) as avg_rating, COUNT(*) as total_reviews FROM app_reviews WHERE rating IS NOT NULL")
        stats = cursor.fetchone()
        
        cursor.execute("SELECT COUNT(*) as google_count FROM app_reviews WHERE went_to_google = 1")
        google_count = cursor.fetchone()['google_count']
        
        return success_response({
            "reviews": reviews,
            "summary": {
                "avg_rating": round(stats['avg_rating'] or 0, 1),
                "total_reviews": stats['total_reviews'],
                "went_to_google": google_count
            }
        })
    except Exception as e:
        return error_response(str(e), 500)
    finally:
        conn.close()
