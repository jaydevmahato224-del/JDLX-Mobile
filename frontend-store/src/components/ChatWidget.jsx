import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageCircle, X, ChevronRight, ChevronLeft, Bot, User, ExternalLink, Loader2, CheckCircle2 } from 'lucide-react'
import { apiFetch } from '../utils/apiFetch'
import { useStore } from '../store/useStore'

/**
 * Hybrid Support Chatbot (floating "Chat with us" widget).
 *
 * Design principles (per product requirements):
 *  - NO free-text typing anywhere. Users navigate a decision tree of
 *    tap-friendly options, category by category, until they reach an answer
 *    or the end of a flow.
 *  - "Connect to Agent" is NEVER the first thing shown. It only appears at the
 *    END of a flow (or after an answer that warrants it), so users first try
 *    to self-serve — and when they do reach an agent, the ticket is
 *    pre-annotated with everything they clicked (smart context).
 *  - Fully additive: reuses the existing support-ticket backend
 *    (/api/support/ticket) and order history (/api/user/orders). No backend
 *    changes, no existing flow is touched.
 *  - Rendered ONLY on profile pages (see App.jsx), floating above the bottom
 *    nav, mobile-first.
 */

// ─── Content tree ────────────────────────────────────────────────────────────
// Every node: { title, options: [{ label, next | action }] }
// `action` nodes terminate the guided flow (open a page, or offer agent).

const BOT_NAME = 'JDLX Assistant'

