import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageCircle, X, ChevronRight, ChevronLeft, Bot, ExternalLink, Loader2, CheckCircle2, Globe } from 'lucide-react'
import { apiFetch } from '../utils/apiFetch'
import { useStore } from '../store/useStore'

/**
 * Hybrid Support Chatbot ("Chat with us") — FULL-PAGE experience.
 *
 * Design principles (per product requirements):
 *  - LANGUAGE FIRST: on a fresh chat the very first card asks English or
 *    हिन्दी. Every reply renders in the chosen language. Default: English.
 *  - NO free-text typing anywhere. Users navigate a decision tree of
 *    tap-friendly options, category by category, until they reach an answer
 *    or the end of a flow.
 *  - "Connect to Agent" is NEVER the first thing shown. It only appears at the
 *    END of a flow (or after an answer that warrants it), so users first try
 *    to self-serve — and when they do reach an agent, the ticket is
 *    pre-annotated with everything they clicked (smart context, English-pinned
 *    so agents always read one consistent language).
 *  - Full-page UI with animations everywhere (page slide-up, bubble pop-ins,
 *    staggered options, pulsing FAB, animated loaders) — purely presentational.
 *  - Business logic unchanged: reuses the existing support-ticket backend
 *    (/api/support/ticket), order history (/api/user/orders) and read-only
 *    refund eligibility checks (/api/refund-eligibility/<id>). No backend
 *    changes, no existing flow is touched.
 *  - Rendered ONLY on profile pages (see App.jsx), mobile-first.
 */

// ─── Content tree (bilingual) ────────────────────────────────────────────────
// Every node: { title: {en, hi}, options: [{ label: {en, hi}, next | action }] }
// `action` nodes terminate the guided flow (open a page, or offer agent).
// Agent-ticket context is always tracked from the ENGLISH labels.

const BOT_NAME = 'JDLX Assistant'

