/**
 * E2E: client error telemetry → backend → admin Error Center data.
 * Runs against an ISOLATED DB copy (/tmp/jdlx_chattest.db) + local servers.
 */
import puppeteer from 'puppeteer-core'
import crypto from 'crypto'
import fs from 'fs'
import { spawnSync } from 'child_process'

const API = 'http://localhost:5099'
const APP = 'http://localhost:5173'
const TEST_EMAIL = 'test@example.com'
const DB = process.env.TEST_DB || '/tmp/jdlx_chattest.db'

const dbQuery = (sql) => {
  const r = spawnSync('python3', [
    '-c',
    `import sqlite3,json,sys; c=sqlite3.connect('${DB}'); c.row_factory=sqlite3.Row; print(json.dumps([dict(row) for row in c.execute(sys.argv[1])]))`,
    sql,
  ], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr || 'db query failed')
  return JSON.parse(r.stdout.trim().split('\n').pop())
}

const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`) }

// ── Mint admin token with backend's own secret (local test only) ──
function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
let secret = process.env.JWT_SECRET || ''
if (!secret) {
  try {
    const envText = fs.readFileSync('/home/jaydev/Desktop/JDLX-Mobile/backend/.env', 'utf8')
    const line = envText.split('\n').find(l => l.trim().startsWith('JWT_SECRET='))
    if (line) secret = line.split('=').slice(1).join('=').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '')
  } catch { /* noop */ }
}
if (!secret) { console.error('NO_SECRET'); process.exit(1) }
const now = Math.floor(Date.now() / 1000)
const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
// Admin token MUST belong to a user whose DB role is actually super_admin
// (the backend re-reads the role from the DB on every admin request).
const payload = b64url(Buffer.from(JSON.stringify({ user_id: 4, email: 'jaydevmahato224@gmail.com', role: 'super_admin', iat: now, jti: 'errtest0123456789ab', exp: now + 3600 })))
const sig = b64url(crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest())
const token = `${header}.${payload}.${sig}`

// ── Pre-checks ──
const vres = await fetch(`${API}/api/auth/verify-token`, { headers: { Authorization: `Bearer ${token}` } })
check('Admin token valid', vres.status === 200, `status ${vres.status}`)

const eventsBefore = dbQuery('SELECT COUNT(*) AS c FROM client_error_events')[0].c
const groupsBefore = dbQuery('SELECT COUNT(*) AS c FROM client_error_groups')[0].c

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 412, height: 915 })
page.on('pageerror', () => { /* expected — we intentionally throw */ })

// ── Phase A: dev-mode default = capture OFF ──
await page.goto(`${APP}/`, { waitUntil: 'networkidle2', timeout: 60000 })
await page.evaluate(() => {
  localStorage.setItem('user', JSON.stringify({ id: 1, name: 'Test User', email: 'test@example.com', role: 'user' }))
  localStorage.setItem('jdlx_onboarding_done', '1')
  localStorage.removeItem('jdlx_client_capture')
})
await page.reload({ waitUntil: 'networkidle2' })
await page.evaluate(() => { setTimeout(() => { throw new Error('E2E_OFF_PROBE_CRASH') }, 50) })
await new Promise(r => setTimeout(r, 2500))
const eventsAfterOff = dbQuery('SELECT COUNT(*) AS c FROM client_error_events')[0].c
check('Dev-mode default: capture OFF (no event stored)', eventsAfterOff === eventsBefore, `${eventsBefore} -> ${eventsAfterOff}`)

// ── Phase B: enable capture via localStorage kill-switch override ──
await page.evaluate(() => { localStorage.setItem('jdlx_client_capture', 'on'); localStorage.setItem('userToken', '') })
await page.reload({ waitUntil: 'networkidle2' })
await new Promise(r => setTimeout(r, 1500))

// 1) Real uncaught throw → window error handler. Puppeteer's evaluate world
// masks thrown messages as "Script error." (cross-context rule), so dispatch a
// synthetic ErrorEvent carrying the full error — this exercises the exact same
// window.addEventListener('error') → report path real page errors take.
await page.evaluate(() => {
  setTimeout(() => {
    try { throw new Error('E2E_PROBE_CRASH_1') } catch (e) {
      window.dispatchEvent(new ErrorEvent('error', { error: e, message: e.message, filename: 'e2e-probe', lineno: 1, colno: 1 }))
    }
  }, 50)
})
// 2) Unhandled promise rejection (synthetic, same isolated-world reason)
await page.evaluate(() => {
  window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error('E2E_PROBE_REJECT_1') }))
})
// 3) Direct module call: API-failure capture (exercises the same queue→flush→backend path)
await page.evaluate(async () => {
  const mod = await import('/src/utils/errorReporter.js')
  mod.captureApiFailure('/api/e2e-probe-route', 'HTTP 503')
})
await new Promise(r => setTimeout(r, 12000)) // wait for the 10s interval flush

const probeEvents = dbQuery(`SELECT kind, message, page, severity FROM client_error_events WHERE message LIKE '%E2E_PROBE%' OR message LIKE '%e2e-probe%' ORDER BY id DESC`)
check('Crash captured (window.onerror)', probeEvents.some(e => e.message.includes('E2E_PROBE_CRASH_1') && e.kind === 'crash'))
check('Unhandled rejection captured', probeEvents.some(e => e.message.includes('E2E_PROBE_REJECT_1') && e.kind === 'unhandledrejection'))
check('API-failure capture works (module path)', probeEvents.some(e => e.message.includes('e2e-probe-route') && e.kind === 'api_failure'))
const crashEv = probeEvents.find(e => e.message.includes('E2E_PROBE_CRASH_1'))
check('Event has page + severity metadata', !!crashEv && !!crashEv.page && !!crashEv.severity, crashEv ? `page=${crashEv.page} sev=${crashEv.severity}` : '')

// Local dedup: fire the same crash 8 more times → at most MAX_PER_KEY(5) NEW
// events from this run (compare against pre-existing rows from earlier runs).
const dedupBefore = dbQuery(`SELECT COUNT(*) AS c FROM client_error_events WHERE message LIKE '%E2E_DEDUP_PROBE%'`)[0].c
await page.evaluate(() => {
  for (let i = 0; i < 8; i++) setTimeout(() => { try { throw new Error('E2E_DEDUP_PROBE') } catch (e) { window.dispatchEvent(new ErrorEvent('error', { error: e, message: e.message })) } }, i * 30)
})
await new Promise(r => setTimeout(r, 12000))
const dedupAfter = dbQuery(`SELECT COUNT(*) AS c FROM client_error_events WHERE message LIKE '%E2E_DEDUP_PROBE%'`)[0].c
check('Local dedup caps repeated errors at 5', dedupAfter - dedupBefore <= 5, `stored ${dedupAfter - dedupBefore} new`)

// ── Grouping (server-side fingerprinting) ──
const groups = dbQuery(`SELECT fingerprint, kind, message, total_count FROM client_error_groups WHERE message LIKE '%E2E_PROBE%' OR message LIKE '%e2e-probe%'`)
check('Server grouped events into error groups', groups.length >= 3, `${groups.length} groups`)
const dupGroups = dbQuery(`SELECT fingerprint, COUNT(*) AS c FROM client_error_groups GROUP BY fingerprint HAVING c > 1`)
check('No duplicate groups for same fingerprint', dupGroups.length === 0)

// ── Admin API surface (as super_admin) ──
const sumRes = await fetch(`${API}/api/admin/client-errors/summary`, { headers: { Authorization: `Bearer ${token}` } })
const sumJson = await sumRes.json().catch(() => ({}))
check('Admin summary endpoint 200', sumRes.status === 200)
check('Summary shows captured events (24h)', (sumJson?.data?.events_24h || 0) >= 4, `events_24h=${sumJson?.data?.events_24h}`)

const grpRes = await fetch(`${API}/api/admin/client-errors/groups?status=new`, { headers: { Authorization: `Bearer ${token}` } })
const grpJson = await grpRes.json().catch(() => ({}))
check('Admin groups list 200 with filters', grpRes.status === 200 && Array.isArray(grpJson?.data))
// Unfiltered list for finding our probe group: a previous run's status
// workflow may have legitimately moved it to 'acknowledged'.
const grpAllRes = await fetch(`${API}/api/admin/client-errors/groups`, { headers: { Authorization: `Bearer ${token}` } })
const grpAllJson = await grpAllRes.json().catch(() => ({}))
const ourGroup = (grpAllJson?.data || []).find(g => g.message.includes('E2E_PROBE_CRASH_1'))
check('Probe crash visible in groups list', !!ourGroup, ourGroup ? `count=${ourGroup.total_count}` : '')

if (ourGroup) {
  const evRes = await fetch(`${API}/api/admin/client-errors/groups/${ourGroup.id}/events`, { headers: { Authorization: `Bearer ${token}` } })
  const evJson = await evRes.json().catch(() => ({}))
  check('Group events drilldown 200', evRes.status === 200 && (evJson?.data || []).length > 0)
  const stRes = await fetch(`${API}/api/admin/client-errors/groups/${ourGroup.id}/status`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'acknowledged' }),
  })
  check('Status workflow update 200', stRes.status === 200)
  const stNow = dbQuery(`SELECT status FROM client_error_groups WHERE id = ${ourGroup.id}`)[0]?.status
  check('Status persisted as acknowledged', stNow === 'acknowledged', stNow)
}

// ── Non-admin blocked ──
const now2 = Math.floor(Date.now() / 1000)
const p2 = b64url(Buffer.from(JSON.stringify({ user_id: 1, email: 'test@example.com', role: 'user', iat: now2, jti: 'errtest0123456789xy', exp: now2 + 3600 })))
const t2 = `${header}.${p2}.${b64url(crypto.createHmac('sha256', secret).update(`${header}.${p2}`).digest())}`
const forbidden = await fetch(`${API}/api/admin/client-errors/summary`, { headers: { Authorization: `Bearer ${t2}` } })
check('Non-admin blocked from admin endpoints (403)', forbidden.status === 403, `status ${forbidden.status}`)

await browser.close()
const failed = results.filter(r => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} PASS`)
process.exit(failed ? 1 : 0)
