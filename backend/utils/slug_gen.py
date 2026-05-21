import re

def generate_product_slug(name):
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
