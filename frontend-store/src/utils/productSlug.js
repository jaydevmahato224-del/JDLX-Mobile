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
    if (import.meta.env.DEV && !window.location.hostname.includes('localhost')) {
      console.warn("[SECURITY ASSERTION] Missing share_token for product ID:", product.id);
    }
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

/**
 * Generates a short share URL using the product's share token.
 * Returns /s/token format for shorter, cleaner sharing links.
 * Perfect for WhatsApp, Telegram, and other social platforms.
 * 
 * @param {Object} product - The product object
 * @param {string} origin - The site origin (optional)
 * @returns {string} The short share URL
 */
export const getProductShareUrl = (product, origin = '') => {
  if (!product || !product.share_token) {
    // Fallback to full product URL if share token is missing
    return getProductUrl(product, origin);
  }
  return `${origin}/s/${product.share_token}`;
};
