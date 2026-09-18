import puppeteer from 'puppeteer-core'
import crypto from 'crypto'
import fs from 'fs'
import { execSync } from 'child_process'

const API = 'http://localhost:5099'
const APP = 'http://localhost:5173'
const TEST_EMAIL = 'test@example.com'

// The backend's per-IP rate limiter (100 req/min, security_shield_guard) trips
// on the profile page's API burst in headless runs. Clear the counter row in
// the ISOLATED test DB between phases — test-only, product code untouched.
const clearRateLimit = () => {
  try {
    execSync(`python3 -c "import sqlite3; c=sqlite3.connect('/tmp/jdlx_chattest.db'); c.execute('DELETE FROM rate_limits'); c.commit()"`)
  } catch (e) { console.log('rate-limit clear failed:', e.message?.slice(0, 80)) }
}

// ── Mint a valid session token with the backend's own secret (local test only) ──
function b64url(buf) { return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') }
let secret = process.env.JWT_SECRET || ''
if (!secret) {
  try {
    const envText = fs.readFileSync('/home/jaydev/Desktop/JDLX-Mobile/backend/.env', 'utf8')
    const line = envText.split('\n').find(l => l.trim().startsWith('JWT_SECRET='))
    if (line) secret = line.split('=').slice(1).join('=').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '')
  } catch { /* fall through */ }
}
if (!secret) {
  try { secret = fs.readFileSync('/home/jaydev/Desktop/JDLX-Mobile/backend/.jwt_secret', 'utf8').trim() } catch { /* noop */ }
}
if (!secret) { console.error('NO_SECRET'); process.exit(1) }
const now = Math.floor(Date.now() / 1000)
const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
const payload = b64url(Buffer.from(JSON.stringify({ user_id: 1, email: TEST_EMAIL, role: 'user', iat: now, jti: 'browsertest0123456789', exp: now + 3600 })))
const sig = b64url(crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest())
const token = `${header}.${payload}.${sig}`

clearRateLimit() // a previous run's burst may have IP-blocked this test DB for 10 min
const vres = await fetch(`${API}/api/auth/verify-token`, { headers: { Authorization: `Bearer ${token}` } })
console.log('verify-token status:', vres.status)
if (vres.status !== 200) { console.error('Token invalid — aborting'); process.exit(1) }

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

await page.goto(`${APP}/`, { waitUntil: 'networkidle2', timeout: 60000 })
await page.evaluate((t, email) => {
  localStorage.setItem('userToken', t)
  localStorage.setItem('user', JSON.stringify({ id: 1, name: 'Test User', email, role: 'user' }))
  localStorage.setItem('jdlx_onboarding_done', '1')
}, token, TEST_EMAIL)