const FLOW_TREE = {
  lang_select: {
    title: {
      en: "🌐 Hello! Which language would you like to chat in?",
      hi: "🌐 नमस्ते! आप किस भाषा में बात करना चाहेंगे?",
    },
    options: [
      { label: { en: '🇬🇧 English', hi: '🇬🇧 English' }, lang: 'en' },
      { label: { en: '🇮🇳 हिन्दी', hi: '🇮🇳 हिन्दी' }, lang: 'hi' },
    ],
  },

  root: {
    title: {
      en: "Hello! 👋 I'm the JDLX Assistant. What can I help you with today? Pick a topic below.",
      hi: "नमस्ते! 👋 मैं JDLX Assistant हूँ। आज मैं आपकी क्या मदद कर सकती हूँ? नीचे से कोई topic चुनें।",
    },
    options: [
      { label: { en: '📦 Order / Delivery issue', hi: '📦 Order / Delivery की समस्या' }, next: 'order_issue' },
      { label: { en: '🔄 Exchange & Return', hi: '🔄 Exchange और Return' }, next: 'exchange_return' },
      { label: { en: '💸 Refund & Payment', hi: '💸 Refund और Payment' }, next: 'refund_payment' },
      { label: { en: '🛒 Shopping / Cart help', hi: '🛒 Shopping / Cart मदद' }, next: 'shopping_help' },
      { label: { en: '👤 Account & Login', hi: '👤 Account और Login' }, next: 'account_login' },
      { label: { en: '❓ Other question', hi: '❓ अन्य सवाल' }, next: 'other_question' },
    ],
  },

  // ── Order / Delivery ──────────────────────────────────────────────────────
  order_issue: {
    title: {
      en: "Having an order or delivery issue? What's happening?",
      hi: "Order या Delivery की समस्या है? क्या problem आ रही है?",
    },
    options: [
      { label: { en: '🔍 Where is my order? (Live status)', hi: '🔍 मेरा order कहाँ है? (Live status)' }, next: 'order_live_status' },
      { label: { en: '🚚 Shipping partner / courier tracking', hi: '🚚 Shipping partner / courier ट्रैकिंग' }, next: 'track_shipping' },
      { label: { en: '⏰ Order is late / delivery time', hi: '⏰ Order late है / delivery time' }, next: 'order_late' },
      { label: { en: '❌ Cancel my order', hi: '❌ Order cancel करना है' }, next: 'order_cancel' },
      { label: { en: '📦 Wrong / damaged item received', hi: '📦 गलत / खराब item मिला' }, next: 'order_damaged' },
      { label: { en: '⬅️ Main menu', hi: '⬅️ मुख्य मेनू' }, next: 'root' },
    ],
  },

  // ── Track shipping partner ──────────────────────────────────────────────
  track_shipping: {
    title: {
      en: "Courier partner and tracking details appear right on your order. See live status or learn about partners:",
      hi: "Courier partner और tracking details order के साथ ही दिख जाते हैं। Live status देखें या partner के बारे में जानें:",
    },
    options: [
      { label: { en: '🔍 See live orders + courier', hi: '🔍 Live orders + courier देखें' }, next: 'order_live_status' },
      { label: { en: '🚛 Who are our shipping partners?', hi: '🚛 Shipping partner कौन से हैं?' }, next: 'shipping_partner_info' },
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'order_issue' },
    ],
  },
  shipping_partner_info: {
    title: {
      en: (
        <>
          Two ways your order reaches you:
          <br />• <b>Shiprocket courier</b> — for long-distance orders. AWB number + courier name + ETA appear on the tracking page
          <br />• <b>Local dark-store delivery</b> — nearby orders are delivered by the store itself
          <br /><br />
          As soon as the order is dispatched, the courier name and AWB update instantly on the tracking page.
        </>
      ),
      hi: (
        <>
          आपका order दो तरह से पहुँचता है:
          <br />• <b>Shiprocket courier</b> — लंबी दूरी के orders. AWB number + courier का नाम + ETA tracking page पर मिलता है
          <br />• <b>Local dark-store delivery</b> — आस-पास के orders store खुद deliver करता है
          <br /><br />
          Order dispatch होते ही tracking page पर courier का नाम और AWB तुरंत update हो जाता है।
        </>
      ),
    },
    options: [
      { label: { en: '🔍 Track my order', hi: '🔍 अपना order track करें' }, next: 'order_live_status' },
      { label: { en: '🙋 Connect to an agent', hi: '🙋 Agent से connect करें' }, action: 'agent' },
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'track_shipping' },
    ],
  },

  // ── Exchange & Return ────────────────────────────────────────────────
  exchange_return: {
    title: {
      en: "What would you like to know about exchange or return?",
      hi: "Exchange या Return के बारे में क्या जानना चाहते हैं?",
    },
    options: [
      { label: { en: '↩️ How to raise a return', hi: '↩️ Return request कैसे करें' }, next: 'return_request' },
      { label: { en: '🔄 How exchange works', hi: '🔄 Exchange कैसे करें' }, next: 'exchange_how' },
      { label: { en: '📅 How many days is the return window?', hi: '📅 Return window कितने दिन का है?' }, next: 'return_window' },
      { label: { en: '⬅️ Main menu', hi: '⬅️ मुख्य मेनू' }, next: 'root' },
    ],
  },
  return_request: {
    title: {
      en: (
        <>
          How to raise a Return/Refund:
          <br />1. Within <b>7 days of delivery</b>, open the "Refund Request" page
          <br />2. Select the order and describe the reason in detail
          <br />3. Submit — our team reviews it right away
          <br /><br />
          Live status shows on the "My Refunds" page.
        </>
      ),
      hi: (
        <>
          Return/Refund request ऐसे करें:
          <br />1. Delivery के <b>7 दिन के अंदर</b> "Refund Request" page पर जाएँ
          <br />2. Order select करके reason detail में लिखें
          <br />3. Submit करते ही हमारी team review करती है
          <br /><br />
          Status "My Refunds" page पर live दिखता है।
        </>
      ),
    },
    options: [
      { label: { en: '🔍 Which orders are eligible? (Auto-check)', hi: '🔍 कौन से orders eligible हैं? (Auto-check)' }, next: 'refund_eligibility_check' },
      { label: { en: '📄 Send a refund request', hi: '📄 Refund request भेजें' }, action: 'navigate', to: '/profile/refund-request' },
      { label: { en: '📋 My refund statuses', hi: '📋 मेरे refunds का status' }, action: 'navigate', to: '/profile/my-refunds' },
      { label: { en: '🙋 Connect to an agent', hi: '🙋 Agent से connect करें' }, action: 'agent' },
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'exchange_return' },
    ],
  },
  refund_eligibility_check: {
    // Read-only scan: delivered orders → /api/refund-eligibility/<id> per order.
    // The bot NEVER submits anything here — it only shows what qualifies and
    // deep-links the user to the real request form.
    action: 'eligibility_check',
    title: {
      en: "Checking your delivered orders (read-only — nothing gets submitted)…",
      hi: "आपके delivered orders check हो रहे हैं (सिर्फ़ देखना — कुछ भी submit नहीं होता)…",
    },
    options: [
      { label: { en: '📄 Open the refund request page', hi: '📄 Refund request page खोलें' }, action: 'navigate', to: '/profile/refund-request' },
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'exchange_return' },
    ],
  },
  exchange_how: {
    title: {
      en: (
        <>
          Exchange process:
          <br />• Within <b>7 days of delivery</b>, request an exchange via an agent
          <br />• Defective or wrong products are exchanged for the <b>same model or an equivalent</b>
          <br />• Once approved, the old product is picked up by courier and the new one is shipped
        </>
      ),
      hi: (
        <>
          Exchange process:
          <br />• Delivery के <b>7 दिन के अंदर</b> agent से exchange request करें
          <br />• Defective या गलत product के लिए <b>same model या equivalent</b> exchange होता है
          <br />• Approve होने पर पुराना product courier से pickup होगा, नया भेज दिया जाएगा
        </>
      ),
    },
    options: [
      { label: { en: '🙋 Request an exchange via agent', hi: '🙋 Agent से exchange request करें' }, action: 'agent' },
      { label: { en: '↩️ I want a return instead', hi: '↩️ Return request करना है' }, next: 'return_request' },
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'exchange_return' },
    ],
  },
  return_window: {
    title: {
      en: (
        <>
          Return/Exchange window: <b>7 days</b> (from the delivery date).
          <br /><br />
          Note: each product may have its own policy — the exact window shows in the "Return Policy" section on the product page (decided via Product → Category → Global priority).
        </>
      ),
      hi: (
        <>
          Return/Exchange window: <b>7 दिन</b> (delivery date से)।
          <br /><br />
          Note: हर product की अपनी policy हो सकती है — exact window product page पर "Return Policy" section में दिखती है (Product → Category → Global priority से तय होता है)।
        </>
      ),
    },
    options: [
      { label: { en: '↩️ How to raise a return', hi: '↩️ Return request कैसे करें' }, next: 'return_request' },
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'exchange_return' },
    ],
  },
  order_live_status: {
    action: 'live_orders',
    title: {
      en: "Here are your recent orders — tap a status to see full tracking.",
      hi: "आपके recent orders यहाँ हैं — status पर tap करके पूरा tracking देखें।",
    },
  },
  order_late: {
    title: {
      en: (
        <>
          Understand delivery time:
          <br />• Local (dark store) orders: <b>1-2 days</b>
          <br />• Shiprocket courier orders: <b>3-7 days</b> (ETA shows in order tracking)
          <br /><br />
          If the ETA has passed and the order hasn't arrived, connect with an agent — we'll follow up with the courier immediately.
        </>
      ),
      hi: (
        <>
          Delivery time समझिए:
          <br />• Local (dark store) orders: <b>1-2 दिन</b>
          <br />• Shiprocket courier orders: <b>3-7 दिन</b> (ETA order tracking में दिखता है)
          <br /><br />
          अगर ETA निकल गया है और order नहीं आया, तो agent से connect करें — हम courier से तुरंत follow-up करेंगे।
        </>
      ),
    },
    options: [
      { label: { en: '🔍 See live order status', hi: '🔍 Live order status देखें' }, next: 'order_live_status' },
      { label: { en: '🙋 Connect to an agent', hi: '🙋 Agent से connect करें' }, action: 'agent' },
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'order_issue' },
    ],
  },
  order_cancel: {
    title: {
      en: (
        <>
          To cancel an order:
          <br />• <b>Before dispatch:</b> My Orders → open the order → "Cancel Order" button (if eligible)
          <br />• <b>After dispatch:</b> the order can't be cancelled — after delivery you'll get a return/refund option
        </>
      ),
      hi: (
        <>
          Order cancel करने के लिए:
          <br />• <b>Dispatch होने से पहले:</b> My Orders → order खोलें → "Cancel Order" button मिलेगा (अगर eligible है)
          <br />• <b>Dispatch के बाद:</b> order cancel नहीं हो सकता — delivery के बाद return/refund का option मिलेगा
        </>
      ),
    },
    options: [
      { label: { en: '📦 Open My Orders', hi: '📦 My Orders खोलें' }, action: 'navigate', to: '/profile/orders' },
      { label: { en: '🙋 Connect to an agent', hi: '🙋 Agent से connect करें' }, action: 'agent' },
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'order_issue' },
    ],
  },
  order_damaged: {
    title: {
      en: "Sorry for the trouble! 🙏 We'll act immediately for a wrong or damaged item. Connect with an agent with the issue details — photos/screenshots can be attached to the ticket too.",
      hi: "परेशानी के लिए माफ़ी चाहते हैं! 🙏 गलत या खराब item के लिए हम तुरंत action लेंगे। Issue details के साथ agent से connect करें — photo/screenshot भी ticket में attach हो सकता है।",
    },
    options: [
      { label: { en: '🙋 Connect to an agent', hi: '🙋 Agent से connect करें' }, action: 'agent' },
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'order_issue' },
    ],
  },

  // ── Refund & Payment ─────────────────────────────────────────────────────
  refund_payment: {
    title: {
      en: "Refund or payment issue? What do you need help with?",
      hi: "Refund या Payment की समस्या है? क्या मदद चाहिए?",
    },
    options: [
      { label: { en: '💰 When will my refund arrive', hi: '💰 Refund कब आएगा' }, next: 'refund_when' },
      { label: { en: '🏦 I didn\u2019t get my refund', hi: '🏦 Refund नहीं मिला' }, next: 'refund_missing' },
      { label: { en: '💳 I was charged twice', hi: '💳 Payment दो बार कट गया' }, next: 'payment_double' },
      { label: { en: '👛 How does Wallet work', hi: '👛 Wallet कैसे काम करता है' }, next: 'wallet_help' },
      { label: { en: '⬅️ Main menu', hi: '⬅️ मुख्य मेनू' }, next: 'root' },
    ],
  },
  refund_when: {
    title: {
      en: (
        <>
          Refund timeline:
          <br />• Wallet refunds: <b>instant</b>
          <br />• Bank/UPI refunds: <b>5-7 working days</b> (after bank processing)
          <br /><br />
          Refund status shows on the "My Refunds" page.
        </>
      ),
      hi: (
        <>
          Refund timeline:
          <br />• Wallet refunds: <b>तुरंत (instant)</b>
          <br />• Bank/UPI refunds: <b>5-7 working days</b> (bank processing के बाद)
          <br /><br />
          Refund status "My Refunds" page पर दिखता है।
        </>
      ),
    },
    options: [
      { label: { en: '🔍 Which orders are eligible? (Auto-check)', hi: '🔍 कौन से orders eligible हैं? (Auto-check)' }, next: 'refund_eligibility_check' },
      { label: { en: '📄 Open My Refunds', hi: '📄 My Refunds खोलें' }, action: 'navigate', to: '/profile/my-refunds' },
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'refund_payment' },
    ],
  },
  refund_missing: {
    title: {
      en: "If the refund hasn't arrived even after 7 working days, connect with an agent — we'll follow up with the bank along with the payment reference. Please include the order number in the ticket.",
      hi: "अगर 7 working days के बाद भी refund नहीं आया, तो agent से connect करें — हम payment reference के साथ bank follow-up करेंगे। Ticket में order number ज़रूर लिखें।",
    },
    options: [
      { label: { en: '🙋 Connect to an agent', hi: '🙋 Agent से connect करें' }, action: 'agent' },
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'refund_payment' },
    ],
  },
  payment_double: {
    title: {
      en: "We treat double deductions as urgent. Connect with an agent — we'll refund it immediately with the transaction details.",
      hi: "Double deduction की समस्या हम urgent treat करते हैं। Agent से connect करें — transaction details के साथ तुरंत refund process करेंगे।",
    },
    options: [
      { label: { en: '🙋 Connect to an agent', hi: '🙋 Agent से connect करें' }, action: 'agent' },
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'refund_payment' },
    ],
  },
  wallet_help: {
    title: {
      en: (
        <>
          Wallet: when an order is cancelled, the refund lands in your wallet instantly, and you can pay for any order using your wallet balance.
        </>
      ),
      hi: (
        <>
          Wallet: order cancel होने पर refund तुरंत wallet में आता है, और आप wallet balance से कोई भी order pay कर सकते हैं।
        </>
      ),
    },
    options: [
      { label: { en: '👛 Open Wallet', hi: '👛 Wallet खोलें' }, action: 'navigate', to: '/profile/wallet' },
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'refund_payment' },
    ],
  },

  // ── Shopping / Cart ──────────────────────────────────────────────────────
  shopping_help: {
    title: {
      en: "What shopping help do you need?",
      hi: "Shopping से related क्या मदद चाहिए?",
    },
    options: [
      { label: { en: '🎟️ How to use a coupon', hi: '🎟️ Coupon कैसे use करें' }, next: 'coupon_help' },
      { label: { en: '🚚 Delivery charges / is COD available?', hi: '🚚 Delivery charge / COD available है?' }, next: 'cod_help' },
      { label: { en: '📱 Are products genuine? Warranty?', hi: '📱 Product genuine है? Warranty?' }, next: 'genuine_help' },
      { label: { en: '⬅️ Main menu', hi: '⬅️ मुख्य मेनू' }, next: 'root' },
    ],
  },
  coupon_help: {
    title: {
      en: (
        <>
          On the checkout page, enter the code in the "Apply Coupon" section. Available coupons are always listed on the "Coupons" page.
        </>
      ),
      hi: (
        <>
          Checkout page पर "Apply Coupon" section में code डालें। Available coupons "Coupons" page पर हमेशा listed रहते हैं।
        </>
      ),
    },
    options: [
      { label: { en: '🎟️ See available coupons', hi: '🎟️ Available Coupons देखें' }, action: 'navigate', to: '/profile/coupons' },
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'shopping_help' },
    ],
  },
  cod_help: {
    title: {
      en: (
        <>
          COD availability depends on your pincode — you'll see it right after selecting the address at checkout. Serviceable pincodes get both COD + Prepaid (occasionally prepaid-only).
        </>
      ),
      hi: (
        <>
          COD availability pincode पर depend करती है — checkout पर address select करते ही पता चल जाता है। Serviceable pincodes पर COD + Prepaid दोनों मिलते हैं (कभी-कभी prepaid-only)।
        </>
      ),
    },
    options: [
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'shopping_help' },
      { label: { en: 'Main menu', hi: 'मुख्य मेनू' }, next: 'root' },
    ],
  },
  genuine_help: {
    title: {
      en: (
        <>
          Yes! JDLX Mobile sells 100% genuine products — with brand warranty. Have any doubt? Confirm with an agent.
        </>
      ),
      hi: (
        <>
          हाँ! JDLX Mobile पर 100% genuine products मिलते हैं — brand warranty के साथ। कोई भी doubt हो तो agent से confirm कर लें।
        </>
      ),
    },
    options: [
      { label: { en: '🙋 Connect to an agent', hi: '🙋 Agent से connect करें' }, action: 'agent' },
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'shopping_help' },
    ],
  },

  // ── Account & Login ──────────────────────────────────────────────────────
  account_login: {
    title: {
      en: "Account or login trouble?",
      hi: "Account या Login की दिक्कत है?",
    },
    options: [
      { label: { en: '🔐 I can\u2019t log in', hi: '🔐 Login नहीं हो रहा' }, next: 'login_issue' },
      { label: { en: '📧 Update email / phone', hi: '📧 Email / Phone update करना है' }, next: 'profile_update' },
      { label: { en: '🔑 Change password', hi: '🔑 Password change करना है' }, next: 'password_help' },
      { label: { en: '⬅️ Main menu', hi: '⬅️ मुख्य मेनू' }, next: 'root' },
    ],
  },
  login_issue: {
    title: {
      en: (
        <>
          Common login fixes:
          <br />• Try Google login (fastest)
          <br />• The OTP can take 1-2 minutes to arrive by email/phone — try again
          <br />• Clear browser cache and retry
        </>
      ),
      hi: (
        <>
          Login issues के common fixes:
          <br />• Google login try करें (सबसे fast)
          <br />• OTP email/phone पर आने में 1-2 min लग सकते हैं — दोबारा try करें
          <br />• Browser cache clear करके retry करें
        </>
      ),
    },
    options: [
      { label: { en: '🙋 Connect to an agent', hi: '🙋 Agent से connect करें' }, action: 'agent' },
      { label: { en: '⬅️ Main menu', hi: '⬅️ मुख्य मेनू' }, next: 'root' },
    ],
  },
  profile_update: {
    title: {
      en: "You can update your profile details yourself — on the Settings page.",
      hi: "अपनी profile details आप खुद update कर सकते हैं — Settings page पर।",
    },
    options: [
      { label: { en: '⚙️ Open Profile Settings', hi: '⚙️ Profile Settings खोलें' }, action: 'navigate', to: '/profile/settings' },
      { label: { en: '🙋 Connect to an agent', hi: '🙋 Agent से connect करें' }, action: 'agent' },
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'account_login' },
    ],
  },
  password_help: {
    title: {
      en: "You can change your password from the Security page.",
      hi: "Security page से password change कर सकते हैं।",
    },
    options: [
      { label: { en: '🔒 Open Security page', hi: '🔒 Security page खोलें' }, action: 'navigate', to: '/profile/security' },
      { label: { en: '⬅️ Back', hi: '⬅️ पीछे' }, next: 'account_login' },
    ],
  },

  // ── Other ────────────────────────────────────────────────────────────────
  other_question: {
    title: {
      en: "Anything else? We're happy to help — connect with an agent or pick a common topic.",
      hi: "कोई और सवाल? हम हर तरह से मदद करते हैं — agent से connect करें या common topics चुनें।",
    },
    options: [
      { label: { en: '🙋 Connect to an agent', hi: '🙋 Agent से connect करें' }, action: 'agent' },
      { label: { en: 'ℹ️ About JDLX Mobile', hi: 'ℹ️ JDLX Mobile के बारे में' }, action: 'navigate', to: '/profile/about-site' },
      { label: { en: '📜 Terms & Privacy policy', hi: '📜 Terms और Privacy policy' }, action: 'navigate', to: '/profile/terms' },
      { label: { en: '📋 Report a bug', hi: '📋 Bug report करना है' }, action: 'navigate', to: '/profile/bug-report' },
      { label: { en: '📝 Register a complaint', hi: '📝 Complaint register करना है' }, action: 'navigate', to: '/profile/complaint' },
      { label: { en: '⬅️ Main menu', hi: '⬅️ मुख्य मेनू' }, next: 'root' },
    ],
  },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Resolve a bilingual value ({en, hi}) for a language. Plain strings/JSX pass
