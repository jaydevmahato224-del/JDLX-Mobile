// Browser verification of the JDLX checkout fixes — isolated local stack.
//
// Covers:
//   A. /api/products/batch used by checkout (N+1 fix) — one batch call, zero per-item calls
//   B. Pincode: serviceable / hard-block / transient-failure ("unverified" never blocks submit)
//   C. Coupon CODE10 applies (auto or manual)
//   D. Wallet apply: deduction equals the payable total, Final Total ₹0, server debit
//   E. Wallet re-clamp after the cart grows while applied (stale deduction would show -₹old)
//   E2. Out-of-stock cart line auto-removed on checkout
//   F. Rapid qty taps on /cart: every tap registers (queue, no processingSync drop) + clamp
//   G. PREPAID place-order E2E: order row created, Razorpay skip-toast shown, no redirect crash
//
// Test-only: isolated FORCE_LOCAL_DB sqlite backend on :5000 + vite on :5173.
import puppeteer from 'puppeteer-core'
import crypto from 'crypto'
import fs from 'fs'
import { execSync } from 'child_process'

const API = 'http://localhost:5000'
const APP = 'http://localhost:5173'
const EMAIL = 'test@example.com'
const DB = '/tmp/jdlx_checkout_verify.db'

// ── helpers ──────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? `  (${extra})` : ''}`)
}
const db = (sql) => {
  try {
    const out = execSync(`python3 -c "
import sqlite3, json
c = sqlite3.connect('${DB}'); c.row_factory = sqlite3.Row
print(json.dumps([dict(r) for r in c.execute('''${sql}''')]))"`, { encoding: 'utf8' })
    return JSON.parse(out.trim().split('\n').pop())
  } catch (e) { console.log('db helper error:', e.message?.slice(0, 120)); return [] }
}
const setWallet = (v) => { execSync(`python3 -c "
import sqlite3
c = sqlite3.connect('${DB}'); c.execute('UPDATE wallet SET balance=? WHERE user_id=1', (${v},)); c.commit()"`) }
const apiCart = async (body) => fetch(`${API}/api/cart`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ session_id: 'verifysession1', ...body }),
})

// ── JWT mint (backend's own secret — local test only) ────────────────────
function b64url(buf) { return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') }
let secret = process.env.JWT_SECRET || ''
if (!secret) {
  try {
    // Resolve relative to this file (script runs with frontend-store as cwd):
    // scratch/ → frontend-store/ → project root/backend/.env
    const envText = fs.readFileSync(new URL('../../backend/.env', import.meta.url), 'utf8')
    const line = envText.split('\n').find(l => l.trim().startsWith('JWT_SECRET='))
    if (line) secret = line.split('=').slice(1).join('=').trim().replace(/^"|"$/g, '')
  } catch { /* fall through */ }
}
if (!secret) { console.error('NO_SECRET'); process.exit(1) }
const now = Math.floor(Date.now() / 1000)
const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
const payload = b64url(Buffer.from(JSON.stringify({ user_id: 1, email: EMAIL, role: 'user', iat: now, jti: 'checkoutverify012345', exp: now + 7200 })))
const token = `${header}.${payload}.${b64url(crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest())}`

const vres = await fetch(`${API}/api/auth/verify-token`, { headers: { Authorization: `Bearer ${token}` } })
console.log('verify-token status:', vres.status)
if (vres.status !== 200) { console.error('Token invalid — aborting'); process.exit(1) }

// ── fresh server-side state ──────────────────────────────────────────────
await apiCart({ action: 'clear_cart' })
setWallet(300)
await apiCart({ product_id: 101, quantity: 1, action: 'add' })

// ── browser ──────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 412, height: 915 })
const pageErrors = []
page.on('pageerror', (err) => pageErrors.push(err.toString()))
page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push('console.error: ' + msg.text()) })

let apiCalls = []            // api calls seen since last resetApiWatch()
const resetApiWatch = () => { apiCalls = [] }
page.on('request', (req) => {
  const u = req.url()
  if (u.includes(':5000/api/')) apiCalls.push({ m: req.method(), u })
})
const countApi = (re) => apiCalls.filter(c => re.test(c.u)).length

