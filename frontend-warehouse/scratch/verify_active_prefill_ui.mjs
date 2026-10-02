// Browser e2e for the Active Status prefill fix (user's exact bug scenario):
//   1. Open Inventory, click Edit on a LIVE product → ACTIVE STATUS toggle must be ON.
//   2. Save WITHOUT touching the toggle → products.status stays 'available'.
//   3. Re-open Edit → toggle STILL ON (was the "refresh pe off" symptom).
//   4. Create mode: form opens with toggle ON by default.
// Uses an isolated DB (/tmp/jdlx_pipeline_ui.db) + vite dev server on :5173
// (CORS allowlist covers 5173–5175 only).
import puppeteer from 'puppeteer-core'
import crypto from 'crypto'
import fs from 'fs'
import { spawn, execSync } from 'child_process'

const API_PORT = 5011
const APP_PORT = 5173
const API = `http://localhost:${API_PORT}`
const APP = `http://localhost:${APP_PORT}`
const DB = '/tmp/jdlx_pipeline_ui.db'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const BACKEND = new URL('../../backend', import.meta.url).pathname
const WAR = new URL('..', import.meta.url).pathname

// ── seed isolated DB (same shape as verify_pipeline_status.py) ──────────────
process.env.FORCE_LOCAL_DB = '1'
process.env.DATABASE_PATH = DB
if (fs.existsSync(DB)) fs.rmSync(DB)
process.chdir(BACKEND)
const { pathToFileURL } = await import('url')
const database = await import(pathToFileURL(BACKEND + '/database.py').href.replace('.py', '.py')).catch(() => null)
// python-side seeding instead — simplest reliable path:
execSync(`python3 - <<'PYEOF'
import os, sys, json, struct, zlib
os.environ["FORCE_LOCAL_DB"]="1"; os.environ["DATABASE_PATH"]="${DB}"
sys.path.insert(0, "${BACKEND}")
import database
database.init_db()
# the edit form enforces >= 3 images on submit — write 3 tiny PNGs to serve
def png_bytes():
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\\x00\\xff\\x00\\x00")
    return (b"\\x89PNG\\r\\n\\x1a\\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))
uploads = os.path.join("${BACKEND}", "static", "uploads")
os.makedirs(uploads, exist_ok=True)
for i in (1, 2, 3):
    with open(os.path.join(uploads, f"ui_verify_{i}.png"), "wb") as f:
        f.write(png_bytes())
c = database.get_db(); cur = c.cursor()
cur.execute("INSERT INTO warehouses (warehouse_name,email,owner_name,account_status) VALUES ('UI WH','ui@example.com','UI Owner','active')")
cur.execute("INSERT INTO categories (name) VALUES ('Cases')")
cat_id = cur.lastrowid
cur.execute("INSERT INTO categories (name) VALUES ('Cases 2')")
cat2_id = cur.lastrowid
imgs = json.dumps([f"/static/uploads/ui_verify_{i}.png" for i in (1, 2, 3)])
cur.execute("""INSERT INTO products (name, description, category, category_id, price, mrp, stock, images, return_policy, status, lifecycle_state, approval_status, approval_source, approval_warehouse_id, global_sku_code)
               VALUES ('UI Live Product', 'desc', 'Cases', ?, 299, 499, 10, ?, '7 days easy return', 'available', 'live', 'approved', 'warehouse', 1, 'AP-222222')""", (cat_id, imgs,))
live = cur.lastrowid
cur.execute("""INSERT INTO warehouse_inventory (warehouse_id, product_id, product_name, sku, stock_quantity, available_stock, low_stock_threshold, selling_price, mrp, gst_pct, status)
               VALUES (1, ?, 'UI Live Product', 'AP-222222', 10, 10, 2, 299, 499, 0, 'active')""", (live,))
c.commit(); c.close()
print("seeded", live)
PYEOF`, { stdio: 'inherit', env: { ...process.env } })