const FLOW_TREE = {
  root: {
    title: 'Namaste! 👋 Main aapki kaise help kar sakti hoon? Neeche diye options mein se apni problem choose karein.',
    options: [
      { label: '📦 Order / Delivery issue', next: 'order_issue' },
      { label: '🔄 Exchange & Return', next: 'exchange_return' },
      { label: '💸 Refund & Payment', next: 'refund_payment' },
      { label: '🛒 Shopping / Cart help', next: 'shopping_help' },
      { label: '👤 Account & Login', next: 'account_login' },
      { label: '❓ Other question', next: 'other_question' },
    ],
  },

  // ── Order / Delivery ──────────────────────────────────────────────────────
  order_issue: {
    title: 'Order ya delivery se related issue hai? Kya problem aa rahi hai?',
    options: [
      { label: '🔍 Mera order kahan hai? (Live status)', next: 'order_live_status' },
      { label: '🚚 Shipping partner / courier tracking', next: 'track_shipping' },
      { label: '⏰ Order late hai / time kaise hota hai', next: 'order_late' },
      { label: '❌ Order cancel karna hai', next: 'order_cancel' },
      { label: '📦 Galat / Damaged item mila', next: 'order_damaged' },
      { label: '⬅️ Main menu', next: 'root' },
    ],
  },

  // ── Track shipping partner ──────────────────────────────────────────────
  track_shipping: {
    title: 'Courier partner aur tracking details order ke saath dikh jate hain. Live status dekhein ya partner samjhein:',
    options: [
      { label: '🔍 Live orders + courier dekho', next: 'order_live_status' },
      { label: '🚛 Shipping partner kaun se hain?', next: 'shipping_partner_info' },
      { label: '⬅️ Peeche', next: 'order_issue' },
    ],
  },
  shipping_partner_info: {
    title: (
      <>
        Do tarah se delivery hoti hai:
        <br />• <b>Shiprocket courier</b> — lambe distance wale orders. AWB number + courier name + ETA tracking page par milta hai
        <br />• <b>Local dark-store delivery</b> — aas-paas ke orders, store khud deliver karta hai
        <br /><br />
        Jab order dispatch hota hai, tracking page par courier ka naam aur AWB turant update ho jata hai.
      </>
    ),
    options: [
      { label: '🔍 Apna order track karo', next: 'order_live_status' },
      { label: '🙋 Agent se connect karo', action: 'agent' },
      { label: '⬅️ Peeche', next: 'track_shipping' },
    ],
  },

  // ── Exchange & Return ────────────────────────────────────────────────
  exchange_return: {
    title: 'Exchange ya return ke baare mein kya jaanna chahte hain?',
    options: [
      { label: '↩️ Return request kaise karein', next: 'return_request' },
      { label: '🔄 Exchange kaise karein', next: 'exchange_how' },
      { label: '📅 Return window kitne din ka hai?', next: 'return_window' },
      { label: '⬅️ Main menu', next: 'root' },
    ],
  },
  return_request: {
    title: (
      <>
        Return/Refund request aise karein:
        <br />1. Delivery ke <b>7 din ke andar</b> "Refund Request" page par jayein
        <br />2. Order select karke reason detail mein likhein
        <br />3. Request submit karte hi hamari team review karti hai
        <br /><br />
        Status "My Refunds" page par live dikhta hai.
      </>
    ),
    options: [
      { label: '🔍 Kaunse orders eligible hain? (Auto-check)', next: 'refund_eligibility_check' },
      { label: '📄 Refund request bhejo', action: 'navigate', to: '/profile/refund-request' },
      { label: '📋 Mere refunds ka status', action: 'navigate', to: '/profile/my-refunds' },
      { label: '🙋 Agent se connect karo', action: 'agent' },
      { label: '⬅️ Peeche', next: 'exchange_return' },
    ],
  },
  refund_eligibility_check: {
    // Read-only scan: delivered orders → /api/refund-eligibility/<id> per order.
    // The bot NEVER submits anything here — it only shows what qualifies and
    // deep-links the user to the real request form.
    action: 'eligibility_check',
    title: 'Aapke delivered orders check kar raha hoon (sirf dekhna, kuch submit nahi hota)…',
    options: [
      { label: '📄 Refund request page kholo', action: 'navigate', to: '/profile/refund-request' },
      { label: '⬅️ Peeche', next: 'exchange_return' },
    ],
  },
  exchange_how: {
    title: (
      <>
        Exchange process:
        <br />• Delivery ke <b>7 din ke andar</b> agent se exchange request karein
        <br />• Defective ya galat product ke liye <b>same model ya equivalent</b> exchange hota hai
        <br />• Request approve hone par purana product courier se pickup ho jata hai, naya bhej diya jata hai
      </>
    ),
    options: [
      { label: '🙋 Agent se exchange request karo', action: 'agent' },
      { label: '↩️ Return request karna hai', next: 'return_request' },
      { label: '⬅️ Peeche', next: 'exchange_return' },
    ],
  },
  return_window: {
    title: (
      <>
        Return/Exchange window: <b>7 din</b> (delivery date se).
        <br /><br />
        Note: har product ki apni policy ho sakti hai — exact window <b>product page</b> par "Return Policy" section mein dikh jati hai (Product → Category → Global priority se decide hota hai).
      </>
    ),
    options: [
      { label: '↩️ Return request kaise karein', next: 'return_request' },
      { label: '⬅️ Peeche', next: 'exchange_return' },
    ],
  },
  order_live_status: {
    action: 'live_orders',
    title: 'Aapke recent orders yahan hain — status tap karke pura tracking dekh sakte hain.',
  },
  order_late: {
    title: (
      <>
        Delivery time samajhiye:
        <br />• Local (dark store) orders: <b>1-2 din</b>
        <br />• Shiprocket courier orders: <b>3-7 din</b> (ETA order tracking mein dikhta hai)
        <br /><br />
        Agar ETA nikal gaya hai aur order nahi aaya, to agent se connect karein — hum courier se turant follow-up karenge.
      </>
    ),
    options: [
      { label: '🔍 Live order status dekho', next: 'order_live_status' },
      { label: '🙋 Agent se connect karo', action: 'agent' },
      { label: '⬅️ Peeche', next: 'order_issue' },
    ],
  },
  order_cancel: {
    title: (
      <>
        Order cancel karne ke liye:
        <br />• <b>Dispatch hone se pehle:</b> My Orders → order kholo → "Cancel Order" button milega (agar eligible hai)
        <br />• <b>Dispatch ke baad:</b> order cancel nahi ho sakta, delivery ke baad return/refund ka option milega
      </>
    ),
    options: [
      { label: '📦 My Orders kholo', action: 'navigate', to: '/profile/orders' },
      { label: '🙋 Agent se connect karo', action: 'agent' },
      { label: '⬅️ Peeche', next: 'order_issue' },
    ],
  },
  order_damaged: {
    title: 'Sorry for the trouble! 🙏 Galat ya damaged item ke liye hum turant action lenge. Issue details ke saath agent se connect karein — photo/screenshot bhi ticket mein attach ho sakta hai.',
    options: [
      { label: '🙋 Agent se connect karo', action: 'agent' },
      { label: '⬅️ Peeche', next: 'order_issue' },
    ],
  },

  // ── Refund & Payment ─────────────────────────────────────────────────────
  refund_payment: {
    title: 'Refund ya payment ka issue hai? Kya help chahiye?',
    options: [
      { label: '💰 Refund kab aayega', next: 'refund_when' },
      { label: '🏦 Refund nahi mila', next: 'refund_missing' },
      { label: '💳 Payment do baar kat gaya', next: 'payment_double' },
      { label: '👛 Wallet kaise kaam karta hai', next: 'wallet_help' },
      { label: '⬅️ Main menu', next: 'root' },
    ],
  },
  refund_when: {
    title: (
      <>
        Refund timeline:
        <br />• Wallet refunds: <b>turant</b> (instant)
        <br />• Bank/UPI refunds: <b>5-7 working days</b> (bank processing ke baad)
        <br /><br />
        Refund status "My Refunds" page par dikhta hai.
      </>
    ),
    options: [
      { label: '🔍 Kaunse orders eligible hain? (Auto-check)', next: 'refund_eligibility_check' },
      { label: '📄 My Refunds kholo', action: 'navigate', to: '/profile/my-refunds' },
      { label: '⬅️ Peeche', next: 'refund_payment' },
    ],
  },
  refund_missing: {
    title: 'Agar 7 working days ke baad bhi refund nahi aaya, to agent se connect karein — hum payment reference ke saath bank follow-up karenge. Ticket mein order number zaroor likhein.',
    options: [
      { label: '🙋 Agent se connect karo', action: 'agent' },
      { label: '⬅️ Peeche', next: 'refund_payment' },
    ],
  },
  payment_double: {
    title: 'Double deduction ka issue hum urgent treat karte hain. Agent se connect karein — transaction details ke saath turant refund process karenge.',
    options: [
      { label: '🙋 Agent se connect karo', action: 'agent' },
      { label: '⬅️ Peeche', next: 'refund_payment' },
    ],
  },
  wallet_help: {
    title: (
      <>
        Wallet: order cancel hone par refund turant wallet mein aata hai, aur aap wallet balance se koi bhi order pay kar sakte hain.
      </>
    ),
    options: [
      { label: '👛 Wallet kholo', action: 'navigate', to: '/profile/wallet' },
      { label: '⬅️ Peeche', next: 'refund_payment' },
    ],
  },

  // ── Shopping / Cart ──────────────────────────────────────────────────────
  shopping_help: {
    title: 'Shopping se related kya help chahiye?',
    options: [
      { label: '🎟️ Coupon kaise use karein', next: 'coupon_help' },
      { label: '🚚 Delivery charge / COD available?', next: 'cod_help' },
      { label: '📱 Product genuine hai? Warranty?', next: 'genuine_help' },
      { label: '⬅️ Main menu', next: 'root' },
    ],
  },
  coupon_help: {
    title: (
      <>
        Checkout page par "Apply Coupon" section mein code daalein. Available coupons "Coupons" page par hamesha listed rehte hain.
      </>
    ),
    options: [
      { label: '🎟️ Available Coupons dekho', action: 'navigate', to: '/profile/coupons' },
      { label: '⬅️ Peeche', next: 'shopping_help' },
    ],
  },
  cod_help: {
    title: (
      <>
        COD availability pincode par depend karti hai — checkout par address select karte hi pata chal jata hai. Serviceable pincodes par COD + Prepaid dono milte hain (kabhi-kabhi prepaid-only).
      </>
    ),
    options: [
      { label: '⬅️ Peeche', next: 'shopping_help' },
      { label: 'Main menu', next: 'root' },
    ],
  },
  genuine_help: {
    title: (
      <>
        Haan! JDLX Mobile par 100% genuine products milte hain — brand warranty ke saath. Koi bhi doubt ho to agent se confirm kar lein.
      </>
    ),
    options: [
      { label: '🙋 Agent se connect karo', action: 'agent' },
      { label: '⬅️ Peeche', next: 'shopping_help' },
    ],
  },

  // ── Account & Login ──────────────────────────────────────────────────────
  account_login: {
    title: 'Account ya login ka issue hai?',
    options: [
      { label: '🔐 Login nahi ho raha', next: 'login_issue' },
      { label: '📧 Email / Phone update karna hai', next: 'profile_update' },
      { label: '🔑 Password change karna hai', next: 'password_help' },
      { label: '⬅️ Main menu', next: 'root' },
    ],
  },
  login_issue: {
    title: (
      <>
        Login issues ke common fixes:
        <br />• Google login try karein (sabse fast)
        <br />• OTP email/phone par aane mein 1-2 min lag sakte hain — dobara try karein
        <br />• Browser cache clear karke retry karein
      </>
    ),
    options: [
      { label: '🙋 Agent se connect karo', action: 'agent' },
      { label: '⬅️ Main menu', next: 'root' },
    ],
  },
  profile_update: {
    title: 'Apni profile details aap khud update kar sakte hain — Settings page par.',
    options: [
      { label: '⚙️ Profile Settings kholo', action: 'navigate', to: '/profile/settings' },
      { label: '🙋 Agent se connect karo', action: 'agent' },
      { label: '⬅️ Peeche', next: 'account_login' },
    ],
  },
  password_help: {
    title: 'Security page se password change kar sakte hain.',
    options: [
      { label: '🔒 Security page kholo', action: 'navigate', to: '/profile/security' },
      { label: '⬅️ Peeche', next: 'account_login' },
    ],
  },

  // ── Other ────────────────────────────────────────────────────────────────
  other_question: {
    title: 'Koi aur sawal hai? Hum hari tarah se help karte hain — agent se connect karein ya common topics choose karein.',
    options: [
      { label: '🙋 Agent se connect karo', action: 'agent' },
      { label: 'ℹ️ About JDLX Mobile', action: 'navigate', to: '/profile/about-site' },
      { label: '📜 Terms & Privacy policy', action: 'navigate', to: '/profile/terms' },
      { label: '📋 Bug report karna hai', action: 'navigate', to: '/profile/bug-report' },
      { label: '📝 Complaint register karna hai', action: 'navigate', to: '/profile/complaint' },
      { label: '⬅️ Main menu', next: 'root' },
    ],
  },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  pending: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  assigned: 'bg-blue-100 text-blue-700 border-blue-300',
  accepted: 'bg-blue-100 text-blue-700 border-blue-300',
  packing: 'bg-purple-100 text-purple-700 border-purple-300',
  packed: 'bg-purple-100 text-purple-700 border-purple-300',
  dispatched: 'bg-indigo-100 text-indigo-700 border-indigo-300',
  shipped: 'bg-cyan-100 text-cyan-700 border-cyan-300',
  delivered: 'bg-green-100 text-green-700 border-green-300',
  cancelled: 'bg-red-100 text-red-700 border-red-300',
}

