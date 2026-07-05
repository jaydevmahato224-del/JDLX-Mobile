import toast from 'react-hot-toast';
import { getProductShareUrl } from './productSlug';

/**
 * Shares product details using the Web Share API with a clipboard fallback.
 * Safe for SSR and React environments.
 * 
 * @param {Object} product - The product object to share.
 * @param {number|string} product.price - Price of the product.
 * @param {string} [customUrl] - Optional custom URL to share. Defaults to secure getProductShareUrl.
 */
export const shareProduct = async (product, customUrl = null) => {
  // SSR Safety Check
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const origin = window.location.origin;
  const url = customUrl || getProductShareUrl(product, origin);
  const premiumText = `Check out ${product.name} for just ₹${product.price} on JDLX - Premium Mobile Essentials. ✨`;
  
  const shareData = {
    title: product.name,
    text: premiumText,
    url: url,
  };

  try {
    // Check if Web Share API is supported and can share the data
    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      await navigator.share(shareData);
      return true;
    }
    return false;
  } catch (err) {
    // Ignore AbortError (user cancelled share)
    if (err.name === 'AbortError') return true;

    console.error('Native share failed:', err);
    return false;
  }
};