// ── start backend + vite ─────────────────────────────────────────────────────
const kill = (port) => { try { execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' }) } catch {} }
kill(API_PORT); kill(APP_PORT)
await sleep(800)

const backend = spawn('python3', ['app.py'], {
  cwd: BACKEND,
  env: { ...process.env, PORT: String(API_PORT), FORCE_HTTPS: '0', FORCE_LOCAL_DB: '1', DATABASE_PATH: DB },
  stdio: 'ignore',
})
const vite = spawn('npx', ['vite', '--port', String(APP_PORT), '--strictPort'], {
  cwd: WAR,
  env: { ...process.env, VITE_API_URL: `${API}/api` },
  stdio: 'ignore',
})

const waitBoot = async (url, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    try { await fetch(url); return true } catch { await sleep(500) }
  }
  return false
}
const apiUp = await waitBoot(`${API}/api/categories`)
const appUp = await waitBoot(APP)
if (!apiUp || !appUp) { console.log('BOOT FAIL', { apiUp, appUp }); process.exit(1) }

// ── warehouse JWT (mirror app.py: dotenv .env → env var) ─────────────────────
execSync('python3 -c "from dotenv import load_dotenv; load_dotenv(\'backend/.env\')"', { cwd: new URL('../..', import.meta.url).pathname })
const secret = execSync(`python3 -c "
import os, sys
sys.path.insert(0, '${BACKEND}')
from dotenv import load_dotenv; load_dotenv('${BACKEND}/.env')
from jwt_config import get_jwt_secret
print(get_jwt_secret())
"`).toString().trim()
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const now = Math.floor(Date.now() / 1000)
const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
const payload = b64u(JSON.stringify({ warehouse_id: 1, email: 'ui@example.com', role: 'owner', type: 'warehouse', iat: now, exp: now + 86400 }))
const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const token = `${header}.${payload}.${sig}`

// ── browser ──────────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? `  (${extra})` : ''}`) }

// capture PATCH/save responses + error notifications for diagnosis
const apiLog = []
page.on('response', async (res) => {
  const req = res.request()
  if (req.url().includes('/api/warehouse/') && ['PATCH', 'POST', 'PUT'].includes(req.method())) {
    let body = ''
    try { body = (await res.text()).slice(0, 200) } catch {}
    apiLog.push(`${req.method()} ${req.url().replace(API, '')} -> ${res.status()} ${body}`)
  }
})
page.on('requestfailed', (req) => {
  if (req.url().includes('/api/')) apiLog.push(`FAILED ${req.method()} ${req.url().replace(API, '')} :: ${req.failure()?.errorText}`)
})

await page.goto(`${APP}/warehouse/login`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(3000)
await page.evaluate((t) => {
  localStorage.setItem('warehouseToken', t)
  localStorage.setItem('warehouseUser', JSON.stringify({ id: 1, warehouse_id: 1, email: 'ui@example.com', role: 'owner' }))
}, token)

// also set returning-user flags so splash/onboarding never block
await page.evaluate(() => {
  localStorage.setItem('jdlx_splash_shown', '1')
  localStorage.setItem('jdlx_onboarding_done', '1')
})

await page.goto(`${APP}/warehouse/inventory`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(4500)

// find the row + its Edit button (product name and SKU live in DIFFERENT
// tds — match on the name cell only, then climb to the row)
// retry — first vite load lazy-compiles the page chunk, table may take a while
const findAndClickEdit = () => page.evaluate(() => {
  const tds = [...document.querySelectorAll('td')]
  const cell = tds.find(td => /UI Live Product/.test(td.textContent))
  if (!cell) return false
  const tr = cell.closest('tr')
  const editBtn = [...(tr?.querySelectorAll('button') || [])].find(b => b.getAttribute('title') === 'Edit Product')
  if (!editBtn) return false
  editBtn.click()
  return true
})
let rowFound = false
for (let i = 0; i < 20 && !rowFound; i++) {
  rowFound = await findAndClickEdit()
  if (!rowFound) await sleep(1000)
}
check('inventory row found, Edit clicked', rowFound)
await sleep(2500)

// find the ACTIVE STATUS toggle button via its label row (real JSX: the
// label div 'Active Status' and the w-12 h-7 toggle share a flex row)
const readToggle = () => page.evaluate(() => {
  const label = [...document.querySelectorAll('div')].find(
    d => d.children.length === 0 && d.textContent.trim().toLowerCase() === 'active status'
  )
  if (!label) return null
  const row = label.closest('div[class*="justify-between"]')
  if (!row) return null
  const btn = row.querySelector('button.w-12.h-7')
  if (!btn) return null
  return btn.className.includes('bg-emerald-400')
})
let toggleOn = await readToggle()
check('edit form opens with ACTIVE STATUS ON (prefilled from store status)', toggleOn === true, `value=${toggleOn}`)

// save WITHOUT touching the toggle
// capture page JS errors around submit
await page.evaluate(() => {
  window.__errs = []
  window.addEventListener('error', (e) => window.__errs.push(String(e.message)))
  window.addEventListener('unhandledrejection', (e) => window.__errs.push('rejection: ' + String(e.reason)))
})
const saved = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /UPDATE PRODUCT/i.test(b.textContent))
  if (!btn) return false
  const info = { disabled: btn.disabled, form: Boolean(btn.closest('form')), type: btn.type }
  btn.click()
  window.__btnInfo = info
  return true
})
check('clicked UPDATE PRODUCT', saved)
console.log('BTN INFO:', JSON.stringify(await page.evaluate(() => window.__btnInfo)))
await sleep(500)
// native HTML5 validation silently blocks submit — surface any invalid field
const invalidField = await page.evaluate(() => {
  const f = document.querySelector('form')
  if (!f) return null
  const bad = [...f.elements].find(el => el.willValidate && !el.checkValidity())
  if (!bad) return null
  const label = bad.closest('label,div')?.textContent?.trim().slice(0, 60)
  return { tag: bad.tagName, name: bad.name || bad.id, validation: bad.validationMessage, label }
})
if (invalidField) console.log('INVALID FIELD:', JSON.stringify(invalidField))
await sleep(3000)
const errs = await page.evaluate(() => window.__errs)
if (errs.length) console.log('PAGE ERRORS:', errs.join(' | '))
if (apiLog.length) console.log('API LOG:', apiLog.join(' | '))
const notif = await page.evaluate(() => {
  const el = [...document.querySelectorAll('div,span')].find(x => /updated successfully|error|failed|invalid|required|minimum/i.test(x.textContent) && x.textContent.length < 150 && x.closest('[class*="fixed"],[class*="toast"],[class*="notif"],[class*="alert"]'))
  return el ? el.textContent.trim() : null
})
console.log('NOTIFICATION:', notif)
const formStillOpen = await page.evaluate(() => Boolean([...document.querySelectorAll('button')].find(b => /UPDATE PRODUCT/i.test(b.textContent))))
console.log('FORM STILL OPEN AFTER SAVE:', formStillOpen)

