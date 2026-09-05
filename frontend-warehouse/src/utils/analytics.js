/**
 * Google Analytics 4 (GA4) Utility
 * Measurement ID: G-LERBDVK409
 */

export const GA_MEASUREMENT_ID = 'G-LERBDVK409';

/**
 * Initialize gtag if it doesn't exist
 */
const initGtag = () => {
  if (typeof window !== 'undefined' && !window.gtag) {
    window.dataLayer = window.dataLayer || [];
    function gtag() {
      window.dataLayer.push(arguments);
    }
    window.gtag = gtag;
  }
};

/**
 * Track a page view
 * @param {string} path - The page path (e.g., /cart)
 * @param {string} title - The page title
 */
export const trackPageView = (path, title) => {
  initGtag();
  if (typeof window.gtag === 'function') {
    window.gtag('config', GA_MEASUREMENT_ID, {
      page_path: path,
      page_title: title || document.title,
    });
  }
};

/**
 * Track a custom event
 * @param {string} action - Event action
 * @param {object} params - Event parameters
 */
export const trackEvent = (action, params = {}) => {
  initGtag();
  if (typeof window.gtag === 'function') {
    window.gtag('event', action, params);
  }
};

/**
 * Track Product View
 * @param {object} product - Product object
 */
export const trackViewItem = (product) => {
  if (!product) return;
  trackEvent('view_item', {
    currency: 'INR',
    value: product.price,
    items: [
      {
        item_id: String(product.id),
        item_name: product.name,
        item_category: product.category,
        price: product.price,
        quantity: 1
      }
    ]
  });
};

/**
 * Track Add to Cart
 * @param {object} product - Product object
 * @param {number} quantity - Quantity added
 */
export const trackAddToCart = (product, quantity = 1) => {
  if (!product) return;
  trackEvent('add_to_cart', {
    currency: 'INR',
    value: product.price * quantity,
    items: [
      {
        item_id: String(product.id),
        item_name: product.name,
        item_category: product.category,
        price: product.price,
        quantity: quantity
      }
    ]
  });
};

/**
 * Track Remove from Cart
 * @param {object} product - Product object
 * @param {number} quantity - Quantity removed
 */
export const trackRemoveFromCart = (product, quantity = 1) => {
  if (!product) return;
  trackEvent('remove_from_cart', {
    currency: 'INR',
    value: product.price * quantity,
    items: [
      {
        item_id: String(product.id),
        item_name: product.name,
        item_category: product.category,
        price: product.price,
        quantity: quantity
      }
    ]
  });
};

/**
 * Track Begin Checkout
 * @param {Array} cartItems - Array of products in cart
 * @param {number} totalValue - Total cart value
 */
export const trackBeginCheckout = (cartItems, totalValue) => {
  if (!cartItems || cartItems.length === 0) return;
  trackEvent('begin_checkout', {
    currency: 'INR',
    value: totalValue,
    items: cartItems.map(item => ({
      item_id: String(item.id),
      item_name: item.name,
      item_category: item.category,
      price: item.price,
      quantity: item.qty || 1
    }))
  });
};

/**
 * Track Purchase
 * @param {string} transactionId - Order ID
 * @param {number} totalValue - Total order value
 * @param {Array} cartItems - Items purchased
 */
export const trackPurchase = (transactionId, totalValue, cartItems) => {
  if (!cartItems || cartItems.length === 0) return;
  trackEvent('purchase', {
    transaction_id: transactionId,
    currency: 'INR',
    value: totalValue,
    items: cartItems.map(item => ({
      item_id: String(item.id),
      item_name: item.name,
      item_category: item.category,
      price: item.price,
      quantity: item.qty || 1
    }))
  });
};
