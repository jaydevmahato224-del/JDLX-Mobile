import re
import secrets
import string
import os

def generate_share_token(length=10):
    """
    Generates a crypto-secure random string for product sharing.
    Uses alphanumeric characters (excluding confusing ones like l, 1, O, 0).
    """
    alphabet = string.ascii_letters + string.digits
    # Remove potentially confusing characters
    confusing = 'l1O0'
    alphabet = ''.join(c for c in alphabet if c not in confusing)
    
    return ''.join(secrets.choice(alphabet) for _ in range(length))

def generate_seo_slug(name):
    """
    Generates a clean, SEO-friendly slug from a product name.
    Matches the frontend implementation in productSlug.js.
    """
    if not name:
        return 'product'
    
    # Lowercase, replace non-alphanumeric with dashes, strip leading/trailing dashes
    slug = name.lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = slug.strip('-')
    
    return slug or 'product'

def generate_product_url(product, origin=None):
    """
    Generates the full secure product URL.
    Format: /p/seo_slug-share_token
    """
    if not product:
        return "/"
    
    if not origin:
        origin = os.environ.get("FRONTEND_URL", "https://jdlxmobile.in")
        
    slug = product.get('seo_slug') or generate_seo_slug(product.get('name'))
    token = product.get('share_token')
    
    if not token:
        # Fallback to ID if token is missing (should not happen in production)
        return f"{origin}/p/{slug}-{product.get('id')}"
        
    return f"{origin}/p/{slug}-{token}"
