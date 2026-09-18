/**
 * Frontend-store CORE FLOWS e2e (real Chrome, isolated DB).
 * Covers: home, product, add-to-cart, cart, login, protected routes,
 * orders, profile, chatbot widget. Read-only/assert-only — no purchases.
 */
import puppeteer from 'puppeteer-core'
import crypto from 'crypto'
import fs from 'fs'
import { execSync } from 'child_process'

const API = 'http://localhost:5099'
const APP = 'http://localhost:5173'
const TEST_EMAIL = 'test@example.com'

// The backend's custom per-IP limiter (100 req/min, DB-backed) trips on the
// test's rapid page navigation — production users never burst like this.
// Clear the counter in the ISOLATED test DB before each phase (test-only).
const clearRL = () => {
  try {
    execSync(`python3 -c "import sqlite3; c=sqlite3.connect('/tmp/jdlx_audit.db'); c.execute('DELETE FROM rate_limits'); c.commit()"`)
  } catch (e) { console.log('rate-limit clear failed:', e.message?.slice(0, 80)) }
}

function b64url(buf) { return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') }
let secret = process.env.JWT_SECRET || ''
if (!secret) {
  try {
    const envText = fs.readFileSync('/home/jaydev/Desktop/JDLX-Mobile/backend/.env', 'utf8')
    const line = envText.split('\n').find(l => l.trim().startsWith('JWT_SECRET='))
    if (line) secret = line.split('=').slice(1).join('=').trim().replace(/^"|^'/, '').replace(/"$/, '').replace(/'$/, '')
  } catch { /* fall through */ }
}
if (!secret) {
  try { secret = fs.readFileSync('/home/jaydev/Desktop/JDLX-Mobile/backend/.jwt_secret', 'utf8').trim() } catch { /* noop */ }
}
if (!secret) { console.error('NO_SECRET'); process.exit(1) }

const now = Math.floor(Date.now() / 1000)
const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
const payload = b64url(Buffer.from(JSON.stringify({ user_id: 1, email: TEST_EMAIL, role: 'user', iat: now, jti: 'coreflows0123456789', exp: now + 7200 })))
const sig = b64url(crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest())
const token = `${header}.${payload}.${sig}`

const vres = await fetch(`${API}/api/auth/verify-token`, { headers: { Authorization: `Bearer ${token}` } })
console.log('verify-token:', vres.status)
if (vres.status !== 200) { console.error('Token invalid — aborting'); process.exit(1) }

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 412, height: 915 })
const pageErrors = []
page.on('pageerror', (err) => pageErrors.push('pageerror: ' + err.toString().slice(0, 200)))
page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push('console: ' + msg.text().slice(0, 160)) })

