/**
 * PageLoader — Full-page loading screen
 * Used as Suspense fallback for route-level lazy loading.
 * Designed to match the JDLX app theme exactly.
 */

import React, { useEffect, useState } from 'react'
import './PageLoader.css'

const TAGLINES = [
  'Fetching the best picks for you…',
  'Loading your customized portal…',
  'Preparing your dashboard experience…',
  'Almost there, hold tight…',
]

export default function PageLoader() {
  const [tagline, setTagline] = useState(TAGLINES[0])
  const [dotCount, setDotCount] = useState(1)

  // Cycle taglines every 1.8s
  useEffect(() => {
    let idx = 0
    const id = setInterval(() => {
      idx = (idx + 1) % TAGLINES.length
      setTagline(TAGLINES[idx])
    }, 1800)
    return () => clearInterval(id)
  }, [])

  // Animate dots 1 → 2 → 3 → 1
  useEffect(() => {
    const id = setInterval(() => {
      setDotCount((prev) => (prev >= 3 ? 1 : prev + 1))
    }, 420)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="page-loader" role="status" aria-label="Loading page">
      {/* Background blobs */}
      <div className="pl-blob pl-blob--1" aria-hidden="true" />
      <div className="pl-blob pl-blob--2" aria-hidden="true" />

      <div className="pl-card">
        {/* Animated logo mark */}
        <div className="pl-logo" aria-hidden="true">
          <div className="pl-logo__ring pl-logo__ring--outer" />
          <div className="pl-logo__ring pl-logo__ring--inner" />
          <div className="pl-logo__core">
            <span className="pl-logo__text">JD</span>
          </div>
        </div>

        {/* Brand name */}
        <div className="pl-brand">
          <span className="pl-brand__jdlx">JDLX</span>
          <span className="pl-brand__mobile">MOBILE</span>
        </div>

        {/* Progress bar */}
        <div className="pl-bar" aria-hidden="true">
          <div className="pl-bar__fill" />
        </div>

        {/* Tagline */}
        <p className="pl-tagline" key={tagline}>
          {tagline}
          <span className="pl-dots" aria-hidden="true">
            {'.'.repeat(dotCount)}
          </span>
        </p>
      </div>
    </div>
  )
}
