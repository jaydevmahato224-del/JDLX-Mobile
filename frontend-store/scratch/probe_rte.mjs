// E2E: warehouse rich text editor → save → DB → storefront rendering.
// Uses the real panel UI (login via minted JWT), types formatted text,
// saves, then checks the storefront product page renders it cleanly.
import puppeteer from 'puppeteer-core'
import crypto from 'crypto'
import fs from 'fs'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const b64u = (b) => b.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
let secret = ''
try {
  const envText = fs.readFileSync(new URL('../../backend/.env', import.meta.url), 'utf8')
  const line = envText.split('\n').find(l => l.trim().startsWith('JWT_SECRET='))
  if (line) secret = line.split('=').slice(1).join('=').trim().replace(/^"|"$/g, '')
} catch {}
const now = Math.floor(Date.now() / 1000)
const mk = (payload) => {
  const h = b64u(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const p = b64u(Buffer.from(JSON.stringify(payload)))
  return `${h}.${p}.${b64u(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest())}`
}
const whTok = mk({ warehouse_id: 1, email: 'wh@test.com', role: 'owner', type: 'warehouse', iat: now, exp: now + 86400 })

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? `  (${extra})` : ''}`) }

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
const errors = []
page.on('pageerror', (e) => errors.push(e.toString().slice(0, 150)))

// ── 1. Panel: open inventory edit form, editor mounts ────────────────────
await page.goto('http://localhost:5175/', { waitUntil: 'networkidle2', timeout: 60000 })
await page.evaluate((t) => {
  localStorage.setItem('warehouseToken', t)
  localStorage.setItem('warehouse_user', JSON.stringify({ id: 1, warehouse_name: 'Test Warehouse', email: 'wh@test.com', role: 'owner' }))
  localStorage.setItem('warehouseUser', JSON.stringify({ id: 1, warehouse_name: 'Test Warehouse', email: 'wh@test.com', role: 'owner' }))
}, whTok)
await page.goto('http://localhost:5175/warehouse/inventory', { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(4500)
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Got it'); if (b) b.click() })
await sleep(1500)

// Click the row to open detail, then find Edit button
const openedEdit = await page.evaluate(() => {
  const editBtn = [...document.querySelectorAll('button')].find(b => b.title === 'Edit Product')
  if (editBtn) { editBtn.click(); return true }
  return false
})
check('Edit form opens from inventory row', openedEdit)
await sleep(2500)

// Editor present? (contentEditable box below the toolbar)
const editorInfo = await page.evaluate(() => {
  const el = document.querySelector('[contenteditable="true"][role="textbox"]')
  return { present: !!el, currentHtml: el ? el.innerHTML.slice(0, 200) : '' }
})
check('Rich text editor mounted with existing description', editorInfo.present, `html=${editorInfo.currentHtml.slice(0, 60)}`)

// ── 2. Type formatted text through the editor ────────────────────────────
if (editorInfo.present) {
  await page.evaluate(() => {
    const el = document.querySelector('[contenteditable="true"][role="textbox"]')
    el.innerHTML = ''
    el.focus()
  })
  // Type via execCommand to simulate real formatting: bold part + list
  await page.keyboard.type('Premium diamond cover case. ')
  await page.evaluate(() => { document.execCommand('bold') })
  await page.keyboard.type('Shockproof material.')
  await page.evaluate(() => { document.execCommand('insertUnorderedList') })
  await page.keyboard.type('Drop tested')
  await sleep(500)
  const typedHtml = await page.evaluate(() => document.querySelector('[contenteditable="true"][role="textbox"]').innerHTML)
  check('Editor produces formatted HTML', /<(strong|b)>|<ul>/i.test(typedHtml), `html=${typedHtml.slice(0, 90)}`)

  // Save via the panel's UPDATE PRODUCT button, watching for the PATCH response
  const patchDone = page.waitForResponse(
    (r) => r.url().includes('/warehouse/inventory/') && r.request().method() === 'PATCH',
    { timeout: 20000 }
  ).then((r) => r.status()).catch(() => null)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /UPDATE PRODUCT/i.test(x.textContent))
    if (b) b.click()
  })
  const patchStatus = await patchDone
  check('Panel saves the product (PATCH 200)', patchStatus === 200, `status=${patchStatus}`)
}

// ── 3. DB check: description now holds formatted HTML ────────────────────
const { execSync } = await import('child_process')
const dbDesc = JSON.parse(
  execSync(`python3 -c "
import sqlite3, json
c = sqlite3.connect('/tmp/jdlx_checkout_verify.db'); c.row_factory = sqlite3.Row
r = c.execute('SELECT description FROM products WHERE id=101').fetchone()
print(json.dumps(r['description'] if r else None))"`, { encoding: 'utf8' }).trim().split('\n').pop()
)
check('DB stores the formatted description', !!dbDesc && /<(strong|b)|<ul>/i.test(dbDesc), `desc=${String(dbDesc).slice(0, 70)}`)

// ── 4. Storefront: renders cleanly, no raw tags, no fallback ────────────
await page.goto('http://localhost:5173/p/101', { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(4500)
const text = await page.evaluate(() => document.body.innerText)
const descSection = text.split('DESCRIPTION')[1]?.split('RETURN POLICY')[0] || ''
check('Storefront shows real description', descSection.includes('diamond cover case'), descSection.trim().slice(0, 60))
check('No raw HTML tags on storefront', !/<br|<strong|<ul|<li>/i.test(text))
check('No fallback text', !text.includes('Premium daily essential from the JDLX collection.'))
check('No page errors', errors.length === 0, errors.slice(0, 2).join(' | ').slice(0, 90))

await browser.close()
console.log(`\n===== ${pass}/${pass + fail} PASSED =====`)
process.exit(fail === 0 ? 0 : 1)