await page.goto(`${APP}/profile`, { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise(r => setTimeout(r, 3000))

const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`) }

// In-page helpers: clicks INSIDE the chat panel via DOM (overlay-proof)
const openWidget = () => page.evaluate(() => {
  const fab = document.querySelector('button[aria-label="Chat with us"]')
  if (fab) { fab.click(); return true }
  return false
})
const chatClick = (match) => page.evaluate((m) => {
  const btn = [...document.querySelectorAll('div[aria-label="Support chat"] button')]
    .find(b => b.textContent.includes(m))
  if (btn) { btn.click(); return true }
  return false
}, match)
const chatText = () => page.evaluate(() => {
  const p = document.querySelector('div[aria-label="Support chat"]')
  return p ? p.textContent : ''
})
const clickFooter = (label) => page.evaluate((l) => {
  const btn = [...document.querySelectorAll('div[aria-label="Support chat"] button')]
    .find(b => b.textContent.trim() === l)
  if (btn) { btn.click(); return true }
  return false
}, label)

// ── 1. Floating button visible on profile ──
let fab = await page.$('button[aria-label="Chat with us"]')
check('Floating chat button visible on /profile', !!fab)

// ── 2. Open widget ──
await openWidget()
await new Promise(r => setTimeout(r, 800))
let body = await chatText()
check('Chat panel opens with root menu', body.includes('Namaste') && body.includes('Order / Delivery'), '')
check('Root shows Exchange & Return category', body.includes('Exchange & Return'), '')

// ── 3. Exchange & Return flow ──
await chatClick('Exchange & Return')
await new Promise(r => setTimeout(r, 600))
body = await chatText()
check('Exchange submenu opens', body.includes('Exchange ya return'), '')
await chatClick('Return request kaise karein')
await new Promise(r => setTimeout(r, 600))
body = await chatText()
check('Return guide shows 7-day policy', body.includes('7 din'), '')
check('Return flow links to Refund Request page', body.includes('Refund request bhejo'), '')
await chatClick('Refund request bhejo')
await new Promise(r => setTimeout(r, 1500))
check('Refund Request page navigation works', page.url().includes('/profile/refund-request'), page.url())

// ── 4. Courier tracking flow ──
clearRateLimit()
await page.goto(`${APP}/profile`, { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise(r => setTimeout(r, 2500))
await openWidget()
await new Promise(r => setTimeout(r, 800))
// widget state persists; go back to root first
await clickFooter('Restart')
await new Promise(r => setTimeout(r, 500))
await chatClick('Order / Delivery issue')
await new Promise(r => setTimeout(r, 600))
body = await chatText()
check('Order submenu shows courier tracking option', body.includes('Shipping partner / courier tracking'), '')
await chatClick('Shipping partner / courier tracking')
await new Promise(r => setTimeout(r, 600))
await chatClick('Shipping partner kaun se hain')
await new Promise(r => setTimeout(r, 600))
body = await chatText()
check('Shipping partner info shows Shiprocket + local delivery', body.includes('Shiprocket') && body.includes('Local dark-store'), '')

// ── 5. Live order status (real API data) ──
await chatClick('Apna order track karo')
await new Promise(r => setTimeout(r, 3000))
body = await chatText()
check('Live orders loaded from real API', body.includes('Track') || body.includes('Koi order nahi mila'), '')

// ── 6. Agent handoff (end of a flow) ──
clearRateLimit()
await clickFooter('Restart')
await new Promise(r => setTimeout(r, 500))
await chatClick('Order / Delivery issue')
await new Promise(r => setTimeout(r, 400))
await chatClick('Galat / Damaged item')
await new Promise(r => setTimeout(r, 400))
body = await chatText()
check('Agent option appears at flow END', body.includes('Agent se connect karo'), '')
await chatClick('Agent se connect karo')
await new Promise(r => setTimeout(r, 3000))
body = await chatText()
check('Agent handoff creates REAL ticket with number', body.includes('Ticket TKT-') && body.includes('ban gaya'), '')
check('Ticket shows 24-48h expectation', body.includes('24-48 hours'), '')

// ── 7. Ticket exists via API with chatbot context ──
clearRateLimit()
const tinfo = await page.evaluate(async (t) => {
  const res = await fetch('http://localhost:5099/api/support/tickets', { headers: { Authorization: `Bearer ${t}` } })
  if (!res.ok) return { status: res.status }
  const data = await res.json()
  const list = data?.data || data || []
  const latest = Array.isArray(list) ? list[0] : null
  return { status: res.status, subject: latest?.subject || '', number: latest?.ticket_number || '' }
}, token)
check('Ticket visible via /api/support/tickets', tinfo.status === 200, `status ${tinfo.status}`)
check('Ticket subject carries chatbot context', (tinfo.subject || '').startsWith('Chatbot:'), tinfo.subject)

// ── 8. Widget absent on non-profile pages ──
clearRateLimit()
await page.goto(`${APP}/`, { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise(r => setTimeout(r, 1500))
fab = await page.$('button[aria-label="Chat with us"]')
check('Widget NOT on home page (profile-only)', !fab)

// ── Summary ──
const passCount = results.filter(r => r.ok).length
console.log(`\n===== ${passCount}/${results.length} PASSED =====`)
if (pageErrors.length) {
  const realErrors = pageErrors.filter(e => !e.includes('Failed to fetch') && !e.includes('ERR_CONNECTION'))
  if (realErrors.length) {
    console.log('\nPage errors (first 5):')
    realErrors.slice(0, 5).forEach(e => console.log('  ', e.slice(0, 200)))
  } else {
    console.log('No real page errors (only expected offline noise filtered) 🎉')
  }
} else {
  console.log('No page errors 🎉')
}
await browser.close()
process.exit(passCount === results.length ? 0 : 1)
