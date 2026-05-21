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
  
  const nameSlug = (product.name || 'product')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
    
  const token = product.share_token || '';
  
  return token ? `${nameSlug}-${token}` : nameSlug;
};

/**
 * Generates a full product URL using the secure slug system.
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
