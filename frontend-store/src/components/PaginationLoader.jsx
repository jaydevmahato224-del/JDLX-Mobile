/**
 * PaginationLoader — bottom load-more spinner displayed during infinite scroll.
 * Stays below existing product grid, never replaces loaded cards.
 */

import React from 'react'

export default function PaginationLoader() {
  return (
    <div
      className="flex items-center justify-center gap-3 py-10"
      role="status"
      aria-label="Loading more products"
    >
      <span className="inline-block h-5 w-5 animate-spin rounded-full border-[3px] border-slate-300 border-t-amber-400" />
      <span className="text-sm font-semibold text-slate-500">Loading more products…</span>
    </div>
  )
}
