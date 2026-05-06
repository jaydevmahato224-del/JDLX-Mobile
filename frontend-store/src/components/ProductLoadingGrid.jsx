import React from 'react'
import ProductCardSkeleton from './ProductCardSkeleton'

export default function ProductLoadingGrid({ count = 12 }) {
  return (
    <div
      aria-label="Loading products"
      role="status"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 md:gap-4 md:gap-y-6"
    >
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  )
}
