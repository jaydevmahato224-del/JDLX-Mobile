/**
 * ProductEmptyState — friendly empty state panel.
 * Shown when isEmpty === true (fetch succeeded but returned 0 products).
 *
 * Props:
 *   hasActiveFilters  {boolean}   — whether search/category/stock filters are active
 *   onClearFilters    {function}  — optional callback to clear filters
 */

import React from 'react'
import { PackageSearch, ArrowRight, RefreshCw, ShoppingBag } from 'lucide-react'

export default function ProductEmptyState({ hasActiveFilters = false, onClearFilters }) {
  return (
    <div className="relative flex flex-col items-center justify-center py-20 px-6 text-center animate-in fade-in zoom-in duration-700">
      {/* Background Decorative Element */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-primary/5 rounded-full blur-[80px] pointer-events-none" />

      <div className="relative glass-card max-w-sm w-full py-12 flex flex-col items-center gap-8 shadow-2xl border-white/10">
        {/* Icon with Premium Glow */}
        <div className="relative">
          <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full scale-125" />
          <div className="relative w-20 h-20 bg-gradient-to-br from-primary to-primary-container rounded-[28px] flex items-center justify-center text-slate-950 shadow-xl rotate-6 transition-transform hover:rotate-12 duration-500">
            <PackageSearch className="h-10 w-10" strokeWidth={2.5} />
          </div>
        </div>

        <div className="space-y-3 px-4">
          <h2 className="text-2xl font-black tracking-tighter text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {hasActiveFilters ? 'No matches found' : 'Nothing here yet'}
          </h2>
          <p className="max-w-[280px] mx-auto text-sm font-medium text-[var(--color-on-surface-variant)] leading-relaxed">
            {hasActiveFilters
              ? "We couldn't find any products matching your current filters. Try refining your search."
              : "We're currently updating this collection. Please check back later for new arrivals."}
          </p>
        </div>

        {hasActiveFilters && typeof onClearFilters === 'function' && (
          <div className="w-full px-8">
            <button
              type="button"
              onClick={onClearFilters}
              className="btn-primary h-14 w-full text-[11px] font-black uppercase tracking-[0.2em] shadow-xl shadow-primary/20 flex items-center justify-center gap-2 group"
            >
              Reset Filters
              <RefreshCw size={16} className="group-hover:rotate-180 transition-transform duration-500" />
            </button>
          </div>
        )}

        {!hasActiveFilters && (
          <div className="w-full px-8">
            <button
              onClick={() => window.location.href = '/'}
              className="btn-primary h-14 w-full text-[11px] font-black uppercase tracking-[0.2em] shadow-xl shadow-primary/20 flex items-center justify-center gap-2"
            >
              Back to Home
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Subtle branding */}
      <div className="mt-12 flex items-center gap-3 opacity-20">
        <div className="h-px w-6 bg-current" />
        <span className="text-[10px] font-black uppercase tracking-[0.3em]">JDLX Catalog</span>
        <div className="h-px w-6 bg-current" />
      </div>
    </div>
  )
}
