// Runtime verify of the AddProductAgents mobile UI fixes (isolated DB):
//   1. Draft card: "Complete & Submit" no longer overlaps the text on mobile.
//   2. Agent Login Link: helper text renders full-width (no one-word-per-line).
//   3. Discount ₹ ↔ % two-way auto-calc works (base = MRP, else price).
//   4. GST toggle: off hides the rate input; submit payload carries gst_pct 0.
import puppeteer from 'puppeteer-core'
import crypto from 'crypto'
import fs from 'fs'

const API = process.env.VERIFY_API || 'http://localhost:5011'
const APP = process.env.VERIFY_APP || 'http://localhost:5203'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

let secret = ''
try {
  const envText = fs.readFileSync(new URL('../../backend/.env', import.meta.url), 'utf8')
  const line = envText.split('\n').find(l => l.trim().startsWith('JWT_SECRET='))
  if (line) secret = line.split('=').slice(1).join('=').trim().replace(/^"|"$/g, '')
} catch {}
const now = Math.floor(Date.now() / 1000)
const b64url = (b) => b.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const h = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
const p = b64url(Buffer.from(JSON.stringify({ warehouse_id: 1, email: 'wh@test.com', role: 'owner', type: 'warehouse', iat: now, exp: now + 86400 })))
const token = `${h}.${p}.${b64url(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest())}`

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
await page.setViewport({ width: 412, height: 915 })   // mobile — the bug scenario
let checkoutBody = null
page.on('request', (req) => {
  if (req.method() === 'POST' && req.url().includes('/complete')) {
    try { checkoutBody = JSON.parse(req.postData() || '{}') } catch {}
  }
})

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? `  (${extra})` : ''}`) }

await page.goto(`${APP}/warehouse/login`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(3000)
await page.evaluate((t) => {
  localStorage.setItem('warehouseToken', t)
  // WarehouseRoute reads the persisted user from the store (role check)
  localStorage.setItem('warehouseUser', JSON.stringify({ id: 1, warehouse_id: 1, email: 'wh@test.com', role: 'owner' }))
}, token)
await page.goto(`${APP}/warehouse/add-agents`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(3500)

// ── 1. Draft card: no overlap between text block and the button ────────────
const overlap = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /complete & submit/i.test(b.textContent))
  if (!btn) return null
  const row = btn.parentElement
  const textDiv = [...row.children].find(c => c.tagName === 'DIV' && c !== btn)
  if (!textDiv) return null
  const b = btn.getBoundingClientRect()
  const t = textDiv.getBoundingClientRect()
  const intersects = !(b.left >= t.right - 1 || b.right <= t.left + 1 || b.top >= t.bottom - 1 || b.bottom <= t.top + 1)
  return { intersects, btnW: Math.round(b.width), textW: Math.round(t.width), btnOnOwnRow: b.top >= t.bottom - 2 }
})
check('draft card found with Complete & Submit button', overlap !== null, JSON.stringify(overlap || {}))
if (overlap) check('draft card: button does NOT overlap text (own row on mobile)', !overlap.intersects,
  `btnOnOwnRow=${overlap.btnOnOwnRow} textW=${overlap.textW}`)

// ── 2. Agent Login Link: helper text full-width, heading one line ──────────
const link = await page.evaluate(() => {
  const h2 = [...document.querySelectorAll('h2')].find(x => /agent login link/i.test(x.textContent))
  if (!h2) return null
  const section = h2.closest('section')
  const helper = [...section.querySelectorAll('p')].find(x => /install this as an app/i.test(x.textContent))
  const h = h2.getBoundingClientRect()
  const hp = helper?.getBoundingClientRect()
  return { h2h: Math.round(h.height), helperW: Math.round(hp?.width || 0), sectionW: Math.round(section.getBoundingClientRect().width) }
})
check('login-link heading is single-line on mobile', !!link && link.h2h <= 24, JSON.stringify(link || {}))
check('login-link helper text is full-width (not one-word-per-line)', !!link && link.helperW > 250,
      link ? `helperW=${link.helperW}/${link.sectionW}` : '')

// ── 3+4. Open the draft completion form: discount auto-calc + GST toggle ───
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /complete & submit/i.test(b.textContent))
  btn?.click()
})
await sleep(1200)

// Fill MRP 949, then Discount (₹) 100 → % should auto-fill 10.54
await page.evaluate(() => {
  window.__set = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const byLabel = (txt) => {
    const lbl = [...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith(txt))
    return lbl?.querySelector('input')
  }
  window.__set(byLabel('MRP (₹)'), '949')
  window.__set(byLabel('Discount (₹)'), '100')
})
await sleep(400)
const pctAfterAmt = await page.evaluate(() => {
  const lbl = [...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith('Discount (%)'))
  return lbl?.querySelector('input')?.value
})
check('discount ₹100 + MRP 949 → % auto-fills 10.54', pctAfterAmt === '10.54', `pct=${pctAfterAmt}`)

// Two-way: clear ₹, type % 20 → ₹ should fill 189.80
await page.evaluate(() => {
  const byLabel = (txt) => {
    const lbl = [...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith(txt))
    return lbl?.querySelector('input')
  }
  window.__set(byLabel('Discount (%)'), '20')
})
await sleep(400)
const amtAfterPct = await page.evaluate(() => {
  const lbl = [...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith('Discount (₹)'))
  return lbl?.querySelector('input')?.value
})
check('discount %20 → ₹ auto-fills 189.80 (two-way)', amtAfterPct === '189.80', `amt=${amtAfterPct}`)

// GST toggle: hide → rate input gone; label says disabled
const gstBefore = await page.evaluate(() => {
  const lbl = [...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith('GST Rate (%)'))
  return !!lbl
})
await page.evaluate(() => {
  const toggle = [...document.querySelectorAll('button[aria-label="Toggle GST on or off for this product"]')][0]
  toggle?.click()
})
await sleep(300)
const gstAfter = await page.evaluate(() => {
  const lbl = [...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith('GST Rate (%)'))
  const badge = [...document.querySelectorAll('p')].find(x => /disabled — no gst/i.test(x.textContent))
  return { rateVisible: !!lbl, badge: !!badge }
})
check('GST toggle: rate input hidden + "Disabled" shown when off', gstBefore && !gstAfter.rateVisible && gstAfter.badge,
  JSON.stringify({ gstBefore, ...gstAfter }))

// Submit → payload must carry gst_pct: 0 (explicit no-GST)
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /complete & send for admin approval/i.test(b.textContent))
  btn?.click()
})
await sleep(1500)
check('submit payload: gst_pct === 0 when GST disabled', checkoutBody?.gst_pct === 0, `gst_pct=${JSON.stringify(checkoutBody?.gst_pct)}`)
check('submit payload: discount fields intact', checkoutBody && Number(checkoutBody.discount_pct) === 20 && Number(checkoutBody.discount_amt) === 189.8,
  `pct=${checkoutBody?.discount_pct} amt=${checkoutBody?.discount_amt}`)

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
