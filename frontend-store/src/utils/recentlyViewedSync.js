/**
 * recentlyViewedSync — shared helper for keeping cached "recently viewed"
 * product snapshots in sync with the freshest catalog data.
 *
 * Why: recentlyViewed is persisted in localStorage with a full product
 * snapshot (including image URLs). When product images change server-side
 * (e.g. migrated from ephemeral local storage to permanent cloud URLs), the
 * cached paths go stale and cards render the text fallback instead of an
 * image. Merging each cached entry with the matching fresh catalog product by
 * id fixes the display while preserving the cached order (most-recent first).
 *
 * Entries with no match in the fresh list are returned unchanged, so deleted
 * or not-yet-loaded products never disappear.
 */

export function refreshRecentlyViewed(cachedList, freshProducts) {
  if (!Array.isArray(cachedList) || cachedList.length === 0) return cachedList
  if (!Array.isArray(freshProducts) || freshProducts.length === 0) return cachedList

  const freshMap = new Map(freshProducts.map((p) => [String(p?.id), p]))
  return cachedList
    .map((p) => freshMap.get(String(p?.id)) || p)
    .slice(0, 10)
}

export default refreshRecentlyViewed
