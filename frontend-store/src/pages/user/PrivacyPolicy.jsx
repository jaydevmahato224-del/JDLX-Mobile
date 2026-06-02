import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Shield, Eye, Database, Lock, UserCheck, Globe, ChevronRight } from 'lucide-react'

function PrivacyPolicy() {
  const sections = useMemo(() => [
    {
      icon: Shield,
      title: 'Introduction & Scope',
      points: [
        'JDLX MOBILE ("we", "us", or "our") values your privacy and is committed to protecting your personal information.',
        'This Privacy Policy applies to our online storefront, admin management dashboard, warehouse logistics panel, and hyperlocal delivery tracking services.',
        'By accessing our platform, you consent to the data collection and usage practices outlined herein.',
      ],
    },
    {
      icon: Eye,
      title: 'Information We Collect',
      points: [
        'Customer Profile: Name, email address, profile image (securely fetched via Google OAuth), gender, date of birth, and phone number.',
        'Location Details: Precise shipping addresses, including geocoded coordinates (latitude & longitude) for hyperlocal routing and near-instant fulfillment.',
        'Logistics & Partners: Operational coordinates, vehicle configurations, and live GPS location tracking for delivery riders while executing orders.',
        'System Logs: Network IP addresses, device models, operating system identifiers, and system audit logs for administrative security.',
      ],
    },
    {
      icon: Database,
      title: 'How We Use Data',
      points: [
        'hyperlocal Deliveries: To assign orders to the nearest dark store or warehouse and guide delivery riders to your doorstep in real-time.',
        'Authentication & Profile: To enable secure, one-tap logins via Google OAuth and manage your customer account history.',
        'Financial Processing: Secure transactions and calculations for coupon codes, referral bonuses, and your JDLX digital wallet.',
        'Security & Integrity: Identifying anomalous activities, blocking suspicious IP addresses, and maintaining comprehensive administrative audit logs.',
      ],
    },
    {
      icon: Lock,
      title: 'Sharing & Third Parties',
      points: [
        'Google OAuth 2.0: For secure login and authentication services.',
        'Razorpay Payment Gateway: Secure payment processing. JDLX does not store credit/debit card numbers or bank credentials directly; only payment references and transaction IDs are retained.',
        'Shiprocket & Couriers: Product shipping, dispatching, and tracking coordination for remote deliveries.',
        'Legal Compliance: Data is disclosed only when required by law or to defend platform safety against fraudulent activity.',
      ],
    },
    {
      icon: UserCheck,
      title: 'Data Security & Storage',
      points: [
        'JSON Web Tokens (JWT): User sessions are protected with industry-standard JWT encryption to prevent session hijacking.',
        'Secure Database (Turso): All account records and order details are stored in highly secure database environments.',
        'Audit Controls: Multi-factor validation for admin operations and automatic triggers to record administrative modifications.',
      ],
    },
    {
      icon: Globe,
      title: 'Your Choices & Rights',
      points: [
        'You can update your personal information, addresses, and settings at any time in the "Profile Settings" section.',
        'You have the right to request deletion of your account and related historical data by opening a support ticket.',
        'You can revoke Google Sign-In access through your Google Account security permissions at any time.',
      ],
    },
  ], [])

  return (
    <div className="container-standard py-6 space-y-6 animate-in fade-in slide-in-from-bottom-6 duration-500">
      <div className="flex items-center justify-between px-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-black tracking-tight text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Privacy Policy
          </h1>
          <p className="text-[12px] font-medium text-[var(--color-on-surface-variant)] opacity-70">
            How JDLX MOBILE handles and protects your data.
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
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
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
          Last Updated: June 2026. This policy reflects JDLX Mobile's commitment to secure data processing and absolute user transparency. For specific regulatory requests, please submit a Support ticket.
        </div>
      </div>
    </div>
  )
}

export default PrivacyPolicy
