/**
 * ProductErrorState — error section with retry button.
 * Shown when hasError === true.
 *
 * Props:
 *   message  {string}    — human-readable error detail (from errorMessage)
 *   onRetry  {function}  — retryLoad() from useSmartProductLoader
 */

import React from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

export default function ProductErrorState({ message, onRetry }) {
  return (
    <div
      role="alert"
      className="mt-6 flex flex-col items-center justify-center gap-6 rounded-[28px] border border-rose-200 bg-rose-50 px-8 py-16 text-center"
    >
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-rose-100">
        <AlertCircle className="h-10 w-10 text-rose-500" strokeWidth={1.5} />
      </div>

      <div className="space-y-2">
        <h3 className="text-xl font-black text-slate-950">Something went wrong</h3>
        <p className="max-w-sm text-sm font-medium text-slate-600">
          {message || "We couldn\u2019t load the products. Check your connection and try again."}

        </p>
      </div>

      {typeof onRetry === 'function' && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-6 py-3 text-sm font-bold text-amber-300 transition hover:bg-slate-800 active:scale-95"
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
      )}
    </div>
  )
}
