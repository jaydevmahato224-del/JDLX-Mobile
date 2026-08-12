import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, Shield, Truck, CreditCard, RefreshCcw, AlertTriangle, ChevronRight } from 'lucide-react'
import { API_BASE_URL } from '../../config'

function TermsAndConditions() {
  const [remoteContent, setRemoteContent] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/settings`)
        const json = await res.json()
        const content = json?.data?.terms_and_conditions_content
        if (res.ok && typeof content === 'string') {
          setRemoteContent(content)
        }
      } catch {
        // ignore: fallback content will render
      }
    }
    load()
  }, [])

  const defaultSections = [
    {
      icon: FileText,
      title: 'Terms Acceptance',
      points: [
        'By using JDLX MOBILE, you agree to these Terms & Conditions.',
        'If you do not agree, please stop using the service.',
      ],
    },
    {
      icon: Shield,
      title: 'Account & Security',
      points: [
        'Keep your login details confidential and use secure devices.',
        'You are responsible for activity under your account.',
        'We may suspend accounts for misuse, fraud, or policy violations.',
      ],
    },
    {
      icon: Truck,
      title: 'Orders, Delivery & Availability',
      points: [
        'Product availability and prices may change based on stock and location.',
        'Delivery times are estimates and can vary due to demand and operational conditions.',
        'Please ensure your address and contact details are correct before placing an order.',
      ],
    },
    {
      icon: CreditCard,
      title: 'Payments & Charges',
      points: [
        'Applicable platform fees, delivery fees, and taxes (if any) may apply at checkout.',
        'Payment status is reflected in your order history.',
        'Any failed/partial payments may result in order cancellation or delays.',
      ],
    },
    {
      icon: RefreshCcw,
      title: 'Cancellations, Returns & Refunds',
      points: [
        'Cancellation eligibility depends on order status and fulfillment stage.',
        'Return/refund eligibility depends on product type and issue reported.',
        'Refunds are provided as in-app wallet balance. Product replacements or original source refunds may be processed if possible.',
      ],
    },
    {
      icon: AlertTriangle,
      title: 'Limitations',
      points: [
        'We are not liable for delays due to force majeure or events beyond our control.',
        'Service features may change, pause, or discontinue as we improve the platform.',
      ],
    },
  ]

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
        current = { icon: FileText, title: heading || 'Terms', points: [] }
        continue
      }

      const bullet = line.replace(/^[-•]\s+/, '').trim()
      const isBullet = /^[-•]\s+/.test(line)
      if (!current) current = { icon: FileText, title: 'Terms & Conditions', points: [] }
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
            Terms & Conditions
          </h1>
          <p className="text-[12px] font-medium text-[var(--color-on-surface-variant)] opacity-70">
            Important terms for using JDLX MOBILE.
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
        <div className="text-[11px] font-semibold text-[var(--color-on-surface-variant)] opacity-70 leading-relaxed">
          Note: This is a general summary for user clarity. For store-specific policy details, please contact Support.
        </div>
      </div>
    </div>
  )
}

export default TermsAndConditions

