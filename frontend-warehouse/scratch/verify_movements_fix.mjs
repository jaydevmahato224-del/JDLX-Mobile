// E2E verify of the stock_movements fix:
// 1. Stock adjust IN via API (was failing on missing table)
// 2. GET movements returns the logged movement
// 3. Browser: Movement History modal opens and renders the row (no crash)
import puppeteer from 'puppeteer-core'
import crypto from 'crypto'
import fs from 'fs'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
function b64url(buf) { return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') }
let secret = ''
try {
  const envText = fs.readFileSync(new URL('../../backend/.env', import.meta.url), 'utf8')
  const line = envText.split('\n').find(l => l.trim().startsWith('JWT_SECRET='))
  if (line) secret = line.split('=').slice(1).join('=').trim().replace(/^"|"$/g, '')
} catch {}
const now = Math.floor(Date.now() / 1000)
const h = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
const p = b64url(Buffer.from(JSON.stringify({ warehouse_id: 1, email: 'wh@test.com', role: 'owner', type: 'warehouse', iat: now, exp: now + 86400 })))
const token = `${h}.${p}.${b64url(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest())}`
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const API = 'http://localhost:5000'

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? `  (${extra})` : ''}`) }

// ── 1. GET movements (was 500 before fix) ───────────────────────────────
let res = await fetch(`${API}/api/warehouse/inventory/1/movements`, { headers: auth })
const before = await res.json()
check('GET movements returns 200', res.status === 200, `status=${res.status}`)

// ── 2. Stock adjust IN +5 (audit log was silently failing) ──────────────
res = await fetch(`${API}/api/warehouse/inventory/1/adjust`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({ movement_type: 'IN', quantity: 5, reason: 'Verify fix - restock', remark: 'e2e movement test', performed_by: 'E2E Bot' })
})
const adj = await res.json()
check('Stock IN adjust succeeds (audit logged)', res.status === 200 && adj.success !== false, `status=${res.status} body=${JSON.stringify(adj).slice(0, 80)}`)

// ── 3. GET movements shows the new movement ─────────────────────────────
res = await fetch(`${API}/api/warehouse/inventory/1/movements`, { headers: auth })
const after = await res.json()
const rows = after.data || []
const logged = rows.find(r => r.movement_type === 'IN' && r.quantity === 5)
check('Movement logged & returned by history API', !!logged, `rows=${rows.length}`)
if (logged) {
  check('Movement fields intact (before/after/by)', logged.stock_before === 50 && logged.stock_after === 55 && logged.performed_by === 'E2E Bot',
    `before=${logged.stock_before} after=${logged.stock_after} by=${logged.performed_by}`)
}

// ── 4. Browser: modal opens and renders (no crash) ──────────────────────
const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.toString().slice(0, 200)))

await page.goto('http://localhost:5175/', { waitUntil: 'networkidle2', timeout: 60000 })
await page.evaluate((t) => {
  localStorage.setItem('warehouseToken', t)
  localStorage.setItem('warehouse_user', JSON.stringify({ id: 1, warehouse_name: 'Test Warehouse', email: 'wh@test.com', role: 'owner' }))
  localStorage.setItem('warehouseUser', JSON.stringify({ id: 1, warehouse_name: 'Test Warehouse', email: 'wh@test.com', role: 'owner' }))
}, token)
await page.goto('http://localhost:5175/warehouse/inventory', { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(5000)

const clicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.title === 'Movement History')
  if (btn) { btn.click(); return true }
  return false
})
check('History button found & clicked', clicked)
await sleep(3000)

const text = await page.evaluate(() => document.body.innerText)
check('Movement History modal opens', text.includes('Movement History'))
check('Modal renders the logged movement', text.includes('restock') || text.includes('Verify fix'))
check('No React page crash', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ').slice(0, 100))

await browser.close()
console.log(`\n===== ${pass}/${pass + fail} PASSED =====`)
process.exit(fail === 0 ? 0 : 1)
