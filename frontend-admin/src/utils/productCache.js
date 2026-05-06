/**
 * Product Cache Service
 * Manages caching of product data, search results, and category products
 * Prevents duplicate API requests and improves page load speed
 */

const CACHE_EXPIRATION_TIME = 5 * 60 * 1000; // 5 minutes

class ProductCache {
  constructor() {
    this.cache = new Map();
    this.timestamps = new Map();
    this.requestQueue = new Map();
  }

  /**
   * Generate cache key from parameters
   */
  generateKey(endpoint, params) {
    const queryString = new URLSearchParams(params)
      .toString()
      .split('&')
      .sort()
      .join('&');
    return `${endpoint}:${queryString}`;
  }

  /**
   * Check if cache is still valid
   */
  isCacheValid(key) {
    const timestamp = this.timestamps.get(key);
    if (!timestamp) return false;
    return Date.now() - timestamp < CACHE_EXPIRATION_TIME;
  }

  /**
   * Get cached data if valid
   */
  get(endpoint, params) {
    const key = this.generateKey(endpoint, params);
    if (this.isCacheValid(key)) {
      return this.cache.get(key);
    }
    // Clear expired cache
    this.cache.delete(key);
    this.timestamps.delete(key);
    return null;
  }

  /**
   * Set cache with timestamp
   */
  set(endpoint, params, data) {
    const key = this.generateKey(endpoint, params);
    this.cache.set(key, data);
    this.timestamps.set(key, Date.now());
    return key;
  }

  /**
   * Deduplicate concurrent requests for same endpoint
   * Returns a promise that resolves when any pending request completes
   */
  async deduplicateRequest(endpoint, params, fetchFn) {
    const key = this.generateKey(endpoint, params);

    // If we already have a pending request for this key, wait for it
    if (this.requestQueue.has(key)) {
      return this.requestQueue.get(key);
    }

    // Create a new request promise
    const requestPromise = fetchFn()
      .then((data) => {
        this.set(endpoint, params, data);
        return data;
      })
      .finally(() => {
        // Remove from pending queue when done
        this.requestQueue.delete(key);
      });

    // Add to pending queue to deduplicate concurrent requests
    this.requestQueue.set(key, requestPromise);
    return requestPromise;
  }

  /**
   * Clear all cache
   */
  clear() {
    this.cache.clear();
    this.timestamps.clear();
  }

  /**
   * Clear cache for specific endpoint
   */
  clearEndpoint(endpoint) {
    const keysToDelete = Array.from(this.cache.keys()).filter((key) =>
      key.startsWith(`${endpoint}:`)
    );
    keysToDelete.forEach((key) => {
      this.cache.delete(key);
      this.timestamps.delete(key);
    });
  }

  /**
   * Get cache size for debugging
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      pendingRequests: this.requestQueue.size,
      entries: Array.from(this.cache.keys()),
    };
  }

  /**
   * Set cache expiration time (in milliseconds)
   */
  setExpirationTime(time) {
    this.expirationTime = time;
  }
}

// Create singleton instance
export const productCache = new ProductCache();

export default productCache;
