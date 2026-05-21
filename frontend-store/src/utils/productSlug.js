/**
 * Generates a luxury, SEO-friendly slug for a product.
 * Format: [clean-name]-[share-token]
 * Example: iphone-15-pro-max-case-Ag9Kx2Pq7R
 * 
 * @param {Object} product - The product object
 * @returns {string} The generated slug
 */
export const generateProductSlug = (product) => {
  if (!product) return '';
  
  // Use existing seo_slug from backend if available, otherwise generate dynamically
  const nameSlug = product.seo_slug || (product.name || 'product')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
    
  const token = product.share_token;
  
  if (!token) {
    console.error("[SECURITY ASSERTION] Missing share_token for product ID:", product.id);
    // Use ID as fallback token if share_token is missing (backend handles this as last resort)
    return `${nameSlug}-${product.id || 'unknown'}`;
  }
  
  return `${nameSlug}-${token}`;
};

/**
 * Generates a full product URL using the secure slug system.
 * ALWAYS returns /p/slug-token format.
 * 
 * @param {Object} product - The product object
 * @param {string} origin - The site origin (optional)
 * @returns {string} The full product URL
 */
export const getProductUrl = (product, origin = '') => {
  if (!product) return origin || '/';
  const slug = generateProductSlug(product);
  return `${origin}/p/${slug}`;
};
