"""
Product API Optimization Module
Provides optimized database queries and caching strategies for products
"""

from flask import request, jsonify
from functools import wraps
import time


# Pagination defaults and limits
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100
MIN_PAGE_SIZE = 1

# Cache headers for efficient client-side caching
CACHE_CONTROL_HEADERS = {
    'Cache-Control': 'public, max-age=300',  # 5 minutes public cache
    'ETag': None,  # Will be generated per request
}


def get_pagination_params():
    """
    Extract and validate pagination parameters from request
    Returns: (page, limit, offset) tuple
    """
    try:
        page = request.args.get('page', default=1, type=int)
        limit = request.args.get('limit', default=DEFAULT_PAGE_SIZE, type=int)
        offset = request.args.get('offset', default=None, type=int)
        
        # Validate page
        page = max(1, page)
        
        # Validate limit
        limit = max(MIN_PAGE_SIZE, min(limit, MAX_PAGE_SIZE))
        
        # Calculate offset if not provided
        if offset is None:
            offset = (page - 1) * limit
        else:
            offset = max(0, offset)
        
        return page, limit, offset
    except (ValueError, TypeError):
        return 1, DEFAULT_PAGE_SIZE, 0


def get_category_filter():
    """
    Extract category filter from request
    Returns: (category_id, category_name) or (None, None)
    """
    category_id = request.args.get('category_id', type=int)
    category = request.args.get('category')
    
    return category_id, category


def build_product_query(include_reviews=True):
    """
    Build the base product query
    """
    if include_reviews:
        query = '''
            SELECT p.*, c.name as category_name,
                   COALESCE(c.device_customization_enabled, 0) as device_customization_enabled,
                   COALESCE(AVG(r.rating), 0) as average_rating, 
                   COUNT(r.id) as total_reviews
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN product_reviews r ON p.id = r.product_id
            WHERE p.status = 'available'
        '''
    else:
        query = '''
            SELECT p.*
            FROM products p
            WHERE p.status = 'available'
        '''
    return query


def add_category_filter(query, category_id=None, category=None):
    """
    Add category filter to query if needed
    """
    params = []
    if category_id:
        query += " AND p.category_id = ?"
        params.append(category_id)
    elif category:
        query += " AND p.category = ?"
        params.append(category)
    return query, params


def add_pagination(query, limit, offset, include_reviews=True):
    """
    Add pagination to query
    """
    if include_reviews:
        query += " GROUP BY p.id"
    query += " ORDER BY p.id DESC LIMIT ? OFFSET ?"
    
    return query


def get_total_count(conn, base_query, params):
    """
    Get total count of products matching filter
    """
    try:
        cursor = conn.cursor()
        # Remove GROUP BY and ORDER BY for count query
        count_query = base_query.replace("GROUP BY p.id", "")
        count_query = count_query.split("ORDER BY")[0].strip()
        count_query = f"SELECT COUNT(*) as total FROM ({count_query})"
        
        cursor.execute(count_query, params)
        result = cursor.fetchone()
        return result['total'] if result else 0
    except Exception as e:
        print(f"Error getting total count: {e}")
        return 0


def add_response_headers(response):
    """
    Add cache headers to response
    """
    response.headers['Cache-Control'] = CACHE_CONTROL_HEADERS['Cache-Control']
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    return response


class ProductQueryOptimizer:
    """
    Optimizes product queries with caching and prefetching strategies
    """
    
    def __init__(self):
        self.query_cache = {}
        self.cache_time = {}
        
    def execute_optimized_query(self, conn, query, params):
        """Execute query with potential caching"""
        cursor = conn.cursor()
        start_time = time.time()
        
        cursor.execute(query, params)
        products = [dict(row) for row in cursor.fetchall()]
        
        query_time = time.time() - start_time
        
        # Log slow queries for optimization
        if query_time > 1.0:
            print(f"Slow query detected ({query_time:.2f}s): {query[:100]}...")
        
        return products

    def get_recommendations_query(self, limit=10):
        """
        Build a query for recommended products. 
        Prioritizes items with higher ratings, but falls back to newest available items.
        """
        query = '''
            SELECT p.id, p.name, p.price, p.images, p.category, p.is_featured, c.name as category_name,
                   COALESCE(c.device_customization_enabled, 0) as device_customization_enabled,
                   COALESCE(AVG(r.rating), 0.0) as average_rating, 
                   COUNT(r.id) as total_reviews
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN product_reviews r ON p.id = r.product_id
            WHERE p.status = 'available'
            GROUP BY p.id
            ORDER BY average_rating DESC, total_reviews DESC, p.id DESC
            LIMIT ?
        '''
        return query, [limit]


# Create optimizer instance
optimizer = ProductQueryOptimizer()