function statusBadge(status) {
  const s = (status || '').toLowerCase()
  return STATUS_STYLES[s] || 'bg-gray-100 text-gray-700 border-gray-300'
}

let _msgId = 0
const nextId = () => `m${++_msgId}`

// ─── Component ───────────────────────────────────────────────────────────────

export default function ChatWidget() {
  const user = useStore((state) => state.user)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [path, setPath] = useState(['root'])
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [orders, setOrders] = useState(null)
  const [creatingTicket, setCreatingTicket] = useState(false)
  const [createdTicket, setCreatedTicket] = useState(null)
  // Read-only refund eligibility scan results (per delivered order).
  const [eligibility, setEligibility] = useState(null) // { checking, results: [{orderId, status, eligible, reason, daysRemaining}] }
  const scrollRef = useRef(null)
  // Human-readable trail of what the user clicked — attached to the agent
  // ticket so the support agent sees the full chatbot journey (smart context).
  const agentTopic = useRef(null)
  const agentPath = useRef([])

  const currentNodeId = path[path.length - 1]

  // Push a bot message into the transcript when the current node changes.
  useEffect(() => {
    if (!open) return
    setMessages((prev) => {
      if (prev.length && prev[prev.length - 1].nodeId === currentNodeId) return prev
      return [...prev, { id: nextId(), from: 'bot', nodeId: currentNodeId }]
    })
  }, [open, currentNodeId])

  // Auto-scroll to newest message.
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, open, loadingOrders, creatingTicket, createdTicket])

  const go = useCallback((nodeId) => {
    setPath((p) => [...p, nodeId])
  }, [])

  const back = useCallback(() => {
    setPath((p) => (p.length > 1 ? p.slice(0, -1) : p))
  }, [])

  const restart = useCallback(() => {
    setPath(['root'])
    setOrders(null)
    setCreatedTicket(null)
    setEligibility(null)
    agentTopic.current = null
    agentPath.current = []
  }, [])

  // Fetch the user's recent orders for the live-status step (existing API).
  const loadOrders = useCallback(async () => {
    setLoadingOrders(true)
    try {
      const res = await apiFetch('/api/user/orders')
      const data = await res.json().catch(() => [])
      const list = Array.isArray(data) ? data : (data?.data || [])
      setOrders(list.slice(0, 5))
    } catch {
      setOrders([])
    } finally {
      setLoadingOrders(false)
    }
  }, [])

  useEffect(() => {
    if (currentNodeId === 'order_live_status' && orders === null && !loadingOrders) {
      loadOrders()
    }
  }, [currentNodeId, orders, loadingOrders, loadOrders])

  // Read-only refund eligibility scan: for each DELIVERED order of the user,
  // ask the existing GET /api/refund-eligibility/<id> endpoint (same one the
  // Refund Request page uses). Nothing is submitted — pure status inspection.
  const runEligibilityCheck = useCallback(async () => {
    if (eligibility?.checking) return
    setEligibility({ checking: true, results: [] })
    try {
      const res = await apiFetch('/api/user/orders')
      const data = await res.json().catch(() => [])
      const list = Array.isArray(data) ? data : (data?.data || [])
      const delivered = list.filter((o) => ['delivered', 'completed'].includes((o.status || o.order_status || '').toLowerCase()))
      if (delivered.length === 0) {
        setEligibility({ checking: false, results: [] })
        return
      }
      const results = await Promise.all(delivered.slice(0, 5).map(async (o) => {
        try {
          const r = await apiFetch(`/api/refund-eligibility/${o.id}`)
          const d = await r.json().catch(() => ({}))
          const info = d?.data || d || {}
          return {
            orderId: o.id,
            orderNumber: o.order_number || o.id,
            eligible: !!info.eligible,
            reason: info.reason || null,
            daysRemaining: info.days_remaining ?? null,
          }
        } catch {
          return { orderId: o.id, orderNumber: o.order_number || o.id, eligible: false, reason: 'Check failed — thodi der baad try karein' }
        }
      }))
      setEligibility({ checking: false, results })
    } catch {
      setEligibility({ checking: false, results: [] })
    }
  }, [eligibility?.checking])

  useEffect(() => {
    if (currentNodeId === 'refund_eligibility_check' && !eligibility && !eligibility?.checking) {
      runEligibilityCheck()
    }
  }, [currentNodeId, eligibility, runEligibilityCheck])

  // Agent handoff — creates a REAL support ticket via the existing endpoint,
  // pre-annotated with the full clicked path (smart context for the agent).
  const connectAgent = useCallback(async () => {
    if (creatingTicket || createdTicket) return
    setCreatingTicket(true)
    try {
      const subject = `Chatbot: ${agentTopic.current || 'Support requested'}`
      const contextLines = [
        `Issue category: ${agentTopic.current || 'General'}`,
        agentPath.current.length ? `Chatbot flow: ${agentPath.current.join(' > ')}` : null,
        `Customer: ${user?.name || user?.email || user?.phone || `User #${user?.id || '?'}`}`,
        `Raised via: Chat widget on ${window.location.pathname}`,
      ].filter(Boolean)

      const res = await apiFetch('/api/support/ticket', {
        method: 'POST',
        body: JSON.stringify({
          subject,
          message: contextLines.join('\n'),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setCreatedTicket({
          ticket_number: data?.data?.ticket_number || data?.ticket_number || 'created',
          ticket_id: data?.data?.ticket_id || data?.ticket_id,
        })
      } else {
        setCreatedTicket({ error: true })
      }
    } catch {
      setCreatedTicket({ error: true })
    } finally {
      setCreatingTicket(false)
    }
  }, [creatingTicket, createdTicket, user])

  const selectOption = useCallback((opt) => {
    // Track the clicked labels so the agent ticket contains the real path.
    if (!opt.label.startsWith('⬅️') && !opt.label.startsWith('Main menu')) {
      agentPath.current = [...agentPath.current, opt.label]
      if (agentTopic.current === null) {
        agentTopic.current = opt.label.replace(/^\S+\s/, '')
      }
    }

    if (opt.action === 'agent') {
      setMessages((prev) => [...prev, { id: nextId(), from: 'bot', text: 'Ek minute — agent connect kar raha hoon…' }])
      connectAgent()
      return
    }
    if (opt.action === 'navigate' && opt.to) {
      setOpen(false)
      navigate(opt.to)
      return
    }
    if (opt.next) {
      go(opt.next)
    }
  }, [connectAgent, go, navigate])

  const handleOpen = () => {
    if (!open && messages.length === 0) {
      setPath(['root'])
    }
    setOpen((o) => !o)
  }

  if (!user) return null

  return (
    <>
      {/* Floating button — bottom-right, above bottom nav */}
      <button
        onClick={handleOpen}
        aria-label="Chat with us"
        className={`fixed bottom-24 right-4 z-50 grid h-14 w-14 place-items-center rounded-full bg-primary text-white shadow-xl shadow-primary/30 transition-all duration-300 hover:scale-105 active:scale-95 ${open ? 'rotate-0' : ''}`}
        style={open ? { display: 'none' } : undefined}
      >
        <MessageCircle size={24} />
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-20 right-3 left-3 sm:left-auto sm:w-[380px] z-50 max-h-[70vh] flex flex-col rounded-3xl border border-[var(--color-outline-variant)] bg-[var(--color-surface-white)] dark:bg-[var(--color-surface-dark)] shadow-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-200"
          role="dialog"
          aria-label="Support chat"
        >
          {/* Header */}
          <div className="flex items-center justify-between bg-primary text-white px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-white/20">
                <Bot size={18} />
              </div>
              <div>
                <div className="text-sm font-black tracking-wide">{BOT_NAME}</div>
                <div className="text-[9px] font-bold uppercase tracking-widest opacity-80">Hybrid Help • Step-by-step</div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/15 transition-colors active:scale-90"
            >
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-[var(--color-surface-low)]">
            {messages.map((m) => {
              if (m.from === 'bot') {
                const node = FLOW_TREE[m.nodeId]
                return (
                  <div key={m.id} className="space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-primary mt-0.5">
                        <Bot size={13} />
                      </div>
                      <div className="rounded-2xl rounded-tl-sm bg-white dark:bg-[var(--color-surface-container)] border border-[var(--color-outline-variant)] px-3.5 py-2.5 text-[13px] font-medium leading-relaxed text-[var(--color-on-surface)]">
                        {m.text || node?.title || '…'}
                      </div>
                    </div>

                    {/* Options for this node */}
                    {node?.options && m.id === messages[messages.length - 1]?.id && (
                      <div className="pl-8 space-y-1.5">
                        {node.options.map((opt) => (
                          <button
                            key={opt.label}
                            onClick={() => selectOption(opt)}
                            className="w-full flex items-center justify-between gap-2 rounded-xl border border-primary/25 bg-white dark:bg-[var(--color-surface-container)] px-3.5 py-2.5 text-left text-[12px] font-bold text-[var(--color-on-surface)] hover:bg-primary/5 hover:border-primary/50 active:scale-[0.98] transition-all"
                          >
                            <span>{opt.label}</span>
                            <ChevronRight size={14} className="shrink-0 text-primary" />
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Live orders block */}
                    {m.nodeId === 'order_live_status' && m.id === messages[messages.length - 1]?.id && (
                      <div className="pl-8">
                        {loadingOrders ? (
                          <div className="flex items-center gap-2 rounded-xl bg-white dark:bg-[var(--color-surface-container)] border border-[var(--color-outline-variant)] px-3.5 py-3 text-[12px] font-bold text-[var(--color-on-surface-variant)]">
                            <Loader2 size={14} className="animate-spin text-primary" /> Orders load ho rahe hain…
                          </div>
                        ) : !orders || orders.length === 0 ? (
                          <div className="rounded-xl bg-white dark:bg-[var(--color-surface-container)] border border-[var(--color-outline-variant)] px-3.5 py-3 text-[12px] font-bold text-[var(--color-on-surface-variant)]">
                            Koi order nahi mila. Shopping karein aur yahan live status dekhein! 🛍️
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {orders.map((o) => (
                              <button
                                key={o.id}
                                onClick={() => { setOpen(false); navigate(`/track/${o.order_number || o.id}`) }}
                                className="w-full rounded-xl bg-white dark:bg-[var(--color-surface-container)] border border-[var(--color-outline-variant)] px-3.5 py-2.5 text-left hover:border-primary/50 active:scale-[0.98] transition-all"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11px] font-black text-[var(--color-on-surface)]">#{o.order_number || o.id}</span>
                                  <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase ${statusBadge(o.status || o.order_status)}`}>
                                    {o.status || o.order_status || 'pending'}
                                  </span>
                                </div>
                                <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-[var(--color-on-surface-variant)]">
                                  <span>₹{o.total_amount}</span>
                                  <span className="flex items-center gap-1 text-primary">
                                    Track <ExternalLink size={10} />
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Read-only refund eligibility scan block */}
                    {m.nodeId === 'refund_eligibility_check' && m.id === messages[messages.length - 1]?.id && (
                      <div className="pl-8">
                        {(eligibility?.checking || !eligibility) ? (
                          <div className="flex items-center gap-2 rounded-xl bg-white dark:bg-[var(--color-surface-container)] border border-[var(--color-outline-variant)] px-3.5 py-3 text-[12px] font-bold text-[var(--color-on-surface-variant)]">
                            <Loader2 size={14} className="animate-spin text-primary" /> Orders check ho rahe hain…
                          </div>
                        ) : eligibility.results.length === 0 ? (
                          <div className="rounded-xl bg-white dark:bg-[var(--color-surface-container)] border border-[var(--color-outline-variant)] px-3.5 py-3 text-[12px] font-bold text-[var(--color-on-surface-variant)]">
                            Koi delivered order nahi mila jiska refund check ho sake. Refund delivery ke 7 din ke andar hi possible hai.
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {eligibility.results.map((r) => (
                              <div
                                key={r.orderId}
                                className={`rounded-xl border px-3.5 py-2.5 ${r.eligible ? 'bg-green-50 dark:bg-green-950/30 border-green-200' : 'bg-white dark:bg-[var(--color-surface-container)] border-[var(--color-outline-variant)]'}`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11px] font-black text-[var(--color-on-surface)]">#{r.orderNumber}</span>
                                  {r.eligible ? (
                                    <span className="rounded-full border border-green-300 bg-green-100 px-2 py-0.5 text-[9px] font-black uppercase text-green-700">
                                      Eligible{r.daysRemaining != null ? ` • ${r.daysRemaining} din bache` : ''}
                                    </span>
                                  ) : (
                                    <span className="rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-[9px] font-black uppercase text-gray-600">
                                      Not eligible
                                    </span>
                                  )}
                                </div>
                                {!r.eligible && r.reason && (
                                  <div className="mt-1 text-[10px] font-bold text-[var(--color-on-surface-variant)]">{r.reason}</div>
                                )}
                                {r.eligible && (
                                  <button
                                    onClick={() => { setOpen(false); navigate(`/profile/refund-request?order_id=${r.orderId}`) }}
                                    className="mt-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-green-700 underline"
                                  >
                                    Is order ka refund request kholo <ExternalLink size={10} />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Agent handoff result block */}
                    {(creatingTicket || createdTicket) && m.text?.includes('agent connect') && m.id === messages[messages.length - 1]?.id && (
                      <div className="pl-8">
                        {creatingTicket ? (
                          <div className="flex items-center gap-2 rounded-xl bg-white dark:bg-[var(--color-surface-container)] border border-[var(--color-outline-variant)] px-3.5 py-3 text-[12px] font-bold text-[var(--color-on-surface-variant)]">
                            <Loader2 size={14} className="animate-spin text-primary" /> Ticket ban raha hai…
                          </div>
                        ) : createdTicket?.error ? (
                          <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 px-3.5 py-3 text-[12px] font-bold text-red-700">
                            Ticket nahi ban paya. Profile → Support se manual ticket banayein, ya thodi der baad try karein.
                          </div>
                        ) : (
                          <div className="rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 px-3.5 py-3 space-y-2">
                            <div className="flex items-center gap-2 text-[12px] font-black text-green-700">
                              <CheckCircle2 size={14} /> Ticket {createdTicket.ticket_number} ban gaya!
                            </div>
                            <div className="text-[11px] font-bold text-green-600/80">
                              Agent 24-48 hours mein reply karega. Reply notification profile mein aayega.
                            </div>
                            {createdTicket.ticket_id && (
                              <button
                                onClick={() => { setOpen(false); navigate(`/profile/support/ticket/${createdTicket.ticket_id}`) }}
                                className="text-[11px] font-black uppercase tracking-wider text-green-700 underline"
                              >
                                Ticket kholo →
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              }
              // User messages are implicit (options they clicked); transcript keeps bots only.
              return null
            })}
          </div>

          {/* Footer controls — no free-text input by design */}
          <div className="flex items-center justify-between border-t border-[var(--color-outline-variant)] bg-white dark:bg-[var(--color-surface-container)] px-3 py-2">
            <button
              onClick={back}
              disabled={path.length <= 1}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-[var(--color-on-surface-variant)] disabled:opacity-30 hover:bg-[var(--color-surface-low)] transition-colors"
            >
              <ChevronLeft size={13} /> Back
            </button>
            <button
              onClick={restart}
              className="rounded-lg px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-low)] transition-colors"
            >
              Restart
            </button>
          </div>
        </div>
      )}
    </>
  )
}