// through untouched. (React elements are objects but never have an 'en' key.)
const pick = (v, lang) => (v && typeof v === 'object' && 'en' in v ? (v[lang] ?? v.en) : v)

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

// Animations (self-contained — same pattern as OnboardingGuide's FLOAT_CSS).
const CHAT_CSS = `
@keyframes jdlx-chat-page-in {
  from { transform: translateY(30px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
@keyframes jdlx-bubble-in {
  from { transform: translateY(10px) scale(0.97); opacity: 0; }
  to { transform: translateY(0) scale(1); opacity: 1; }
}
@keyframes jdlx-opt-in {
  from { transform: translateX(-12px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes jdlx-fab-pop {
  0% { transform: scale(0); }
  70% { transform: scale(1.12); }
  100% { transform: scale(1); }
}
@keyframes jdlx-fab-ring {
  0% { box-shadow: 0 0 0 0 rgba(245,158,11,0.45); }
  70% { box-shadow: 0 0 0 16px rgba(245,158,11,0); }
  100% { box-shadow: 0 0 0 0 rgba(245,158,11,0); }
}
@keyframes jdlx-chat-dot {
  0%, 80%, 100% { transform: scale(0.5); opacity: 0.35; }
  40% { transform: scale(1); opacity: 1; }
}
@keyframes jdlx-block-in {
  from { transform: translateY(8px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
`

