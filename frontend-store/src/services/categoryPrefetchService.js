/**
 * Category Prefetch Service
 * Prefetches product data for categories when user hovers/taps them
 * Ensures instant loading when category is opened
 */

import { API_BASE_URL } from '../config'
import productCache from '../utils/productCache'

class CategoryPrefetchService {
  constructor() {
    this.prefetchQueue = new Map()
    this.prefetchTimeout = new Map()
  }

  /**
   * Prefetch products for a specific category
   */
  async prefetchCategory(categoryId, pageSize = 20) {
    const cacheKey = `category:${categoryId}:1`

    // Check if already cached
    if (productCache.get('/products', { category_id: String(categoryId), page: '1', limit: String(pageSize) })) {
      return
    }

    // Check if already prefetching
    if (this.prefetchQueue.has(cacheKey)) {
      return this.prefetchQueue.get(cacheKey)
    }

    const prefetchPromise = this.fetchAndCache(categoryId, pageSize)
    this.prefetchQueue.set(cacheKey, prefetchPromise)

    return prefetchPromise
  }

  /**
   * Fetch and cache category products
   */
  async fetchAndCache(categoryId, pageSize = 20) {
    try {
      const url = `${API_BASE_URL}/products?category_id=${categoryId}&page=1&limit=${pageSize}`
      const params = { category_id: String(categoryId), page: '1', limit: String(pageSize) }

      const data = await productCache.deduplicateRequest('/products', params, async () => {
        const response = await fetch(url)
        if (!response.ok) return []
        return response.json()
      })

      // Prefetch next page as well
      this.prefetchNextPage(categoryId, pageSize)

      return data
    } catch (error) {
      console.debug('Category prefetch error:', error)
      return []
    }
  }

  /**
   * Prefetch next page for a category
   */
  async prefetchNextPage(categoryId, pageSize = 20, page = 2) {
    try {
      const url = `${API_BASE_URL}/products?category_id=${categoryId}&page=${page}&limit=${pageSize}`
      const params = { category_id: String(categoryId), page: String(page), limit: String(pageSize) }

      await productCache.deduplicateRequest('/products', params, async () => {
        const response = await fetch(url)
        if (!response.ok) return []
        return response.json()
      })
    } catch (error) {
      console.debug('Next page prefetch error:', error)
    }
  }

  /**
   * Prefetch with debouncing (call when hovering over category)
   */
  prefetchWithDebounce(categoryId, pageSize = 20, delayMs = 200) {
    const cacheKey = `category:${categoryId}:1`

    // Clear existing timeout
    if (this.prefetchTimeout.has(cacheKey)) {
      clearTimeout(this.prefetchTimeout.get(cacheKey))
    }

    // Set new timeout for prefetch
    const timeoutId = setTimeout(() => {
      this.prefetchCategory(categoryId, pageSize)
      this.prefetchTimeout.delete(cacheKey)
    }, delayMs)

    this.prefetchTimeout.set(cacheKey, timeoutId)
  }

  /**
   * Cancel pending prefetch for a category
   */
  cancelPrefetch(categoryId) {
    const cacheKey = `category:${categoryId}:1`
    if (this.prefetchTimeout.has(cacheKey)) {
      clearTimeout(this.prefetchTimeout.get(cacheKey))
      this.prefetchTimeout.delete(cacheKey)
    }
  }

  /**
   * Prefetch all categories products for faster browsing
   */
  async prefetchAllCategories(categories, pageSize = 20) {
    const prefetchPromises = categories
      .filter((cat) => cat.id)
      .map((cat) => this.prefetchCategory(cat.id, pageSize))

    try {
      await Promise.allSettled(prefetchPromises)
    } catch (error) {
      console.debug('All categories prefetch error:', error)
    }
  }

  /**
   * Get prefetch statistics for debugging
   */
  getStats() {
    return {
      queueSize: this.prefetchQueue.size,
      pendingTimeouts: this.prefetchTimeout.size,
    }
  }

  /**
   * Clear all prefetch data
   */
  clear() {
    this.prefetchQueue.clear()
    this.prefetchTimeout.forEach((timeoutId) => clearTimeout(timeoutId))
    this.prefetchTimeout.clear()
  }
}

// Create singleton instance
export const categoryPrefetchService = new CategoryPrefetchService()

export default categoryPrefetchService
