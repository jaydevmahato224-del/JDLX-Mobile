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
      '📱 Phones, gadgets & daily essentials — sab kuch ek app me',
      '🔍 Categories aur search se product jaldi dhoondo',
      '🛒 Tap karo “Add to Cart” — checkout seconds me',
    ],
  },
  {
    emoji: '🚚',
    title: 'Fast Delivery, Live Tracking',
    points: [
      '📍 Aapka order kahan hai — live track karo',
      '⚡ Same-day / express delivery options',
      '🔐 Delivery par OTP verification — 100% secure',
    ],
  },
  {
    emoji: '🎁',
    title: 'Offers, Referrals & Wallet',
    points: [
      '🔔 Notifications on — best deals sabse pehle',
      '👥 Friends ko refer karo, wallet cash kamao',
      '💳 COD + UPI + cards — jo chahe choose karo',
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
    <div className="fixed inset-0 z-[10050] overflow-hidden bg-gradient-to-b from-[#0b1220] via-[#101a30] to-[#0b1220] text-white">
      <style>{FLOAT_CSS}</style>
      <div className="min-h-full flex flex-col items-center justify-center px-6 py-10 max-w-md mx-auto">
        {/* Top bar: skip */}
        <div className="w-full flex justify-end mb-4">
          <button
            onClick={onComplete}
            className="text-xs font-semibold text-slate-400 px-3 py-1.5 rounded-full hover:bg-white/10 hover:text-white transition-colors"
          >
            Skip
          </button>
        </div>

        {/* Illustration card */}
        <div className="w-44 h-44 rounded-[2.5rem] bg-gradient-to-br from-amber-400/20 to-amber-600/10 border border-amber-400/20 flex items-center justify-center text-[5.5rem] shadow-2xl shadow-amber-500/10">
          <span style={{ animation: 'jdlx-float 3s ease-in-out infinite' }}>{p.emoji}</span>
        </div>

        {/* Title + points */}
        <h1 className="mt-8 text-2xl font-black tracking-tight text-center">{p.title}</h1>
        <ul className="mt-6 w-full space-y-3.5">
          {p.points.map((point, i) => (
            <li key={i} className="flex items-start gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
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
              className={`h-2 rounded-full transition-all duration-300 ${i === page ? 'w-7 bg-amber-400' : 'w-2 bg-white/20'}`}
            />
          ))}
        </div>

        {/* Next / Get started */}
        <button
          onClick={next}
          className="mt-8 w-full flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 text-[#0b1220] font-bold rounded-full px-6 py-3.5 text-sm shadow-lg shadow-amber-500/25 hover:from-amber-400 hover:to-amber-500 transition-all active:scale-[0.98]"
        >
          {isLast ? 'Get Started 🚀' : 'Next →'}
        </button>
      </div>
    </div>
  )
}