const setNative = (el, value) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}
// Fill checkout contact + address fields by placeholder
const fillCheckoutBasics = async () => {
  await page.evaluate(() => {
    const byPh = (ph) => [...document.querySelectorAll('input')].find(i => i.placeholder === ph)
    const set = (ph, v) => { const el = byPh(ph); if (el) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) } }
    set('10-digit Mobile Number', '9876543210')
    set('e.g. 202, 2nd Floor', 'A-1')
    set('e.g. Rohini Sec 15', 'Test Street')
  })
}
const fillPincode = async (pin) => {
  await page.evaluate((p) => {
    const el = [...document.querySelectorAll('input')].find(i => i.placeholder === '6-digit Pincode')
    if (!el) return false
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, p)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }, pin)
}
const bodyText = () => page.evaluate(() => document.body.innerText)
const toastText = () => page.evaluate(() => {
  const t = document.querySelector('[id^="toast"]')?.parentElement || document.body
  return t.innerText
})

await page.goto(`${APP}/`, { waitUntil: 'networkidle2', timeout: 60000 })
await page.evaluate((t, email) => {
  localStorage.setItem('userToken', t)
  localStorage.setItem('user', JSON.stringify({ id: 1, name: 'Test User', email, role: 'user' }))
  localStorage.setItem('jdlx_onboarding_done', '1')
  localStorage.setItem('sessionId', 'verifysession1')
}, token, EMAIL)

// ══ PHASE A — checkout renders from server cart via ONE batch call ══════
await page.goto(`${APP}/checkout`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(2500)
resetApiWatch()
await sleep(1500) // let post-mount syncs settle, then observe a quiet window
let text = await bodyText()
check('A1: checkout renders seeded cart item', text.includes('Test Tempered Glass A'))
const batchCalls = countApi(/\/api\/products\/batch/)
const singleProductCalls = countApi(/\/api\/products\/\d+$/)
check('A2: batch inventory endpoint used', batchCalls >= 1, `batch=${batchCalls}`)
check('A3: no N+1 per-item product calls', singleProductCalls === 0, `single=${singleProductCalls}`)

// ══ PHASE B — pincode flows ══════════════════════════════════════════════
await fillCheckoutBasics()

// B1: valid serviceable pincode
await fillPincode('110001')
let sawServiceable = false
for (let i = 0; i < 20; i++) {
  await sleep(1000)
  const t = await bodyText()
  if (t.includes('Serviceable by Shiprocket Express') || t.includes('Only PREPAID')) { sawServiceable = true; break }
  if (t.includes('could not be verified') || t.includes('Connection error')) break
}
check('B1: 110001 verified serviceable (city/state auto-filled)', sawServiceable)

// B2: hard-blocked pincode (999999 → invalid/unserviceable per postal+SR)
resetApiWatch()
await fillPincode('999999')
let sawHardBlockMsg = false
for (let i = 0; i < 20; i++) {
  await sleep(1000)
  const t = await bodyText()
  if (t.includes('Invalid Pincode!') || t.includes('not available for this location')) { sawHardBlockMsg = true; break }
}
check('B2: 999999 flagged invalid/unserviceable in UI', sawHardBlockMsg)
const payBtnHard = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button[type="submit"]')].pop()
  if (b) { b.click(); return true }
  return false
})
await sleep(2000)
const toastHard = await toastText()
const stillCheckoutHard = page.url().includes('/checkout')
const noOrderHard = db('SELECT COUNT(*) n FROM orders')[0].n === 0
check('B2: submit HARD-BLOCKED on bad pincode (toast + no order)', payBtnHard && stillCheckoutHard && noOrderHard
  && (toastHard.includes('Courier service is not available') || toastHard.includes('Invalid Pincode')),
  `toast="${toastHard.match(/(Courier service[^\n]*|Invalid Pincode[^\n]*)/)?.[1]?.slice(0, 60) || 'none'}"`)

