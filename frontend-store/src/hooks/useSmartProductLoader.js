/**
 * useSmartProductLoader Hook — v2
 *
 * Agent 1: Logic & State Integration
 * ─────────────────────────────────
 * Extended state flags (new):
 *   initialLoading   — true only on first-ever fetch (products.length === 0 AND !hasLoadedOnce)
 *   pageRefreshing   — true on explicit refresh AFTER first successful load
 *   paginationLoading — alias for loadingMore, exposed explicitly for Agent 2
 *   hasError         — boolean mirror of (error !== null)
 *   errorMessage     — human-readable error string
 *   isEmpty          — true when loaded but products.length === 0
 *   hasLoadedOnce    — true after first successful fetch; never reverts to false
 *
 * New actions (new):
 *   retryLoad()       — clear error and re-fetch current category without resetting hasLoadedOnce
 *   refreshProducts() — set pageRefreshing (not initialLoading) and re-fetch
 *
 * Flicker prevention:
 *   initialLoading stays true for a minimum of MIN_SKELETON_MS (250ms) to
 *   avoid a jarring flash when the API responds very fast from cache.
 *
 * Preserved (unchanged):
 *   loading, loadingMore, hasMore, currentPage, error,
 *   loadInitialProducts, loadMoreProducts, resetProducts, prefetchNextPages
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { API_BASE_URL } from '../config'
import productCache from '../utils/productCache'

const DEFAULT_PAGE_SIZE = 20
const PREFETCH_OFFSET = 2
const MIN_SKELETON_MS = 250 // minimum time to show initial skeleton (anti-flicker)

const scheduleIdleTask = (callback, timeout = 1500) => {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    return window.requestIdleCallback(callback, { timeout })
  }

  return window.setTimeout(() => callback(), 250)
}

const cancelIdleTask = (taskId) => {
  if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
    window.cancelIdleCallback(taskId)
    return
  }

  window.clearTimeout(taskId)
}

const shouldPrefetch = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false
  }

  if (window.matchMedia?.('(max-width: 768px)').matches) {
    return false
  }

  if (navigator.connection?.saveData) {
    return false
  }

  if (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 4) {
    return false
  }

  return true
}

export const useSmartProductLoader = (pageSize = DEFAULT_PAGE_SIZE) => {
  // ── Core data ──────────────────────────────────────────────────────────────
  const [products, setProducts] = useState([])
  const [currentPage, setCurrentPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  // ── Loading phase flags ────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true)           // legacy: true during initial fetch
  const [loadingMore, setLoadingMore] = useState(false)  // legacy: true during pagination fetch
  const [initialLoading, setInitialLoading] = useState(true)   // NEW: blank-page skeleton
  const [pageRefreshing, setPageRefreshing] = useState(false)  // NEW: soft refresh overlay

  // ── Error / empty ──────────────────────────────────────────────────────────
  const [error, setError] = useState(null)
  const [hasError, setHasError] = useState(false)          // NEW
  const [errorMessage, setErrorMessage] = useState('')     // NEW
  const [isEmpty, setIsEmpty] = useState(false)            // NEW

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)  // NEW: never reverts

  // ── Internal refs ─────────────────────────────────────────────────────────
  const isFetchingRef = useRef(false)
  const prefetchedPagesRef = useRef(new Set())
  const categoryRef = useRef(null)
  const searchQueryRef = useRef('')
  const skeletonTimerRef = useRef(null)   // anti-flicker timer
  const mountedRef = useRef(true)         // guard stale state updates after unmount
  const idleTaskIdsRef = useRef(new Set())

  useEffect(() => {
    mountedRef.current = true
    const pendingIdleTasks = idleTaskIdsRef.current

    return () => {
      mountedRef.current = false
      if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current)
      pendingIdleTasks.forEach((taskId) => cancelIdleTask(taskId))
      pendingIdleTasks.clear()
    }
  }, [])

  // ── Helper: clear skeleton after MIN_SKELETON_MS ──────────────────────────
  const clearInitialLoadingAfterDelay = useCallback((startTime) => {
    const elapsed = Date.now() - startTime
    const remaining = Math.max(0, MIN_SKELETON_MS - elapsed)
    skeletonTimerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        setInitialLoading(false)
        setLoading(false)
      }
    }, remaining)
  }, [])

  // ── URL builder ───────────────────────────────────────────────────────────
  const buildProductsUrl = useCallback(
    (categoryId = null, page = 1, searchQuery = '', storeId = null) => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
      })
      if (categoryId && categoryId !== 'All') params.set('category_id', String(categoryId))
      if (storeId) params.set('store_id', String(storeId))
      
      if (searchQuery && searchQuery.trim()) {
        params.set('q', searchQuery.trim())
        return `${API_BASE_URL}/products/search?${params.toString()}`
      }
      
      return `${API_BASE_URL}/products?${params.toString()}`
    },
    [pageSize]
  )

  // ── Core fetch ────────────────────────────────────────────────────────────
  /**
   * @param {string|null} categoryId
   * @param {number}      page
   * @param {boolean}     replace   true = first/category-switch fetch; false = load-more
   * @param {boolean}     asRefresh true = user-initiated refresh (pageRefreshing mode)
   * @param {string}      searchQuery
   * @param {number|null} storeId
   */
  const fetchProductsData = useCallback(
    async (categoryId = null, page = 1, replace = false, asRefresh = false, searchQuery = '', storeId = null) => {
      // Prevent concurrent requests (allow override for replace)
      if (isFetchingRef.current && !replace) return

      isFetchingRef.current = true
      const fetchStart = Date.now()

      // ── Set loading phase flags ──────────────────────────────────────────
      if (replace) {
        if (asRefresh) {
          // Refresh: keep existing products visible, show soft indicator
          setPageRefreshing(true)
          setLoading(false)
        } else {
          // Pure initial or category-switch load
          if (!hasLoadedOnce) {
            setInitialLoading(true)
          } else {
            setPageRefreshing(true)
          }
          setLoading(true)
        }
      } else {
        // Pagination
        setLoadingMore(true)
      }

      // Clear previous error
      setError(null)
      setHasError(false)
      setErrorMessage('')
      setIsEmpty(false)

      try {
        const url = buildProductsUrl(categoryId, page, searchQuery, storeId)
        const params = { page: String(page), limit: String(pageSize) }
        if (categoryId && categoryId !== 'All') params.category_id = String(categoryId)
        if (searchQuery) params.q = searchQuery
        if (storeId) params.store_id = String(storeId)

        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`Server error ${response.status}: ${response.statusText}`)
        }
        const data = await response.json()

        if (!mountedRef.current) return

        const nextBatch = Array.isArray(data) ? data : []

        setProducts((prev) => {
          if (replace) return nextBatch
          const existingIds = new Set(prev.map((item) => item.id))
          const deduped = nextBatch.filter((item) => !existingIds.has(item.id))
          return [...prev, ...deduped]
        })

        setCurrentPage(page)
        setHasMore(nextBatch.length === pageSize)
        setIsEmpty(nextBatch.length === 0)

        // Mark as successfully loaded at least once
        setHasLoadedOnce(true)

        return nextBatch
      } catch (err) {
        if (!mountedRef.current) return
        console.error('useSmartProductLoader: fetch error', err)
        const msg = err?.message || 'Failed to load products. Please try again.'
        setError(msg)
        setHasError(true)
        setErrorMessage(msg)
        if (replace) setProducts([])
        setHasMore(false)
      } finally {
        if (mountedRef.current) {
          if (replace && !hasLoadedOnce) {
            // Anti-flicker: hold skeleton for at least MIN_SKELETON_MS
            clearInitialLoadingAfterDelay(fetchStart)
          } else {
            setInitialLoading(false)
            setLoading(false)
          }
          setLoadingMore(false)
          setPageRefreshing(false)
        }
        isFetchingRef.current = false
      }
    },
    [buildProductsUrl, pageSize, hasLoadedOnce, clearInitialLoadingAfterDelay]
  )

  // ── Prefetch ──────────────────────────────────────────────────────────────
  const prefetchNextPages = useCallback(
    (categoryId = null, page = 1, searchQuery = '', storeId = null) => {
      if (!shouldPrefetch()) {
        return
      }

      for (let i = 1; i <= PREFETCH_OFFSET; i++) {
        const prefetchPage = page + i
        const pageKey = `${categoryId}:${prefetchPage}:${searchQuery}:${storeId}`

        if (!prefetchedPagesRef.current.has(pageKey) && prefetchedPagesRef.current.size < 10) {
          prefetchedPagesRef.current.add(pageKey)

          const taskId = scheduleIdleTask(
            async () => {
              try {
                const url = buildProductsUrl(categoryId, prefetchPage, searchQuery, storeId)
                const params = { page: String(prefetchPage), limit: String(pageSize) }
                if (categoryId && categoryId !== 'All') params.category_id = String(categoryId)
                if (searchQuery) params.q = searchQuery
                if (storeId) params.store_id = String(storeId)

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
                console.debug('prefetchNextPages: error', err)
              } finally {
                idleTaskIdsRef.current.delete(taskId)
              }
            },
            2000
          )

          idleTaskIdsRef.current.add(taskId)
        }
      }
    },
    [buildProductsUrl, pageSize]
  )

  // ── Public actions ────────────────────────────────────────────────────────

  const storeIdRef = useRef(null)

  /** Load initial products for a category (or all). Triggers initialLoading or pageRefreshing. */
  const loadInitialProducts = useCallback(
    (categoryId = null, searchQuery = '', storeId = null) => {
      categoryRef.current = categoryId
      searchQueryRef.current = searchQuery
      storeIdRef.current = storeId
      prefetchedPagesRef.current.clear()
      return fetchProductsData(categoryId, 1, true, false, searchQuery, storeId)
    },
    [fetchProductsData]
  )

  /** Reset state and reload (category switch). */
  const resetProducts = useCallback(
    (categoryId = null, storeId = null) => {
      setProducts([])
      setCurrentPage(1)
      setHasMore(true)
      prefetchedPagesRef.current.clear()
      return loadInitialProducts(categoryId, searchQueryRef.current, storeId)
    },
    [loadInitialProducts]
  )

  /** Load more products (infinite scroll / pagination). */
  const loadMoreProducts = useCallback(async () => {
    if (!hasMore || isFetchingRef.current) return
    const nextPage = currentPage + 1
    await fetchProductsData(categoryRef.current, nextPage, false, false, searchQueryRef.current, storeIdRef.current)
    prefetchNextPages(categoryRef.current, nextPage, searchQueryRef.current, storeIdRef.current)
  }, [currentPage, hasMore, fetchProductsData, prefetchNextPages])

  /**
   * NEW: Retry after error — re-runs last fetch, does NOT reset hasLoadedOnce.
   */
  const retryLoad = useCallback(() => {
    return fetchProductsData(categoryRef.current, 1, true, false, searchQueryRef.current, storeIdRef.current)
  }, [fetchProductsData])

  /**
   * NEW: Explicit user-initiated refresh — shows pageRefreshing (not initialLoading).
   * Existing products remain visible while refreshing.
   */
  const refreshProducts = useCallback(() => {
    return fetchProductsData(categoryRef.current, 1, true, true, searchQueryRef.current, storeIdRef.current)
  }, [fetchProductsData])

  // ── Derived / convenience ─────────────────────────────────────────────────
  const paginationLoading = loadingMore

  return {
    // ── Data ──
    products,
    currentPage,
    hasMore,

    // ── Loading phases ─────────────── Agent 2 consumes these ──
    initialLoading,     // show blank-page skeleton
    pageRefreshing,     // show soft top refresh indicator
    paginationLoading,  // show bottom load-more spinner
    loading,            // legacy compat

    // ── Error / empty ─────────────── Agent 2 consumes these ──
    hasError,
    errorMessage,
    isEmpty,
    error,              // legacy compat

    // ── Lifecycle ─────────────────── Agent 2 consumes these ──
    hasLoadedOnce,      // skip skeleton on tab revisit

    // ── Actions ───────────────────────────────────────────────
    loadInitialProducts,
    loadMoreProducts,
    resetProducts,
    prefetchNextPages,
    retryLoad,          // NEW: retry after error
    refreshProducts,    // NEW: soft refresh keeping products visible
  }
}

export default useSmartProductLoader