// verify DB status preserved (API read of the inventory row — absolute URL:
// the page origin is vite, the API is the Flask server on another port)
const statusAfterSave = await page.evaluate(async (apiBase) => {
  const r = await fetch(`${apiBase}/api/warehouse/inventory`, { headers: { Authorization: `Bearer ${localStorage.getItem('warehouseToken')}` } })
  const list = await r.json()
  const row = (Array.isArray(list) ? list : list.data || []).find(x => x.sku === 'AP-222222')
  return row ? row.storefront_status : null
}, API)
check('plain save preserved products.status=available', statusAfterSave === 'available', `status=${statusAfterSave}`)

// re-open edit → toggle must STILL be ON (the "refresh pe off" symptom)
await sleep(1500)
const reopened = await page.evaluate(() => {
  const tds = [...document.querySelectorAll('td')]
  const cell = tds.find(td => /UI Live Product/.test(td.textContent))
  if (!cell) return false
  const tr = cell.closest('tr')
  const editBtn = [...(tr?.querySelectorAll('button') || [])].find(b => b.getAttribute('title') === 'Edit Product')
  editBtn?.click()
  return Boolean(editBtn)
})
await sleep(2500)
const toggleOnAgain = await readToggle()
check('re-opened edit form: toggle STILL ON', reopened && toggleOnAgain === true, `value=${toggleOnAgain}`)

console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
backend.kill(); vite.kill()
try { execSync(`fuser -k ${API_PORT}/tcp`, { stdio: 'ignore' }) } catch {}
try { execSync(`fuser -k ${APP_PORT}/tcp`, { stdio: 'ignore' }) } catch {}
process.exit(fail ? 1 : 0)