// Animated typing dots (used inside loading blocks).
function ChatDots() {
  return (
    <span className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-primary"
          style={{ animation: `jdlx-chat-dot 1.2s ease-in-out ${i * 0.18}s infinite` }}
        />
      ))}
    </span>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ChatWidget() {
  const user = useStore((state) => state.user)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  // Chat language — DEFAULT ENGLISH (product requirement). Remembered across
  // sessions, but the language card is still the first card of a fresh chat.
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('jdlx_chat_lang') === 'hi' ? 'hi' : 'en' } catch { return 'en' }
  })
  const [messages, setMessages] = useState([])
  const [path, setPath] = useState(['lang_select'])
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [orders, setOrders] = useState(null)
  const [creatingTicket, setCreatingTicket] = useState(false)
  const [createdTicket, setCreatedTicket] = useState(null)
  // Read-only refund eligibility scan results (per delivered order).
  const [eligibility, setEligibility] = useState(null) // { checking, results: [{orderId, status, eligible, reason, daysRemaining}] }
  const scrollRef = useRef(null)
  // Human-readable trail of what the user clicked — attached to the agent
  // ticket so the support agent sees the full chatbot journey (smart context).
  // Always tracked in ENGLISH so agents read one consistent language.
  const agentTopic = useRef(null)
  const agentPath = useRef([])

  const currentNodeId = path[path.length - 1]

  // Push a bot message into the transcript when the current node changes.
  // Each bubble snapshots the language it was rendered in, so switching the
  // language mid-chat never rewrites history.
  useEffect(() => {
    if (!open) return
    setMessages((prev) => {
      if (prev.length && prev[prev.length - 1].nodeId === currentNodeId) return prev
      return [...prev, { id: nextId(), from: 'bot', nodeId: currentNodeId, lang }]
    })
  }, [open, currentNodeId, lang])

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
    // Keep the chosen language; the flow restarts from the main menu.
    setPath(lang === 'hi' || lang === 'en' ? ['root'] : ['lang_select'])
    setOrders(null)
    setCreatedTicket(null)
    setEligibility(null)
    agentTopic.current = null
    agentPath.current = []
  }, [lang])

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
          return { orderId: o.id, orderNumber: o.order_number || o.id, eligible: false, reason: lang === 'hi' ? 'Check fail हुआ — थोड़ी देर बाद try करें' : 'Check failed — please try again shortly' }
        }
      }))
      setEligibility({ checking: false, results })
    } catch {
      setEligibility({ checking: false, results: [] })
    }
  }, [eligibility?.checking, lang])

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
    // Language choice — set the chat language, greet in it, enter the main menu.
    if (opt.lang) {
      const chosen = opt.lang
      setLang(chosen)
      try { localStorage.setItem('jdlx_chat_lang', chosen) } catch { /* private mode */ }
      agentPath.current = [...agentPath.current, `Language: ${chosen === 'hi' ? 'Hindi' : 'English'}`]
      setMessages((prev) => [...prev, {
        id: nextId(),
        from: 'bot',
        lang: chosen,
        text: chosen === 'hi'
          ? 'बढ़िया! अब मैं हिन्दी में बात करूँगी। 😊'
          : 'Great! English it is. 😊',
      }])
      go('root')
      return
    }

    // Track the clicked labels so the agent ticket contains the real path
    // (English-pinned — agent-side context stays consistent).
    const trackLabel = pick(opt.label, 'en')
    if (!trackLabel.startsWith('⬅️') && !trackLabel.startsWith('Main menu')) {
      agentPath.current = [...agentPath.current, trackLabel]
      if (agentTopic.current === null) {
        agentTopic.current = trackLabel.replace(/^\S+\s/, '')
      }
    }

    if (opt.action === 'agent') {
      setMessages((prev) => [...prev, {
        id: nextId(),
        from: 'bot',
        lang,
        kind: 'agent_connect',
        text: lang === 'hi' ? 'एक minute — agent से connect कर रही हूँ…' : 'One moment — connecting you to a support agent…',
      }])
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
  }, [connectAgent, go, navigate, lang])

  const handleOpen = () => {
    // Fresh chat → ALWAYS start with the language card (product requirement).
    if (!open && messages.length === 0) {
      setPath(['lang_select'])
    }
    setOpen((o) => !o)
  }

  // Mid-chat language switch — future content only (old bubbles keep their
  // snapshot language).
  const toggleLang = () => {
    const next = lang === 'en' ? 'hi' : 'en'
    setLang(next)
    try { localStorage.setItem('jdlx_chat_lang', next) } catch { /* private mode */ }
  }

  if (!user) return null

  const isHi = lang === 'hi'

  return (
    <>
      <style>{CHAT_CSS}</style>

      {/* Floating button — bottom-right, above bottom nav */}
      <button
        onClick={handleOpen}
        aria-label="Chat with us"
        className="fixed bottom-24 right-4 z-50 grid h-14 w-14 place-items-center rounded-full bg-primary text-white shadow-xl shadow-primary/30 transition-transform duration-300 hover:scale-105 active:scale-95"
        style={{
          animation: 'jdlx-fab-pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both, jdlx-fab-ring 2.4s ease-out 1s infinite',
          ...(open ? { display: 'none' } : {}),
        }}
      >
        <MessageCircle size={24} />
      </button>

      {/* Chat — FULL PAGE experience */}
      {open && (
        <div
          className="fixed inset-0 z-[10070] flex flex-col overflow-hidden bg-[var(--color-surface-low)] text-[var(--color-on-surface)]"
          style={{ animation: 'jdlx-chat-page-in 280ms ease-out both' }}
          role="dialog"
          aria-label="Support chat"
        >
          {/* Decorative background blobs */}
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute -left-20 top-1/3 h-64 w-64 rounded-full bg-amber-300/10 blur-3xl" />

          {/* Header */}
          <div className="relative shrink-0 bg-gradient-to-r from-primary to-amber-600 px-4 pb-4 pt-5 text-white shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/20 shadow-inner">
                  <Bot size={22} />
                </div>
                <div>
                  <div className="text-base font-black tracking-wide">{BOT_NAME}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest opacity-90">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
                    Online • {isHi ? 'हर समय मदद के लिए' : 'Here to help 24×7'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Language switcher — switches future content */}
                <button
                  onClick={toggleLang}
                  aria-label="Switch language"
                  className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-2 text-[11px] font-black backdrop-blur transition-all hover:bg-white/25 active:scale-90"
                >
                  <Globe size={13} />
                  {isHi ? 'हिं' : 'EN'}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close chat"
                  className="grid h-10 w-10 place-items-center rounded-full transition-all hover:bg-white/15 active:scale-90"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-md space-y-3 px-4 py-4">
              {messages.map((m) => {
                const msgLang = m.lang || 'en'
                const node = m.nodeId ? FLOW_TREE[m.nodeId] : null
                const isLast = m.id === messages[messages.length - 1]?.id
                return (
                  <div key={m.id} className="space-y-2">
                    <div className="flex items-start gap-2" style={{ animation: 'jdlx-bubble-in 260ms ease-out both' }}>
                      <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                        <Bot size={14} />
                      </div>
                      <div className="rounded-2xl rounded-tl-sm border border-[var(--color-outline-variant)] bg-white px-4 py-3 text-[13px] font-medium leading-relaxed text-[var(--color-on-surface)] shadow-sm dark:bg-[var(--color-surface-container)]">
                        {m.text || pick(node?.title, msgLang) || '…'}
                      </div>
                    </div>

                    {/* Options for this node (staggered entrance) */}
                    {node?.options && isLast && (
                      <div className="space-y-2 pl-9">
                        {node.options.map((opt, i) => (
                          <button
                            key={pick(opt.label, 'en')}
                            onClick={() => selectOption(opt)}
                            className="flex w-full items-center justify-between gap-2 rounded-2xl border border-primary/25 bg-white px-4 py-3 text-left text-[12.5px] font-bold text-[var(--color-on-surface)] shadow-sm transition-all hover:border-primary/60 hover:bg-primary/5 hover:shadow active:scale-[0.98] dark:bg-[var(--color-surface-container)]"
                            style={{ animation: `jdlx-opt-in 280ms ease-out ${i * 60}ms both` }}
                          >
                            <span>{pick(opt.label, lang)}</span>
                            <ChevronRight size={15} className="shrink-0 text-primary" />
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Live orders block */}
                    {m.nodeId === 'order_live_status' && isLast && (
                      <div className="pl-9" style={{ animation: 'jdlx-block-in 240ms ease-out both' }}>
                        {loadingOrders ? (
                          <div className="flex items-center gap-2.5 rounded-2xl border border-[var(--color-outline-variant)] bg-white px-4 py-3.5 text-[12px] font-bold text-[var(--color-on-surface-variant)] shadow-sm dark:bg-[var(--color-surface-container)]">
                            <Loader2 size={14} className="animate-spin text-primary" />
                            {pick({ en: 'Loading your orders…', hi: 'आपके orders load हो रहे हैं…' }, lang)}
                            <ChatDots />
                          </div>
                        ) : !orders || orders.length === 0 ? (
                          <div className="rounded-2xl border border-[var(--color-outline-variant)] bg-white px-4 py-3.5 text-[12px] font-bold text-[var(--color-on-surface-variant)] shadow-sm dark:bg-[var(--color-surface-container)]">
                            {pick({ en: 'No orders found yet. Shop around and your live status will appear here! 🛍️', hi: 'अभी कोई order नहीं मिला। Shopping करें और यहाँ live status देखें! 🛍️' }, lang)}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {orders.map((o, i) => (
                              <button
                                key={o.id}
                                onClick={() => { setOpen(false); navigate(`/track/${o.order_number || o.id}`) }}
                                className="w-full rounded-2xl border border-[var(--color-outline-variant)] bg-white px-4 py-3 text-left shadow-sm transition-all hover:border-primary/50 active:scale-[0.98] dark:bg-[var(--color-surface-container)]"
                                style={{ animation: `jdlx-opt-in 260ms ease-out ${i * 60}ms both` }}
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
                                    {pick({ en: 'Track', hi: 'ट्रैक' }, lang)} <ExternalLink size={10} />
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Read-only refund eligibility scan block */}
                    {m.nodeId === 'refund_eligibility_check' && isLast && (
                      <div className="pl-9" style={{ animation: 'jdlx-block-in 240ms ease-out both' }}>
                        {(eligibility?.checking || !eligibility) ? (
                          <div className="flex items-center gap-2.5 rounded-2xl border border-[var(--color-outline-variant)] bg-white px-4 py-3.5 text-[12px] font-bold text-[var(--color-on-surface-variant)] shadow-sm dark:bg-[var(--color-surface-container)]">
                            <Loader2 size={14} className="animate-spin text-primary" />
                            {pick({ en: 'Checking your orders…', hi: 'आपके orders check हो रहे हैं…' }, lang)}
                            <ChatDots />
                          </div>
                        ) : eligibility.results.length === 0 ? (
                          <div className="rounded-2xl border border-[var(--color-outline-variant)] bg-white px-4 py-3.5 text-[12px] font-bold text-[var(--color-on-surface-variant)] shadow-sm dark:bg-[var(--color-surface-container)]">
                            {pick({ en: 'No delivered orders to check. A refund is possible only within 7 days of delivery.', hi: 'Check करने के लिए कोई delivered order नहीं मिला। Refund delivery के 7 दिन के अंदर ही possible है।' }, lang)}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {eligibility.results.map((r, i) => (
                              <div
                                key={r.orderId}
                                className={`rounded-2xl border px-4 py-3 shadow-sm ${r.eligible ? 'border-green-200 bg-green-50 dark:bg-green-950/30' : 'border-[var(--color-outline-variant)] bg-white dark:bg-[var(--color-surface-container)]'}`}
                                style={{ animation: `jdlx-opt-in 260ms ease-out ${i * 60}ms both` }}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11px] font-black text-[var(--color-on-surface)]">#{r.orderNumber}</span>
                                  {r.eligible ? (
                                    <span className="rounded-full border border-green-300 bg-green-100 px-2 py-0.5 text-[9px] font-black uppercase text-green-700">
                                      {pick({ en: 'Eligible', hi: 'Eligible' }, lang)}{r.daysRemaining != null ? (msgLang === 'hi' || lang === 'hi' ? ` • ${r.daysRemaining} दिन बचे` : ` • ${r.daysRemaining} days left`) : ''}
                                    </span>
                                  ) : (
                                    <span className="rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-[9px] font-black uppercase text-gray-600">
                                      {pick({ en: 'Not eligible', hi: 'Eligible नहीं' }, lang)}
                                    </span>
                                  )}
                                </div>
                                {!r.eligible && r.reason && (
                                  <div className="mt-1 text-[10px] font-bold text-[var(--color-on-surface-variant)]">{r.reason}</div>
                                )}
                                {r.eligible && (
                                  <button
                                    onClick={() => { setOpen(false); navigate(`/profile/refund-request?order_id=${r.orderId}`) }}
                                    className="mt-1.5 flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-green-700 underline"
                                  >
                                    {pick({ en: 'Open refund request for this order', hi: 'इस order का refund request खोलें' }, lang)} <ExternalLink size={10} />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Agent handoff result block */}
                    {(creatingTicket || createdTicket) && m.kind === 'agent_connect' && isLast && (
                      <div className="pl-9" style={{ animation: 'jdlx-block-in 240ms ease-out both' }}>
                        {creatingTicket ? (
                          <div className="flex items-center gap-2.5 rounded-2xl border border-[var(--color-outline-variant)] bg-white px-4 py-3.5 text-[12px] font-bold text-[var(--color-on-surface-variant)] shadow-sm dark:bg-[var(--color-surface-container)]">
                            <Loader2 size={14} className="animate-spin text-primary" />
                            {pick({ en: 'Creating your ticket…', hi: 'Ticket बन रहा है…' }, lang)}
                            <ChatDots />
                          </div>
                        ) : createdTicket?.error ? (
                          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5 text-[12px] font-bold text-red-700 dark:bg-red-950/30">
                            {pick({ en: 'Couldn\u2019t create the ticket. Please raise one manually from Profile → Support, or try again shortly.', hi: 'Ticket नहीं बन पाया। Profile → Support से manual ticket बनाएँ, या थोड़ी देर बाद try करें।' }, lang)}
                          </div>
                        ) : (
                          <div className="space-y-2 rounded-2xl border border-green-200 bg-green-50 px-4 py-3.5 dark:bg-green-950/30">
                            <div className="flex items-center gap-2 text-[12px] font-black text-green-700">
                              <CheckCircle2 size={14} />
                              {pick({ en: `Ticket ${createdTicket.ticket_number} created!`, hi: `Ticket ${createdTicket.ticket_number} बन गया!` }, lang)}
                            </div>
                            <div className="text-[11px] font-bold text-green-600/80">
                              {pick({ en: 'An agent will reply within 24-48 hours. The reply notification will appear in your profile.', hi: 'Agent 24-48 hours में reply करेगा। Reply notification profile में आएगा।' }, lang)}
                            </div>
                            {createdTicket.ticket_id && (
                              <button
                                onClick={() => { setOpen(false); navigate(`/profile/support/ticket/${createdTicket.ticket_id}`) }}
                                className="text-[11px] font-black uppercase tracking-wider text-green-700 underline"
                              >
                                {pick({ en: 'Open ticket →', hi: 'Ticket खोलें →' }, lang)}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Footer controls — no free-text input by design */}
          <div
            className="relative shrink-0 border-t border-[var(--color-outline-variant)] bg-white px-4 py-2.5 dark:bg-[var(--color-surface-container)]"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 10px)' }}
          >
            <div className="mx-auto flex w-full max-w-md items-center justify-between">
              <button
                onClick={back}
                disabled={path.length <= 1}
                className="flex items-center gap-1 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[var(--color-on-surface-variant)] transition-all hover:bg-[var(--color-surface-low)] active:scale-95 disabled:opacity-30"
              >
                <ChevronLeft size={14} /> {pick({ en: 'Back', hi: 'पीछे' }, lang)}
              </button>
              <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--color-on-surface-variant)] opacity-60">
                🛡️ JDLX Care • 24×7
              </span>
              <button
                onClick={restart}
                className="rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[var(--color-on-surface-variant)] transition-all hover:bg-[var(--color-surface-low)] active:scale-95"
              >
                {pick({ en: 'Restart', hi: 'फिर से' }, lang)}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
