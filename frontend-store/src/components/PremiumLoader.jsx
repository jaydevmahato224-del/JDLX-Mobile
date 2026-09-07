/**
 * PremiumLoader — polished loading experience for the home catalog.
 *
 * Shown while the product collection is being prepared. Rotating reassurance
 * messages keep users informed without technical jargon. Purely presentational:
 * no business logic, no data fetching, no state side-effects.
 */

import React from 'react'
import { ShieldCheck, Sparkles, Star, Zap } from 'lucide-react'
import './PremiumLoader.css'

const MESSAGES = [
  { icon: Sparkles, text: 'Curating the collection for you', sub: 'Almost ready' },
  { icon: Star, text: 'Handpicking the best products', sub: 'Just a moment' },
  { icon: Zap, text: 'Getting things ready for you', sub: 'Hang tight' },
  { icon: ShieldCheck, text: 'Making sure everything is perfect', sub: 'Nearly there' },
]

export default function PremiumLoader() {
  const [index, setIndex] = React.useState(0)

  // Rotate the reassurance message every 2.2s while mounted
  React.useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % MESSAGES.length)
    }, 2200)
    return () => clearInterval(id)
  }, [])

  const { icon: Icon, text, sub } = MESSAGES[index]

  return (
    <div className="pl-root" role="status" aria-live="polite" aria-label="Loading products">
      <div className="pl-glow" aria-hidden="true" />

      <div className="pl-ring-wrap" aria-hidden="true">
        <div className="pl-ring-track" />
        <div className="pl-ring" />
        <div className="pl-ring-core">
          <Icon size={16} strokeWidth={2.5} />
        </div>
      </div>

      <div className="pl-message">
        <p key={index} className="pl-message-text">{text}…</p>
        <p className="pl-message-sub">{sub}</p>
      </div>

      <div className="pl-bar" aria-hidden="true">
        <div className="pl-bar-fill" />
      </div>
    </div>
  )
}
