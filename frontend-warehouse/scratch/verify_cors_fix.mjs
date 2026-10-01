// Runtime verification of the CORS fix in frontend-warehouse/src/config.js + vercel.json rewrites.
// Drives a real Billing-Agent login submit so the BAKED-IN API_BASE_URL is exercised,
// then asserts which host the POST /api/warehouse/staff/login request targeted:
//   Scenario 1 (prod-like): host *.vercel.app.localhost (matches the production branch,
//     resolves to loopback over HTTP — real vercel.app is HSTS-preloaded and forces HTTPS)
//     → request must go SAME-ORIGIN /api/ and NEVER to jdlx-mobile.onrender.com.
//   Scenario 2 (localhost): request must go direct to http://127.0.0.1:5000/api/ (dev unchanged).
import puppeteer from 'puppeteer-core'

const APP_PORT = 4173
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? `  (${extra})` : ''}`) }

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

async function staffLoginRequestUrl(url) {
  const page = await browser.newPage()
  const staffCalls = []
  let pageHostname = ''
  page.on('request', (r) => { if (r.url().includes('/api/warehouse/staff/login')) staffCalls.push(r.url()) })
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
    pageHostname = await page.evaluate(() => window.location.hostname)
    await page.type('input[type="email"]', 'e2e@example.com', { delay: 5 })
    await page.type('input[type="password"]', 'wrong-password-e2e', { delay: 5 })
    await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/warehouse/staff/login'), { timeout: 10000 }),
      page.click('button[type="submit"]'),
    ])
  } catch (e) { console.log(`  nav note: ${e.message.slice(0, 90)}`) }
  await sleep(1500)
  await page.close()
  return { staffCalls, pageHostname }
}

// ── Scenario 1: production-like hostname (the bug scenario) ─────────────
{
  const prodHost = `jdlx-mobile-wearhouse.vercel.app.localhost:${APP_PORT}`
  const { staffCalls, pageHostname } = await staffLoginRequestUrl(`http://${prodHost}/`)
  const onrender = staffCalls.filter(u => u.includes('jdlx-mobile.onrender.com'))
  // Same-origin check by HOSTNAME: the baked API_BASE_URL uses window.location.hostname
  // (no port) — correct on real Vercel (standard ports); local fake-host port differs.
  const sameOrigin = staffCalls.filter(u => { try { return new URL(u).hostname === pageHostname } catch { return false } })
  const apiPath = staffCalls.filter(u => { try { return new URL(u).pathname.startsWith('/api/') } catch { return false } })
  check('prod host: staff-login fired (preflight + POST)', staffCalls.length >= 1, `${staffCalls.length} call(s)`)
  check('prod host: ZERO cross-origin onrender.com API calls', onrender.length === 0, onrender[0] || '-')
  check('prod host: staff-login went SAME-ORIGIN /api/ (page hostname)', sameOrigin.length === staffCalls.length && apiPath.length === staffCalls.length && staffCalls.length > 0, staffCalls[0] ? staffCalls[0].slice(0, 90) : '-')
}

// ── Scenario 2: localhost (local dev must stay unchanged) ───────────────
{
  const { staffCalls } = await staffLoginRequestUrl(`http://127.0.0.1:${APP_PORT}/`)
  const direct = staffCalls.filter(u => /^http:\/\/(127\.0\.0\.1|localhost):5000\/api\//.test(u))
  const onrender = staffCalls.filter(u => u.includes('onrender.com'))
  check('localhost: staff-login fired (preflight + POST)', staffCalls.length >= 1, `${staffCalls.length} call(s)`)
  check('localhost: staff-login went direct :5000 (dev flow intact)', direct.length === staffCalls.length && staffCalls.length > 0, staffCalls[0] ? staffCalls[0].slice(0, 90) : '-')
  check('localhost: ZERO onrender.com calls', onrender.length === 0, onrender[0] || '-')
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
