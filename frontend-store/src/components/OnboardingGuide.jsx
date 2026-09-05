import { useState } from 'react'

// Small float animation for the guide emoji (Tailwind arbitrary animate needs
// the keyframes to exist somewhere — defining them here keeps it self-contained).
const FLOAT_CSS = `
@keyframes jdlx-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-12px); }
}
`

const PAGES = [
  {
    emoji: '🛍️',
    title: 'Shop Anything, Anytime',
    points: [
      '📱 Mobile phones, accessories & gadgets — everything in one app',
      '🔍 Find products fast with categories & search',
      '🛒 Tap “Add to Cart” — checkout in seconds',
    ],
  },
  {
    emoji: '🚚',
    title: 'Fast Delivery, Live Tracking',
    points: [
      '📍 See where your order is — live tracking',
      '📅 Scheduled doorstep delivery — order anytime, delivered on time',
      '🔐 Secure OTP-verified delivery — 100% safe',
    ],
  },
  {
    emoji: '🎁',
    title: 'Offers, Referrals & Wallet',
    points: [
      '🔔 Turn on notifications — be first to know about deals',
      '👥 Refer friends & earn wallet cash',
      '💳 COD + UPI + cards — pay your way',
    ],
  },
]

export default function OnboardingGuide({ onComplete }) {
  const [page, setPage] = useState(0)
  const isLast = page === PAGES.length - 1

  const next = () => {
    if (isLast) {
      onComplete()
    } else {
      setPage(page + 1)
    }
  }

  const p = PAGES[page]

  return (
    // overflow-y-auto: on short screens the centered column can exceed the
    // viewport, so the page must scroll or the Next button becomes unreachable.
    // (flex + m-auto centers when there is room AND scrolls from the top when
    // there isn't — justify-center would clip the top of tall content.)
    <div className="fixed inset-0 z-[10050] overflow-y-auto flex bg-gradient-to-b from-[var(--color-surface)] via-[var(--color-surface-container)] to-[var(--color-surface)] text-[var(--color-on-surface)]">
      <style>{FLOAT_CSS}</style>
      <div className="m-auto w-full max-w-md flex flex-col items-center px-6 py-8">
        {/* Top bar: skip */}
        <div className="w-full flex justify-end mb-4">
          <button
            onClick={onComplete}
            className="text-xs font-semibold px-3 py-1.5 rounded-full bg-[var(--color-surface-container)] border border-[var(--color-surface-high)] text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] transition-colors"
          >
            Skip
          </button>
        </div>

        {/* Illustration card */}
        <div className="w-44 h-44 rounded-[2.5rem] bg-[var(--color-surface-card)] border border-amber-400/40 flex items-center justify-center text-[5.5rem] shadow-2xl shadow-amber-500/10">
          <span style={{ animation: 'jdlx-float 3s ease-in-out infinite' }}>{p.emoji}</span>
        </div>

        {/* Title + points */}
        <h1 className="mt-8 text-2xl font-black tracking-tight text-center">{p.title}</h1>
        <ul className="mt-6 w-full space-y-3.5">
          {p.points.map((point, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-2xl px-4 py-3 bg-[var(--color-surface-card)] border border-[var(--color-surface-high)] text-[var(--color-on-surface)]"
            >
              <span className="text-base leading-6">{point}</span>
            </li>
          ))}
        </ul>

        {/* Dots */}
        <div className="flex items-center gap-2 mt-8">
          {PAGES.map((_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              aria-label={`Go to page ${i + 1}`}
              className={`h-2 rounded-full transition-all duration-300 ${i === page ? 'w-7 bg-amber-500' : 'w-2 bg-[var(--color-on-surface-variant)] opacity-40'}`}
            />
          ))}
        </div>

        {/* Prev / Next / Get started */}
        <div className="mt-8 w-full flex items-center gap-3">
          {page > 0 && (
            <button
              onClick={() => setPage(page - 1)}
              className="flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-bold bg-[var(--color-surface-container)] border border-[var(--color-surface-high)] text-[var(--color-on-surface)] hover:border-amber-500 hover:text-amber-600 transition-all active:scale-[0.98]"
            >
              ← Back
            </button>
          )}
          <button
            onClick={next}
            className={`flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 text-[var(--color-on-primary)] font-bold rounded-full px-6 py-3.5 text-sm shadow-lg shadow-amber-500/25 hover:from-amber-400 hover:to-amber-500 transition-all active:scale-[0.98] ${page === 0 ? 'w-full' : 'flex-1'}`}
          >
            {isLast ? 'Get Started 🚀' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  )
}