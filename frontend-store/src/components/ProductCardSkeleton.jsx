/**
 * ProductCardSkeleton — shimmer placeholder matching real ProductCard layout
 * Used by ProductLoadingGrid during initial product fetch.
 */

import React from 'react'
import './ProductCardSkeleton.css'

export default function ProductCardSkeleton() {
  return (
    <article className="pcs-card" aria-hidden="true">
      {/* Image region */}
      <div className="pcs-image-region">
        <div className="pcs-badge-row">
          <span className="pcs-shimmer pcs-badge-pill" />
          <span className="pcs-shimmer pcs-badge-pill pcs-badge-pill--short" />
        </div>
        <div className="pcs-shimmer pcs-image-block" />
      </div>

      {/* Content region */}
      <div className="pcs-content">
        <span className="pcs-shimmer pcs-line pcs-line--xs" />
        <span className="pcs-shimmer pcs-line pcs-line--lg" />
        <span className="pcs-shimmer pcs-line pcs-line--md" />

        <div className="pcs-footer">
          <div className="pcs-price-group">
            <span className="pcs-shimmer pcs-line pcs-line--price" />
            <span className="pcs-shimmer pcs-line pcs-line--sm" />
          </div>
          <span className="pcs-shimmer pcs-btn-block" />
        </div>
      </div>
    </article>
  )
}