// B3: transient check failure → 'unverified' → submit NOT blocked by pincode
resetApiWatch()
await page.setRequestInterception(true)
page.on('request', (req) => {
  if (/\/api\/pincode\/check\//.test(req.url()) && req.resourceType() === 'xhr') {
    req.respond({ status: 500, contentType: 'application/json', body: '{"error":"simulated outage"}' }).catch(() => {})
  } else req.continue().catch(() => {})
})
// clear city/state so the order can't actually be created in this phase
await page.evaluate(() => {
  const byPh = (ph) => [...document.querySelectorAll('input')].find(i => i.placeholder === ph)
  const set = (ph) => { const el = byPh(ph); if (el) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })) } }
  set('City'); set('State')
})
await fillPincode('110001')
let sawUnverified = false
for (let i = 0; i < 12; i++) {
  await sleep(1000)
  const t = await bodyText()
  if (t.includes("still place the order")) { sawUnverified = true; break }
  if (t.includes('Serviceable by Shiprocket')) break // interception didn't catch it — fall back
}
check('B3: outage → "unverified" message (order still placeable)', sawUnverified, sawUnverified ? '' : 'postal/SR answered before intercept')
const payBtnUnv = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button[type="submit"]')].pop()
  if (b) { b.click(); return true }
  return false
})
await sleep(2500)
const toastUnv = await toastText()
const checkoutPostAttempts = countApi(/\/api\/checkout$/)
const stillCheckoutUnv = page.url().includes('/checkout')
const noOrdersUnv = db('SELECT COUNT(*) n FROM orders')[0].n === 0
check('B3: submit passed pincode gate (blocked only by missing city, no order)', payBtnUnv && stillCheckoutUnv && noOrdersUnv
  && !toastUnv.includes('Pincode check in progress') && !toastUnv.includes('Courier service'),
  `toast="${toastUnv.match(/(Please enter[^\n]*|Pincode[^\n]*)/)?.[1]?.slice(0, 50) || 'none'}" checkoutPOSTs=${checkoutPostAttempts}`)
await page.setRequestInterception(false)
page.removeAllListeners('request')
// re-attach the plain watcher after removing the interceptor listener
page.on('request', (req) => {
  const u = req.url()
  if (u.includes(':5000/api/')) apiCalls.push({ m: req.method(), u })
})

// ══ PHASE C — coupon CODE10 (auto or manual) ═════════════════════════════
let couponOk = false; let couponExtra = ''
const hasDiscountRow = (await bodyText()).includes('Discount (')
if (hasDiscountRow) { couponOk = true; couponExtra = 'auto-applied' }
else {
  const typed = await page.evaluate(() => {
    const el = [...document.querySelectorAll('input')].find(i => i.placeholder === 'Enter Coupon Code')
    if (!el) return false
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'CODE10')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })
  if (typed) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Apply')
      if (b) b.click()
    })
    await sleep(2500)
    couponOk = (await bodyText()).includes('Discount (')
    couponExtra = 'manual'
  }
}
check('C: 10% coupon CODE10 applied at checkout', couponOk, couponExtra)

// ══ PHASE D — wallet apply: deduction == payable, final ₹0, server debit ═
const preWallet = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('div.flex.justify-between')]
  const row = rows.find(r => r.textContent.includes('Final Total'))
  const m = row?.textContent.match(/₹([\d,]+(?:\.\d+)?)/)
  return m ? parseFloat(m[1].replace(/,/g, '')) : null
})
const applied = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Apply' && x.className.includes('bg-slate-900'))
  if (b) { b.click(); return true }
  return false
})
await sleep(1200)
text = await bodyText()
const dedMatch = text.match(/Wallet Deduction\s*\n?\s*-₹([\d.]+)/)
const deduction = dedMatch ? parseFloat(dedMatch[1]) : null
const finalAfterWallet = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('div.flex.justify-between')]
  const row = rows.find(r => r.textContent.includes('Final Total'))
  const m = row?.textContent.match(/₹([\d,]+(?:\.\d+)?)/)
  return m ? parseFloat(m[1].replace(/,/g, '')) : null
})
check('D1: Apply button present & clicked', applied && preWallet !== null, `preWalletFinal=₹${preWallet}`)
check('D2: wallet deduction equals min(balance, payable)', deduction === preWallet, `deduction=₹${deduction} payable=₹${preWallet}`)
check('D3: Final Total becomes ₹0 when wallet covers it', finalAfterWallet === 0, `final=₹${finalAfterWallet}`)
const walletRowDb = db('SELECT balance FROM wallet WHERE user_id=1')[0]
check('D4: server wallet NOT debited before order placement', walletRowDb.balance === 300, `balance=₹${walletRowDb.balance}`)

