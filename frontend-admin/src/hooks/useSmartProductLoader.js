/**
 * useSmartProductLoader Hook
 * Implements intelligent product loading with prefetching and batching
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { API_BASE_URL } from '../config'
import productCache from '../utils/productCache'

const DEFAULT_PAGE_SIZE = 20
const PREFETCH_THRESHOLD = 300 // Start prefetching when 300px away from viewport
const PREFETCH_OFFSET = 2 // Prefetch 2 pages ahead

export const useSmartProductLoader = (pageSize = DEFAULT_PAGE_SIZE) => {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [error, setError] = useState(null)

  // Refs for managing state without re-renders
  const isFetchingRef = useRef(false)
  const prefetchedPagesRef = useRef(new Set())
  const categoryRef = useRef(null)

  /**
   * Build product fetch URL with parameters
   */
  const buildProductsUrl = useCallback(
    (categoryId = null, page = 1) => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
      })
      if (categoryId) {
        params.set('category_id', String(categoryId))
      }
      return `${API_BASE_URL}/products?${params.toString()}`
    },
    [pageSize]
  )

  /**
   * Fetch products from API with caching & deduplication
   */
  const fetchProductsData = useCallback(
    async (categoryId = null, page = 1, replace = false) => {
      // Prevent concurrent requests
      if (isFetchingRef.current && !replace) {
        return
      }

      isFetchingRef.current = true
      if (replace) {
        setLoading(true)
      } else {
        setLoadingMore(true)
      }
      setError(null)

      try {
        const url = buildProductsUrl(categoryId, page)
        const params = { page: String(page), limit: String(pageSize) }
        if (categoryId) {
          params.category_id = String(categoryId)
        }

        // Use cache with request deduplication
        const data = await productCache.deduplicateRequest(
          '/products',
          params,
          async () => {
            const response = await fetch(url)
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`)
            }
            return response.json()
          }
        )

        const nextBatch = Array.isArray(data) ? data : []

        setProducts((prev) => {
          if (replace) {
            return nextBatch
          }
          // Deduplicate products by ID
          const existingIds = new Set(prev.map((item) => item.id))
          const deduped = nextBatch.filter((item) => !existingIds.has(item.id))
          return [...prev, ...deduped]
        })

        setCurrentPage(page)
        setHasMore(nextBatch.length === pageSize)
        return nextBatch
      } catch (err) {
        console.error('Error fetching products:', err)
        setError(err.message)
        if (replace) {
          setProducts([])
        }
        setHasMore(false)
      } finally {
        setLoading(false)
        setLoadingMore(false)
        isFetchingRef.current = false
      }
    },
    [buildProductsUrl, pageSize]
  )

  /**
   * Prefetch next pages in background
   */
  const prefetchNextPages = useCallback(
    (categoryId = null, page = 1) => {
      // Prefetch the next batch asynchronously without blocking UI
      for (let i = 1; i <= PREFETCH_OFFSET; i++) {
        const prefetchPage = page + i
        const pageKey = `${categoryId}:${prefetchPage}`

        if (!prefetchedPagesRef.current.has(pageKey) && prefetchedPagesRef.current.size < 10) {
          prefetchedPagesRef.current.add(pageKey)

          // Schedule prefetch for next animation frame to not block current rendering
          requestIdleCallback(
            async () => {
              try {
                const url = buildProductsUrl(categoryId, prefetchPage)
                const params = { page: String(prefetchPage), limit: String(pageSize) }
                if (categoryId) {
                  params.category_id = String(categoryId)
                }

                // Just prime the cache, don't set state
                await productCache.deduplicateRequest(
                  '/products',
                  params,
                  async () => {
                    const response = await fetch(url)
                    if (!response.ok) return []
                    return response.json()
                  }
                )
              } catch (err) {
                console.debug('Prefetch error:', err)
              }
            },
            { timeout: 2000 }
          )
        }
      }
    },
    [buildProductsUrl, pageSize]
  )

  /**
   * Load initial products
   */
  const loadInitialProducts = useCallback(
    (categoryId = null) => {
      categoryRef.current = categoryId
      prefetchedPagesRef.current.clear()
      return fetchProductsData(categoryId, 1, true)
    },
    [fetchProductsData]
  )

  /**
   * Load more products (for infinite scroll)
   */
  const loadMoreProducts = useCallback(async () => {
    if (!hasMore || isFetchingRef.current) {
      return
    }
    const nextPage = currentPage + 1
    await fetchProductsData(categoryRef.current, nextPage, false)
    prefetchNextPages(categoryRef.current, nextPage)
  }, [currentPage, hasMore, fetchProductsData, prefetchNextPages])

  /**
   * Reset products when category changes
   */
  const resetProducts = useCallback(
    (categoryId = null) => {
      setProducts([])
      setCurrentPage(1)
      setHasMore(true)
      prefetchedPagesRef.current.clear()
      return loadInitialProducts(categoryId)
    },
    [loadInitialProducts]
  )

  return {
    products,
    loading,
    loadingMore,
    hasMore,
    currentPage,
    error,
    loadInitialProducts,
    loadMoreProducts,
    resetProducts,
    prefetchNextPages,
  }
}

export default useSmartProductLoader