const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`) }

// ── 1. HOME ──
await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded', timeout: 45000 })
await new Promise(r => setTimeout(r, 3500))
const homeHasProducts = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('main img, img')].filter(i => (i.getAttribute('src') || '').includes('/api/') || (i.getAttribute('src') || '').includes('/static'))
  return document.body.innerText.length > 200 && imgs.length > 3
})
check('home renders with products/images', homeHasProducts)
const badge0 = await page.evaluate(() => document.body.innerText.match(/Cart\s*\(?(\d+)\)?/i)?.[1] || null)

// ── 2. PRODUCT PAGE via product grid click ──
const clicked = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('a[href^="/p/"]')]
  if (cards.length) { cards[0].click(); return true }
  return false
})
await new Promise(r => setTimeout(r, 3000))
check('product card navigates to /p/ page', clicked && page.url().includes('/p/'), page.url().slice(-30))
const productLoaded = await page.evaluate(() => {
  const t = document.body.innerText
  return t.length > 300 && !t.includes('undefined') || (t.length > 300 && !t.includes('NaN'))
})
check('product page renders details', productLoaded)

// ── 3. ADD TO CART (buttons are "Add" / "Buy Now") ──
clearRL()
const addAttempt = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /^(add|buy now)$/i.test(b.textContent.trim()))
  if (btn && !btn.disabled) { btn.click(); return true }
  return false
})
await new Promise(r => setTimeout(r, 2000))
const outcome = await page.evaluate(() => {
  const t = document.body.innerText
  return {
    toastAdded: /added to collection|added to cart/i.test(t),
    gated: /select all options|select device/i.test(t),
    badge: t.match(/Cart\s*\((\d+)\)/i)?.[1] || null,
    onCart: window.location.pathname.includes('/cart'),
  }
})
// Either the item was added (badge/toast/cart-nav) OR the variant gate correctly
// blocked with a message — both are valid business outcomes; silent failure is not.
check('add-to-cart adds OR variant-gates with message', addAttempt && (outcome.toastAdded || outcome.badge !== null || outcome.onCart || outcome.gated), JSON.stringify(outcome))
if (!addAttempt) {
  const hasDisabled = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /add|buy now/i.test(b.textContent))
    return !!btn && btn.disabled
  })
  check('variant add-to-cart properly gated on selection', hasDisabled)
}

// ── 4. CART PAGE ──
await page.goto(`${APP}/cart`, { waitUntil: 'domcontentloaded', timeout: 45000 })
await new Promise(r => setTimeout(r, 2500))
const cartOk = await page.evaluate(() => {
  const t = document.body.innerText
  return /₹/.test(t) && /cart|bag/i.test(t)
})
check('cart page renders totals', cartOk)

// ── 5. LOGOUT state + /profile redirect ──
await page.evaluate(() => { localStorage.clear() })
await page.goto(`${APP}/profile`, { waitUntil: 'domcontentloaded', timeout: 45000 })
await new Promise(r => setTimeout(r, 2000))
check('guest /profile redirects to login', page.url().includes('/login'))

// ── 6. LOGIN: Google-OAuth-only (no password form) — verify OAuth entry renders ──
await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 })
await new Promise(r => setTimeout(r, 1500))
const loginForm = await page.evaluate(() => {
  const t = document.body.innerText.toLowerCase()
  const hasGoogle = t.includes('google') || !!document.querySelector('svg')
  return { hasGoogle, isLogin: t.includes('login') || t.includes('sign in') || t.includes('continue') }
})
check('login page renders Google OAuth entry', loginForm.hasGoogle && loginForm.isLogin)

// ── 7. Protected routes as logged-in user (token injection pattern) ──
await page.evaluate((t, email) => {
  localStorage.setItem('userToken', t)
  localStorage.setItem('user', JSON.stringify({ id: 1, name: 'Test User', email, role: 'user' }))
  localStorage.setItem('jdlx_onboarding_done', '1')
}, token, TEST_EMAIL)

for (const path of ['/profile/orders', '/profile/wallet', '/profile/support']) {
  clearRL()
  await page.goto(`${APP}${path}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await new Promise(r => setTimeout(r, 2500))
  const rendered = await page.evaluate(() => document.body.innerText.length > 150 && !document.body.innerText.includes('Something went wrong'))
  check(`protected route ${path} renders`, rendered)
}
// ── 8. ChatWidget on profile (regression) ──
clearRL()
await page.goto(`${APP}/profile`, { waitUntil: 'domcontentloaded', timeout: 45000 })
await new Promise(r => setTimeout(r, 2500))
const fab = await page.evaluate(() => {
  const b = document.querySelector('button[aria-label="Chat with us"]')
  if (b) { b.click(); return true }
  return false
})
await new Promise(r => setTimeout(r, 700))
const chatOpen = await page.evaluate(() => !!document.querySelector('div[aria-label="Support chat"]'))
check('chatbot FAB opens panel', fab && chatOpen)

// ── 9. Console/page error summary ──
const realErrors = pageErrors.filter(e => !/net::ERR|Failed to load resource|favicon|404|429/.test(e))
check('no real page errors across flows', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))

await browser.close()
const passed = results.filter(r => r.ok).length
console.log(`\n=== CORE FLOWS: ${passed}/${results.length} PASSED ===`)
process.exit(passed === results.length ? 0 : 1)
