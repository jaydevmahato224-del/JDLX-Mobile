/**
 * ProductErrorState — error section with retry button.
 * Shown when hasError === true.
 *
 * Props:
 *   message  {string}    — human-readable error detail (from errorMessage)
 *   onRetry  {function}  — retryLoad() from useSmartProductLoader
 */

import React from 'react'
import { AlertCircle, RefreshCw, WifiOff } from 'lucide-react'

export default function ProductErrorState({ message, onRetry }) {
  const isNetworkError = message?.toLowerCase().includes('network error') || message?.toLowerCase().includes('failed to fetch');

  return (
    <div
      role="alert"
      className={`mt-6 flex flex-col items-center justify-center gap-6 rounded-[28px] border px-8 py-16 text-center transition-all duration-500 ${
        isNetworkError 
          ? 'border-amber-200 bg-amber-50 shadow-sm animate-in fade-in zoom-in duration-700' 
          : 'border-rose-200 bg-rose-50'
      }`}
    >
      <div className={`flex h-20 w-20 items-center justify-center rounded-full transition-transform duration-700 ${
        isNetworkError ? 'bg-amber-100 animate-pulse' : 'bg-rose-100'
      }`}>
        {isNetworkError ? (
          <WifiOff className="h-10 w-10 text-amber-500" strokeWidth={1.5} />
        ) : (
          <AlertCircle className="h-10 w-10 text-rose-500" strokeWidth={1.5} />
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-xl font-black text-slate-950">
          {isNetworkError ? "Connection Lost" : "Something went wrong"}
        </h3>
        <p className="max-w-sm text-sm font-medium text-slate-600">
          {message || (isNetworkError 
            ? "We can't reach our servers. Please check your internet connection."
            : "We couldn’t load the products. Please try again later.")
          }
        </p>
      </div>

      {typeof onRetry === 'function' && (
        <button
          type="button"
          onClick={onRetry}
          className={`inline-flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold transition active:scale-95 ${
            isNetworkError 
              ? 'bg-amber-500 text-white hover:bg-amber-600' 
              : 'bg-slate-950 text-amber-300 hover:bg-slate-800'
          }`}
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
      )}
    </div>
  )
}
