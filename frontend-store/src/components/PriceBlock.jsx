import { memo } from 'react'

/**
 * PriceBlock — Amazon/Flipkart-style professional price display, JDLX theme.
 *
 * Pure presentational component (zero business logic):
 *   • Big selling price + ₹ prefix
 *   • Struck-through MRP with the classic "(X% off)" hint next to it
 *   • Green "You save" line when there is a meaningful discount
 *   • "From" prefix for variant products
 *
 * All cart/stock handling stays in the parent card — this component only
 * renders prices, so no flow can break through it.
 */
const formatINR = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? '')
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

const PriceBlock = memo(({
  price,
  mrp,
  hasVariants = false,
  size = 'md',        // 'sm' (search/compact cards) | 'md' (standard cards) | 'lg' (hero/detail)
  align = 'left',
  className = '',
}) => {
  const p = Number(price)
  const m = Number(mrp)
  const hasMrp = Number.isFinite(m) && m > 0
  const hasPrice = Number.isFinite(p) && p >= 0
  const hasDiscount = hasMrp && hasPrice && m > p
  const discountPct = hasDiscount ? Math.round(((m - p) / m) * 100) : 0
  const savings = hasDiscount ? m - p : 0

  const sizes = {
    sm: { price: 'text-base', mrp: 'text-[10px]', off: 'text-[9px] px-1 py-px', save: 'text-[9px]' },
    md: { price: 'text-lg md:text-2xl', mrp: 'text-[10px] md:text-xs', off: 'text-[9px] md:text-[10px] px-1.5 py-0.5', save: 'text-[10px]' },
    lg: { price: 'text-2xl md:text-3xl', mrp: 'text-xs md:text-sm', off: 'text-[10px] md:text-xs px-2 py-0.5', save: 'text-[11px]' },
  }[size] || {}

  return (
    <div className={`flex flex-col gap-0.5 ${align === 'right' ? 'items-end' : 'items-start'} ${className}`}>
      {/* Line 1 — selling price, MRP, % off (Amazon/Flipkart pattern) */}
      <div className="flex flex-wrap items-baseline gap-x-1.5 md:gap-x-2 gap-y-0.5">
        {hasVariants && (
          <span className="text-[9px] md:text-[10px] font-black text-primary uppercase tracking-widest">
            From
          </span>
        )}
        {hasPrice && (
          <span className={`${sizes.price} font-black text-[var(--color-on-surface)] tracking-tighter leading-none`}>
            <span className="text-[0.62em] align-baseline mr-px">₹</span>{formatINR(p)}
          </span>
        )}
        {hasDiscount && (
          <span className={`${sizes.mrp} text-[var(--color-on-surface-variant)] line-through font-semibold`}>
            ₹{formatINR(m)}
          </span>
        )}
        {hasDiscount && (
          <span className={`${sizes.off} rounded-full bg-emerald-500/10 border border-emerald-500/20 font-black text-emerald-600 uppercase tracking-tight leading-none`}>
            {discountPct}% off
          </span>
        )}
      </div>

      {/* Line 2 — absolute savings, only when worth showing */}
      {hasDiscount && savings >= 1 && (
        <span className={`${sizes.save} font-black text-emerald-600 uppercase tracking-wide leading-none`}>
          Save ₹{formatINR(savings)}
        </span>
      )}
    </div>
  )
})

export default PriceBlock
