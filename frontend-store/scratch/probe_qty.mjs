// One-click + full-cart-API-traffic probe (diagnose F1 rapid-tap failure)
import puppeteer from 'puppeteer-core'
import crypto from 'crypto'
import fs from 'fs'
import { execSync } from 'child_process'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const db = (sql) => JSON.parse(execSync(`python3 -c "
import sqlite3, json
c = sqlite3.connect('/tmp/jdlx_checkout_verify.db'); c.row_factory = sqlite3.Row
print(json.dumps([dict(r) for r in c.execute('''${sql}''')]))"`, { encoding: 'utf8' }).trim().split('\n').pop())
const b64url = (b) => b.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
let secret = ''
try {
  const envText = fs.readFileSync(new URL('../../backend/.env', import.meta.url), 'utf8')
  const line = envText.split('\n').find(l => l.trim().startsWith('JWT_SECRET='))
  if (line) secret = line.split('=').slice(1).join('=').trim().replace(/^"|"$/g, '')
} catch {}
const now = Math.floor(Date.now() / 1000)
const h = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
const p = b64url(Buffer.from(JSON.stringify({ user_id: 1, email: 'test@example.com', role: 'user', iat: now, jti: 'probeqty20123456789', exp: now + 7200 })))
const token = `${h}.${p}.${b64url(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest())}`

// reset cart: only product 101 qty 1
execSync(`curl -s -X POST http://localhost:5000/api/cart -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{"action":"clear_cart"}'`)
execSync(`curl -s -X POST http://localhost:5000/api/cart -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{"product_id":101,"quantity":1,"action":"add"}'`)

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
await page.setViewport({ width: 412, height: 915 })
const cartTraffic = []
page.on('response', async (res) => {
  const u = res.url()
  if (u.includes(':5000/api/cart')) {
    let body = ''
    try { body = (await res.text()).slice(0, 300) } catch {}
    cartTraffic.push({ tag: null, u: u.replace('http://127.0.0.1:5000', '').replace('http://localhost:5000', ''), s: res.status(), body: body.replace(/\s+/g, ' ') })
  }
})
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 60000 })
await page.evaluate((t) => {
  localStorage.setItem('userToken', t)
  localStorage.setItem('user', JSON.stringify({ id: 1, name: 'Test User', email: 'test@example.com', role: 'user' }))
  localStorage.setItem('jdlx_onboarding_done', '1')
  localStorage.setItem('sessionId', 'probesession2')
}, token)
await page.goto('http://localhost:5173/cart', { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(3000)
cartTraffic.forEach(t => { t.tag = 'after-load' })

const dump = (label) => {
  console.log(`\n===== ${label} =====`)
  console.log('span:', null)
}
const before = {
  span: await page.evaluate(() => document.querySelector('span.w-6.text-center')?.textContent?.trim()),
  ls: await page.evaluate(() => localStorage.getItem('cart')),
  db: db('SELECT product_id, quantity FROM cart'),
}
console.log('BEFORE CLICK → span:', before.span, '| LS:', before.ls, '| DB:', JSON.stringify(before.db))

// click + once
const clicked = await page.evaluate(() => {
  const span = document.querySelector('span.w-6.text-center')
  const btns = span?.parentElement?.querySelectorAll('button')
  if (!btns || btns.length < 2) return { ok: false, n: btns?.length || 0 }
  btns[1].click()
  return { ok: true, n: btns.length }
})
console.log('\nclick +:', JSON.stringify(clicked))
await sleep(2500)

const after = {
  span: await page.evaluate(() => document.querySelector('span.w-6.text-center')?.textContent?.trim()),
  ls: await page.evaluate(() => localStorage.getItem('cart')),
  db: db('SELECT product_id, quantity FROM cart'),
}
console.log('AFTER 1 CLICK → span:', after.span, '| LS:', after.ls, '| DB:', JSON.stringify(after.db))

// rapid 10 taps
const taps = await page.evaluate(async () => {
  const span = document.querySelector('span.w-6.text-center')
  const btns = span?.parentElement?.querySelectorAll('button')
  if (!btns || btns.length < 2) return 0
  for (let i = 0; i < 10; i++) { btns[1].click(); await new Promise(r => setTimeout(r, 50)) }
  return 10
})
await sleep(3500)
const afterRapid = {
  span: await page.evaluate(() => document.querySelector('span.w-6.text-center')?.textContent?.trim()),
  ls: await page.evaluate(() => localStorage.getItem('cart')),
  db: db('SELECT product_id, quantity FROM cart'),
}
console.log(`\nAFTER ${taps} RAPID TAPS → span:`, afterRapid.span, '| LS:', afterRapid.ls, '| DB:', JSON.stringify(afterRapid.db))

console.log('\n===== /api/cart traffic =====')
cartTraffic.forEach((t, i) => console.log(`${i + 1}. [${t.tag}] ${t.u} ${t.s} | ${t.body.slice(0, 160)}`))
await browser.close()
