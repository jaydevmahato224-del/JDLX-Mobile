/**
 * ProductEmptyState — friendly empty state panel.
 * Shown when isEmpty === true (fetch succeeded but returned 0 products).
 *
 * Props:
 *   hasActiveFilters  {boolean}   — whether search/category/stock filters are active
 *   onClearFilters    {function}  — optional callback to clear filters
 */

import React from 'react'
import { PackageSearch } from 'lucide-react'

export default function ProductEmptyState({ hasActiveFilters = false, onClearFilters }) {
  return (
    <div className="card-standard flex flex-col items-center justify-center gap-6 py-16 text-center border-dashed bg-transparent shadow-none">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-100/50 border border-slate-200">
        <PackageSearch className="h-10 w-10 text-slate-400" strokeWidth={1.5} />
      </div>

      <div className="space-y-3">
        <h2 className="mb-0 text-2xl font-extrabold tracking-tight text-slate-900">
          {hasActiveFilters ? 'No products match' : 'Empty catalog'}
        </h2>
        <p className="max-w-xs mx-auto text-base font-medium text-slate-500 leading-relaxed">
          {hasActiveFilters
            ? 'Try adjusting your filters or search keywords to find what you need.'
            : 'We couldn\'t find any products in this section. Please check back later.'}
        </p>
      </div>

      {hasActiveFilters && typeof onClearFilters === 'function' && (
        <button
          type="button"
          onClick={onClearFilters}
          className="btn-primary"
          style={{ height: '48px', padding: '0 24px' }}
        >
          Clear all filters
        </button>
      )}
    </div>
  )
}