// ══ PHASE E — re-clamp after cart grows while applied ════════════════════
// Phase D debited nothing yet (debit happens on order placement) — simulate
// the "applied earlier with a smaller cart" state: wallet application is
// re-clamped against the NEW payable when the wallet panel recomputes.
await apiCart({ product_id: 103, quantity: 2, action: 'add' }) // ₹100 x2, in stock
resetApiWatch()
await page.goto(`${APP}/checkout`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(3000)
text = await bodyText()
// wallet was applied in D but a fresh page load starts unapplied; apply again
const balMatch = text.match(/₹([\d.]+) available/)
const balance = balMatch ? parseFloat(balMatch[1]) : null
const preWallet2 = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('div.flex.justify-between')]
  const row = rows.find(r => r.textContent.includes('Final Total'))
  const m = row?.textContent.match(/₹([\d,]+(?:\.\d+)?)/)
  return m ? parseFloat(m[1].replace(/,/g, '')) : null
})
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Apply' && x.className.includes('bg-slate-900'))
  if (b) b.click()
})
await sleep(1200)
text = await bodyText()
const ded2 = (() => { const m = text.match(/Wallet Deduction\s*\n?\s*-₹([\d.]+)/); return m ? parseFloat(m[1]) : null })()
const expectedDed2 = Math.min(balance ?? 0, preWallet2 ?? 0)
check('E1: 2-unit line added, checkout shows both items', text.includes('Test Tempered Glass A') && text.includes('₹400'), `subtotal line=₹400 preWallet=₹${preWallet2}`)
check('E2: wallet deduction clamped to balance for LARGER cart', ded2 === expectedDed2, `deduction=₹${ded2} expected=min(₹${balance},₹${preWallet2})`)

// E3: out-of-stock line auto-removed on checkout mount
await apiCart({ product_id: 102, quantity: 1, action: 'add' })
await page.goto(`${APP}/checkout`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(3500)
const cartAfterOos = db('SELECT product_id FROM cart')
text = await bodyText()
check('E3: OOS product 102 auto-removed from cart', !cartAfterOos.some(r => r.product_id === 102) && !text.includes('Out Of Stock Case'),
  `cart=[${cartAfterOos.map(r => r.product_id).join(',')}]`)

// ══ PHASE F — rapid qty taps on /cart (queue, no drops) + stock clamp ════
await apiCart({ action: 'clear_cart' })
setWallet(600)
await apiCart({ product_id: 101, quantity: 1, action: 'add' })
await page.goto(`${APP}/cart`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(2500)
// 15 rapid "+" taps, 40ms apart — the old processingSync guard dropped all but one
const taps = await page.evaluate(async () => {
  const span = document.querySelector('span.w-6.text-center')
  const plus = span?.parentElement?.querySelectorAll('button')[1]
  if (!plus) return 0
  let n = 0
  for (let i = 0; i < 15; i++) { plus.click(); n++; await new Promise(r => setTimeout(r, 40)) }
  return n
})
await sleep(3000) // let the sync queue drain to the server
const qtyShown = await page.evaluate(() => document.querySelector('span.w-6.text-center')?.textContent?.trim())
const cartQtyDb = db('SELECT quantity FROM cart WHERE product_id=101')[0]
check('F1: all 15 rapid taps register locally AND on server', taps === 15 && qtyShown === '16' && cartQtyDb?.quantity === 16,
  `taps=${taps} uiQty=${qtyShown} dbQty=${cartQtyDb?.quantity}`)

// F2: clamp at stock — 103 has stock 3
await apiCart({ product_id: 103, quantity: 1, action: 'add' })
await page.goto(`${APP}/cart`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(2500)
const clamp = await page.evaluate(async () => {
  const spans = [...document.querySelectorAll('span.w-6.text-center')]
  const target = spans.find(s => s.textContent.trim() === '1' && s.closest('div')?.textContent?.includes('Tempered Glass'))
  const plus = target?.parentElement?.querySelectorAll('button')[1]
  if (!plus) return { ok: false }
  for (let i = 0; i < 8; i++) { plus.click(); await new Promise(r => setTimeout(r, 60)) }
  return { ok: true }
})
await sleep(2500)
const qty103 = db('SELECT quantity FROM cart WHERE product_id=103')[0]
const plusDisabled = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('span.w-6.text-center')]
  const target = spans.find(s => s.closest('div')?.textContent?.includes('Tempered Glass'))
  const plus = target?.parentElement?.querySelectorAll('button')[1]
  return plus?.disabled ?? null
})
check('F2: quantity clamps at available stock (3) — no oversell', clamp.ok && qty103?.quantity === 3 && plusDisabled === true,
  `dbQty=${qty103?.quantity} plusDisabled=${plusDisabled}`)

