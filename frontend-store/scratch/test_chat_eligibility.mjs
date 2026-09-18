import puppeteer from 'puppeteer-core'
import crypto from 'crypto'
import fs from 'fs'
import { execSync } from 'child_process'

const API = 'http://localhost:5099'
const APP = 'http://localhost:5173'
const TEST_EMAIL = 'test@example.com'

const clearRateLimit = () => {
  try {
    execSync(`python3 -c "import sqlite3; c=sqlite3.connect('/tmp/jdlx_chattest.db'); c.execute('DELETE FROM rate_limits'); c.commit()"`)
  } catch (e) { console.log('rate-limit clear failed:', e.message?.slice(0, 80)) }
}

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
const payload = b64url(Buffer.from(JSON.stringify({ user_id: 1, email: TEST_EMAIL, role: 'user', iat: now, jti: 'eligtest0123456789', exp: now + 3600 })))
const sig = b64url(crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest())
const token = `${header}.${payload}.${sig}`

clearRateLimit()
const vres = await fetch(`${API}/api/auth/verify-token`, { headers: { Authorization: `Bearer ${token}` } })
console.log('verify-token status:', vres.status)
if (vres.status !== 200) { process.exit(1) }

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
await page.setViewport({ width: 412, height: 915 })
const pageErrors = []
page.on('pageerror', (err) => pageErrors.push(err.toString()))

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
const chatClick = async (match) => {
  const ok = await page.evaluate((m) => {
    const btn = [...document.querySelectorAll('div[aria-label="Support chat"] button')].find(b => b.textContent.includes(m))
    if (btn) { btn.click(); return true }
    return false
  }, match)
  if (!ok) console.log(`WARN: chatClick("${match}") — button not found`)
  return ok
}
const chatText = () => page.evaluate(() => document.querySelector('div[aria-label="Support chat"]')?.textContent || '')

// Open widget → Exchange & Return → Return request → Auto-check
// (DOM click, not puppeteer coordinate click — overlays eat coordinate clicks)
const fab = await page.$('button[aria-label="Chat with us"]')
check('FAB present', !!fab)
await page.evaluate(() => document.querySelector('button[aria-label="Chat with us"]').click())
await new Promise(r => setTimeout(r, 900))
await chatClick('Exchange & Return')
await new Promise(r => setTimeout(r, 600))
await chatClick('Return request kaise karein')
await new Promise(r => setTimeout(r, 600))
let body = await chatText()
check('Auto-check option visible in return flow', body.includes('Kaunse orders eligible hain'), '')

await chatClick('Kaunse orders eligible hain')
await new Promise(r => setTimeout(r, 3500))
body = await chatText()

// Positive case: delivered order (2 days ago) → eligible with days remaining
check('Eligible order badge shows days remaining', body.includes('Eligible') && body.includes('din bache'), '')
check('Per-order refund request deep-link present', body.includes('Is order ka refund request kholo'), '')

// Deep-link navigates with order_id param (RefundRequest prefill path)
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('div[aria-label="Support chat"] button')].find(b => b.textContent.includes('Is order ka refund request kholo'))
  if (btn) btn.click()
})
await new Promise(r => setTimeout(r, 2000))
check('Deep-link opens RefundRequest with order_id prefill', page.url().includes('/profile/refund-request?order_id='), page.url())
const pageAlive = await page.evaluate(() => !!document.querySelector('form, button, input'))
check('RefundRequest page renders (no crash)', pageAlive, '')

// Regression: widget NOT on this non-profile… wait — refund-request IS a profile page. Check FAB still there.
const fab2 = await page.$('button[aria-label="Chat with us"]')
check('Widget available on refund-request page too', !!fab2)

console.log(`\n===== ${results.filter(r => r.ok).length}/${results.length} PASSED =====`)
const realErrors = pageErrors.filter(e => !e.includes('Failed to fetch') && !e.includes('ERR_CONNECTION') && !e.includes('401'))
if (realErrors.length) { console.log('Page errors:'); realErrors.slice(0, 4).forEach(e => console.log('  ', e.slice(0, 160))) }
else console.log('No real page errors 🎉')
await browser.close()
process.exit(results.every(r => r.ok) ? 0 : 1)
