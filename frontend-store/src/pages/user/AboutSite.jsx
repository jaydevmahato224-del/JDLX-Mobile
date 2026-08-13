import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info, Truck, Clock, Shield, CreditCard, RefreshCcw, Headphones, MapPin, ChevronRight } from 'lucide-react'
import { API_BASE_URL } from '../../config'

// Module-level constant so the useMemo below has a stable dependency
// (kept outside the component so it isn't recreated on every render).
const defaultSections = [
  {
    icon: Info,
    title: 'About JDLX MOBILE',
    points: [
      'Premium mobile commerce platform for daily essentials.',
      'Designed for fast discovery, reliable stock, and smooth checkout.',
      'Single account experience across shopping, tracking, wallet, and support.',
    ],
  },
  {
    icon: Clock,
    title: 'How It Works',
    points: [
      'Browse products and add to cart.',
      'Choose your delivery address and place the order.',
      'Track your order in real-time and get updates in your account.',
    ],
  },
  {
    icon: Truck,
    title: 'Delivery & Service',
    points: [
      'Delivery time depends on location, store availability, and demand.',
      'Order updates show in “My Orders” and tracking page.',
      'For address issues, update your saved addresses before ordering.',
    ],
  },
  {
    icon: CreditCard,
    title: 'Payments',
    points: [
      'Secure payment flow for a smoother checkout.',
      'Wallet (if enabled) can be used for faster repeat orders.',
      'Payment status is reflected in order history.',
    ],
  },
  {
    icon: RefreshCcw,
    title: 'Returns & Refunds',
    points: [
      'Item eligibility depends on product type and order status.',
      'Report issues quickly from Support with order details.',
      'Refunds are provided as in-app wallet balance. Product replacements or original source refunds may be processed if possible.',
    ],
  },
  {
    icon: Shield,
    title: 'Security & Privacy',
    points: [
      'Your account is protected via token-based login sessions.',
      'We recommend using a strong password/sign-in method and logging out on shared devices.',
      'We store only the necessary details to fulfill orders and support requests.',
    ],
  },
  {
    icon: Headphones,
    title: 'Help & Support',
    points: [
      'Use “Support” for order issues, refunds, and general questions.',
      'Share order id and a short description to get quicker help.',
      'If notifications are enabled, you’ll receive important alerts in the account area.',
    ],
  },
  {
    icon: MapPin,
    title: 'Service Availability',
    points: [
      'Availability varies by city/area and partner store coverage.',
      'Product stock and pricing may vary by location and time.',
    ],
  },
]

function AboutSite() {
  const [remoteContent, setRemoteContent] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/settings`)
        const json = await res.json()
        const content = json?.data?.about_us_content
        if (res.ok && typeof content === 'string') {
          setRemoteContent(content)
        }
      } catch {
        // ignore: fallback content will render
      }
    }
    load()
  }, [])

  const sections = useMemo(() => {
    const text = (remoteContent || '').trim()
    if (!text) return defaultSections

    const parsed = []
    let current = null

    const pushCurrent = () => {
      if (!current) return
      if (!current.points.length) return
      parsed.push(current)
    }

    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    for (const line of lines) {
      const heading = line.replace(/^#{1,6}\s+/, '').trim()
      const isHeading = /^#{1,6}\s+/.test(line)
      if (isHeading) {
        pushCurrent()
        current = { icon: Info, title: heading || 'About', points: [] }
        continue
      }

      const bullet = line.replace(/^[-•]\s+/, '').trim()
      const isBullet = /^[-•]\s+/.test(line)
      if (!current) current = { icon: Info, title: 'About Us', points: [] }
      current.points.push(isBullet ? bullet : bullet)
    }
    pushCurrent()

    return parsed.length ? parsed : defaultSections
  }, [remoteContent])

  return (
    <div className="container-standard py-6 space-y-6 animate-in fade-in slide-in-from-bottom-6 duration-500">
      <div className="flex items-center justify-between px-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-black tracking-tight text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>
            About Us
          </h1>
          <p className="text-[12px] font-medium text-[var(--color-on-surface-variant)] opacity-70">
            Quick overview of JDLX MOBILE and how it works.
          </p>
        </div>
        <Link
          to="/profile"
          className="glass-icon-btn p-3 rounded-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-lg border border-[var(--color-surface-high)]"
          aria-label="Back to Account"
        >
          <ChevronRight className="w-5 h-5 rotate-180 text-primary" />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map((s) => {
          const Icon = s.icon
          return (
            <div key={s.title} className="glass-card p-6 border border-[var(--color-surface-high)] shadow-xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <h2 className="text-[13px] font-black uppercase tracking-[0.14em] text-[var(--color-on-surface)]" style={{ fontFamily: 'Inter, sans-serif' }}>
                  {s.title}
                </h2>
              </div>
              <ul className="space-y-2">
                {s.points.map((p) => (
                  <li key={p} className="text-[12px] font-medium text-[var(--color-on-surface-variant)] opacity-80 leading-relaxed">
                    • {p}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      <div className="glass-card p-5 border border-[var(--color-surface-high)]">
        <div className="text-[12px] font-bold text-[var(--color-on-surface-variant)] opacity-70">
          Tip: For the latest policy details (delivery/returns), check Support or contact the store team from your account.
        </div>
      </div>
    </div>
  )
}

export default AboutSite