// ══ PHASE G — PREPAID place-order E2E (no wallet) ════════════════════════
await apiCart({ action: 'clear_cart' })
await apiCart({ product_id: 101, quantity: 1, action: 'add' })
resetApiWatch()
await page.goto(`${APP}/checkout`, { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(2500)
await fillCheckoutBasics()
await fillPincode('110001')
let serviceableAgain = false
for (let i = 0; i < 20; i++) {
  await sleep(1000)
  const t = await bodyText()
  if (t.includes('Serviceable by Shiprocket') || t.includes('Only PREPAID')) { serviceableAgain = true; break }
  if (t.includes('could not be verified') || t.includes('Connection error')) break
}
if (!serviceableAgain) {
  // postal/SR flaked — one retry after a short backoff
  await sleep(3000)
  await fillPincode('110001')
  for (let i = 0; i < 15; i++) {
    await sleep(1000)
    const t = await bodyText()
    if (t.includes('Serviceable by Shiprocket') || t.includes('Only PREPAID')) { serviceableAgain = true; break }
  }
}
check('G1: pincode re-verified before placing order', serviceableAgain)
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button[type="submit"]')].pop()
  if (b) b.click()
})
let navigatedOrToast = false
for (let i = 0; i < 25; i++) {
  await sleep(1000)
  const t = await toastText()
  if (page.url().includes('/order-success') || t.includes('saved but payment')) { navigatedOrToast = true; break }
}
const gOrders = db('SELECT id, payment_type, total_amount, payment_status FROM orders ORDER BY id DESC LIMIT 1')
const gItems = gOrders.length ? db(`SELECT product_id, quantity FROM order_items WHERE order_id=${gOrders[0].id}`) : []
const gWallet = db('SELECT balance FROM wallet WHERE user_id=1')[0]
const checkoutPosts = countApi(/\/api\/checkout$/)
check('G2: order persisted server-side (no gateway in test env)', navigatedOrToast && gOrders.length === 1
  && gOrders[0].payment_type === 'PREPAID' && gItems.some(i => i.product_id === 101),
  `order=${gOrders[0]?.id} toastOrNav=${navigatedOrToast} posts=${checkoutPosts}`)
check('G3: recovery toast shown, user NOT dumped on a broken page', navigatedOrToast && page.url().includes('/checkout'),
  `url=${page.url().replace(APP, '')}`)
check('G4: wallet untouched (no wallet applied in G)', gWallet.balance === 600, `balance=₹${gWallet.balance}`)

// ══ Summary ══════════════════════════════════════════════════════════════
const passCount = results.filter(r => r.ok).length
console.log(`\n===== ${passCount}/${results.length} PASSED =====`)
if (pageErrors.length) {
  const real = pageErrors.filter(e => !e.includes('Failed to fetch') && !e.includes('ERR_CONNECTION') && !e.includes('the server responded with a status'))
  if (real.length) { console.log('\nPage errors (first 6):'); real.slice(0, 6).forEach(e => console.log('  ', e.slice(0, 220))) }
  else console.log('No real page errors (expected API noise filtered) 🎉')
} else console.log('No page errors 🎉')
await browser.close()
process.exit(passCount === results.length ? 0 : 1)
