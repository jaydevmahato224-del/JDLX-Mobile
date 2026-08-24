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

def repair_product_data(cursor):
    """
    Scans all products and repairs missing or malformed seo_slug/share_token.
    Internal utility for maintaining data integrity.
    """
    cursor.execute("SELECT id, name, share_token, seo_slug FROM products")
    products = cursor.fetchall()
    
    repaired_count = 0
    for product in products:
        product_id = product['id']
        name = product['name']
        token = product['share_token']
        slug = product['seo_slug']
        
        updates = []
        params = []
        
        # Repair missing or malformed token
        if not token or len(token) < 8:
            new_token = generate_share_token()
            updates.append("share_token = ?")
            params.append(new_token)
            
        # Repair missing slug or generate fresh from name
        correct_slug = generate_seo_slug(name)
        if not slug or slug != correct_slug:
            updates.append("seo_slug = ?")
            params.append(correct_slug)
            
        if updates:
            params.append(product_id)
            cursor.execute(f"UPDATE products SET {', '.join(updates)} WHERE id = ?", tuple(params))
            repaired_count += 1
            
    return repaired_count


def generate_product_description(product_data):
    """
    Generates a professional product description from structured product data.
    
    Includes:
    - User-provided description (warehouse/admin) at the top
    - Product specifications (Material, Color, Brand, etc.)
    - Return Policy with headers
    - How to Use section
    - Key Features
    
    Args:
        product_data: dict with keys: description, material_type, color, brand, 
                      return_policy, units_per_pack, weight, dimensions, name, category
    
    Returns:
        Formatted description string
    """
    sections = []
    
    # 1. User-provided description (from warehouse/admin) - PUT AT TOP
    user_description = (product_data.get('description') or '').strip()
    if user_description:
        sections.append(user_description)
    
    # 2. Product Specifications
    specs = []
    if product_data.get('brand'):
        specs.append(f"<strong>Brand:</strong> {product_data['brand']}")
    if product_data.get('material_type'):
        specs.append(f"<strong>Material:</strong> {product_data['material_type']}")
    if product_data.get('color'):
        specs.append(f"<strong>Color:</strong> {product_data['color']}")
    if product_data.get('units_per_pack'):
        specs.append(f"<strong>Units per Pack:</strong> {product_data['units_per_pack']}")
    if product_data.get('weight'):
        specs.append(f"<strong>Weight:</strong> {product_data['weight']}")
    if product_data.get('dimensions'):
        specs.append(f"<strong>Dimensions:</strong> {product_data['dimensions']}")
    if product_data.get('category'):
        specs.append(f"<strong>Category:</strong> {product_data['category']}")
    
    if specs:
        spec_html = "<br>".join(specs)
        sections.append(f"<strong>Product Specifications:</strong><br>{spec_html}")
    
    # 3. Return Policy
    return_policy = (product_data.get('return_policy') or '').strip()
    if return_policy:
        # Format return policy with headers
        policy_lines = return_policy.split('\n')
        formatted_policy = []
        for line in policy_lines:
            line = line.strip()
            if line:
                # Remove leading numbers/bullets and format nicely
                clean_line = re.sub(r'^[\d\.\-\*\s]+', '', line).strip()
                if clean_line:
                    formatted_policy.append(f"• {clean_line}")
        if formatted_policy:
            sections.append(f"<strong>Return Policy:</strong><br>{'<br>'.join(formatted_policy)}")
    
    # 4. How to Use section (generic but professional)
    usage_instructions = (product_data.get('usage_instructions') or '').strip()
    if usage_instructions:
        sections.append(f"<strong>How to Use:</strong><br>{usage_instructions}")
    else:
        # Generate default usage instructions based on category
        default_usage = _get_default_usage_instructions(product_data.get('category', ''), product_data.get('name', ''))
        if default_usage:
            sections.append(f"<strong>How to Use:</strong><br>{default_usage}")
    
    # 5. Key Features
    features = []
    if product_data.get('is_fragile'):
        features.append("Fragile - Handle with Care")
    if product_data.get('is_temp_sensitive'):
        features.append("Temperature Sensitive")
    if product_data.get('is_featured'):
        features.append("Featured Product")
    if product_data.get('prepaid_only'):
        features.append("Prepaid Orders Only")
    
    if features:
        sections.append(f"<strong>Key Features:</strong><br>{'<br>'.join(f'• {f}' for f in features)}")
    
    # Join all sections with double line breaks
    return "<br><br>".join(sections)


def _get_default_usage_instructions(category, product_name):
    """Generate default usage instructions based on product category."""
    category_lower = (category or '').lower()
    
    if 'cover' in category_lower or 'case' in category_lower:
        return (
            "1. Clean your device surface thoroughly before application<br>"
            "2. Align the cover/case with your device's buttons and ports<br>"
            "3. Gently press from center outward to ensure proper fit<br>"
            "4. Check all cutouts align correctly with camera, charging port, and buttons"
        )
    elif 'screen' in category_lower or 'protector' in category_lower or 'glass' in category_lower:
        return (
            "1. Clean screen with provided alcohol wipe and microfiber cloth<br>"
            "2. Remove dust with dust removal sticker<br>"
            "3. Align protector with screen edges and cutouts<br>"
            "4. Press center and let adhesive spread naturally<br>"
            "5. Use squeegee to remove any bubbles"
        )
    elif 'charger' in category_lower or 'cable' in category_lower or 'power' in category_lower:
        return (
            "1. Connect the charger to a compatible power outlet<br>"
            "2. Use the provided cable or a certified cable for your device<br>"
            "3. Ensure secure connection at both ends<br>"
            "4. Do not use damaged cables or expose to water"
        )
    elif 'audio' in category_lower or 'headphone' in category_lower or 'earphone' in category_lower:
        return (
            "1. Charge fully before first use (if wireless)<br>"
            "2. Pair with your device via Bluetooth settings<br>"
            "3. Adjust fit for optimal comfort and sound isolation<br>"
            "4. Store in case when not in use to protect battery"
        )
    elif 'sticker' in category_lower or 'skin' in category_lower:
        return (
            "1. Clean surface with isopropyl alcohol and let dry<br>"
            "2. Peel backing slowly and align carefully<br>"
            "3. Apply from center outward using a card to remove bubbles<br>"
            "4. Press firmly for 30 seconds to ensure adhesion"
        )
    else:
        return (
            "1. Read all safety instructions before use<br>"
            "2. Use product as intended for best results<br>"
            "3. Keep away from water unless specified as water-resistant<br>"
            "4. Store in a cool, dry place when not in use"
        )

