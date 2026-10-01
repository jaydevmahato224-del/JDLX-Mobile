import puppeteer from 'puppeteer-core'
import { spawn, execSync } from 'node:child_process'

const API_PORT = 5057
const WEB_PORT = 5203
const API = `http://localhost:${API_PORT}`
const APP = `http://localhost:${WEB_PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const backend = spawn('python3', ['-u', 'app.py'], {
  cwd: new URL('../../backend', import.meta.url).pathname,
  env: { ...process.env, FORCE_LOCAL_DB: '1', FORCE_HTTPS: '0', DATABASE_PATH: '/tmp/jdlx_probe.db', PORT: String(API_PORT), HOST: '127.0.0.1', FLASK_DEBUG: '', CORS_ORIGINS: `http://localhost:${WEB_PORT}` },
  stdio: 'ignore', detached: true,
})
const cleanup = () => { try { process.kill(-backend.pid) } catch {} }
process.on('exit', cleanup)

let up = false
for (let i = 0; i < 90 && !up; i++) { try { up = (await fetch(`${API}/api/settings`)).ok } catch { await sleep(500) } }
console.log('backend up:', up)

// ── replicate the e2e: token gen + seed + register ──
execSync(`python3 -c "import base64; exec(base64.b64decode('${Buffer.from(`
import sqlite3
c = sqlite3.connect('/tmp/jdlx_probe.db')
c.execute("INSERT OR IGNORE INTO warehouses (id, warehouse_name, email) VALUES (1, 'E2E WH', 'wh@test.com')")
c.commit(); c.close()
`).toString('base64')}').decode())"`, { cwd: new URL('../../backend', import.meta.url).pathname, stdio: 'inherit' })
const ownerToken = execSync(
  `python3 -c "
import os
os.environ['FORCE_LOCAL_DB'] = '1'
os.environ['FORCE_HTTPS'] = '0'
os.environ['DATABASE_PATH'] = '/tmp/jdlx_probe.db'
from dotenv import load_dotenv
load_dotenv('.env')  # SAME as app.py — env JWT_SECRET must win over the file fallback
import jwt, datetime
from jwt_config import get_jwt_secret
print(jwt.encode({'type': 'warehouse', 'warehouse_id': 1, 'email': 'wh@test.com', 'exp': datetime.datetime.utcnow() + datetime.timedelta(days=1)}, get_jwt_secret(), algorithm='HS256'))
"`,
  { cwd: new URL('../../backend', import.meta.url).pathname, encoding: 'utf8' },
).trim()
console.log('token len:', ownerToken.length, 'start:', ownerToken.slice(0, 24))
const reg = await fetch(`${API}/api/warehouse/add-agents`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Probe', email: 'probe@test.com', phone: '9000000009', per_entry_rate: 12 }),
})
console.log('register status:', reg.status, JSON.stringify(await reg.json()).slice(0, 200))

// NOTE: the agent route lives in the WAREHOUSE app, not the store app —
// this test just sits in frontend-store/scratch because puppeteer-core is
// installed there.
const web = spawn('npx', ['vite', '--port', String(WEB_PORT), '--strictPort'], {
  cwd: new URL('../../frontend-warehouse', import.meta.url).pathname,
  env: { ...process.env, VITE_API_URL: API + '/api' },
  stdio: 'ignore', detached: true,
})
let webUp = false
for (let i = 0; i < 60 && !webUp; i++) { try { webUp = (await fetch(APP)).ok } catch { await sleep(500) } }
console.log('web up:', webUp)

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERR:', m.text().slice(0, 200)) })
page.on('requestfailed', (r) => console.log('REQ FAIL:', r.url().slice(0, 90), r.failure()?.errorText))
page.on('pageerror', (e) => console.log('PAGE ERR:', String(e).slice(0, 200)))
const resp = await page.goto(`${APP}/warehouse/agent`, { waitUntil: 'networkidle0', timeout: 60000 })
console.log('goto status:', resp?.status())
await sleep(1500)
console.log('URL:', page.url())
await sleep(2000)
const rootHtml = await page.evaluate(() => ({
  rootHtml: document.getElementById('root')?.innerHTML?.slice(0, 400),
}))
console.log('ROOT HTML:', rootHtml.rootHtml)
await browser.close()
cleanup()
