/**
 * First-run login sheet e2e (real Chrome).
 *
 * Fresh first run: onboarding completes → PostOnboardingRedirect lands on
 * /login with state {firstRun:true} → login must appear as a bottom sheet
 * with a "Skip for now" escape, and the HOME PAGE must render behind it
 * (the old gray/blank backdrop bug). Skip → guest home. Header login → the
 * regular full login page (unchanged). ONE-SHOT rule: after the sheet has
 * been shown once, a /login reload that restores {firstRun:true} from
 * history state must show the regular login page — never the sheet again
 * (the reported "sheet phir se aa gaya" bug).
 *
 * All waits are POLL-based (not fixed sleeps) so splash/onboarding timings
 * can never make the driver click against a stale screen.
 */
import puppeteer from 'puppeteer-core'

const APP = 'http://localhost:5173'
let passed = 0, failed = 0
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log('PASS —', name) }
  else { failed++; console.log('FAIL —', name, extra ? `(${extra})` : '') }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Poll until fn() returns truthy (or timeout). All UI waits go through this
// so the test survives the 6s splash + async step transitions.
const waitFor = async (fn, timeout = 25000, interval = 300) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const v = await fn()
      if (v) return v
    } catch { /* page mid-transition — keep polling */ }
    await sleep(interval)
  }
  return null
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 412, height: 915 })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.toString().slice(0, 120)))

// Click the first overlay (.z-[10050]) button matching any of the regexes.
const clickSheetButton = (regexes, timeout = 25000) =>
  waitFor(async () => {
    const ok = await page.evaluate((patterns) => {
      const sheet = document.querySelector('.z-\\[10050\\]')
      if (!sheet) return false
      const btn = [...sheet.querySelectorAll('button')].find((b) =>
        patterns.some((p) => new RegExp(p, 'i').test(b.textContent.trim())))
      if (!btn) return false
      btn.click()
      return true
    }, regexes)
    return ok
  }, timeout)

// Fresh first run: wipe the onboarding flag BEFORE first load.
await page.goto(APP + '/?_fresh=1', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.evaluate(() => localStorage.removeItem('jdlx_onboarding_done'))
await page.goto(APP + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })

// — Onboarding: permissions (3 cards, Reject each) → summary → source → guide.
for (let i = 0; i < 3; i++) {
  const clicked = await clickSheetButton(['^Reject$'])
  check(`permission ${i + 1} card handled (Reject)`, !!clicked)
}
check('permission summary reached', !!(await clickSheetButton(['Start Shopping'])))
check('source option selected', !!(await waitFor(async () => page.evaluate(() => {
  const b = [...document.querySelectorAll('.z-\\[10050\\] button, button')].find((x) => /Friends & Family/i.test(x.textContent))
  if (b) { b.click(); return true }
  return false
}))))
check('source continued', !!(await clickSheetButton(['^Continue'])))
// Guide: Next → until Get Started.
let guideDone = false
for (let i = 0; i < 8 && !guideDone; i++) {
  guideDone = !!(await waitFor(async () => page.evaluate(() => {
    const done = [...document.querySelectorAll('button')].find((x) => /^Get Started/i.test(x.textContent.trim()))
    if (done) { done.click(); return true }
    const next = [...document.querySelectorAll('.z-\\[10050\\] button')].find((x) => x.textContent.trim() === 'Next →')
    if (next) { next.click(); return false }
    return false
  }), 8000))
}
check('guide completed (Get Started)', guideDone)

// — Post-onboarding: first-run login must be the bottom sheet.
check('redirected to /login after onboarding',
  !!(await waitFor(() => page.evaluate(() => window.location.pathname === '/login'))),
  await page.evaluate(() => window.location.pathname))

const sheetUp = await waitFor(() => page.evaluate(() => {
  const el = document.querySelector('.z-\\[10050\\]')
  return el && /Welcome to JDLX Mobile/.test(el.textContent) ? el.textContent.replace(/\s+/g, ' ') : null
}))
check('first-run login shows as bottom sheet', !!sheetUp, (sheetUp || 'SHEET_GONE').slice(0, 140))
check('sheet has Google login button', /Continue with Google/i.test(sheetUp || ''))
check('sheet has Skip escape', /Skip for now/i.test(sheetUp || ''))
check('sheet shows terms line', /Terms of Service|Privacy Policy/i.test(sheetUp || ''))

// HOME must render BEHIND the sheet (the reported gray/blank backdrop bug):
// the home page's always-present "Elite Catalog" section must be in the DOM
// while the sheet is up.
const homeBehind = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
check('home page renders behind the sheet (no gray void)', /Elite Catalog/i.test(homeBehind), homeBehind.slice(0, 140))
check('one-shot flag written at presentation',
  (await page.evaluate(() => localStorage.getItem('jdlx_first_login_sheet_shown'))) === '1')

// — Skip → guest home, sheet gone.
await clickSheetButton(['Skip for now'])
const afterSkip = await waitFor(() => page.evaluate(() => ({
  path: window.location.pathname,
  sheetGone: !document.querySelector('.z-\\[10050\\]'),
  text: document.body.innerText,
})))
check('skip lands on guest home', afterSkip && afterSkip.path === '/', afterSkip ? afterSkip.path : 'timeout')
check('sheet unmounted after skip', !!afterSkip && afterSkip.sheetGone)

// — Regular login entry (header) must still show the FULL login page.
check('header login opens regular login page', !!(await waitFor(async () => {
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('a,button')].find((b) => /login|sign in/i.test(b.textContent))
    if (el) el.click()
  })
  return page.evaluate(() => window.location.pathname === '/login')
})))
const regularLogin = await waitFor(() => page.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, ' ')
  return /continue shopping/i.test(t) && !document.querySelector('.z-\\[10050\\]') ? t : null
}))
check('regular login page unchanged (no sheet)', !!regularLogin, (regularLogin || 'NOT_FOUND').slice(0, 140))

// — ONE-SHOT: reload /login with {firstRun:true} restored from history state
// (what a refresh on /login does) — the sheet must NOT re-appear.
await page.evaluate(() => history.replaceState({ usr: { firstRun: true } }, '', '/login'))
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
const afterReload = await waitFor(() => page.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, ' ')
  return /Welcome to JDLX Mobile/i.test(t) ? { sheet: !!document.querySelector('.z-\\[10050\\]'), text: t } : null
}))
check('reload with restored firstRun state does NOT re-show sheet',
  !!afterReload && !afterReload.sheet,
  afterReload ? (afterReload.sheet ? 'SHEET RE-SHOWN' : 'no login content') : 'timeout')

// — Protected route still bounces guests to /login (auth flow intact).
await page.goto(APP + '/profile', { waitUntil: 'domcontentloaded', timeout: 60000 })
const bounce = await waitFor(() => page.evaluate(() => window.location.pathname === '/login'))
check('protected route still bounces guests to /login', !!bounce,
  await page.evaluate(() => window.location.pathname))

check('no real page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200))

await browser.close()
console.log(`\n=== FIRST LOGIN SHEET: ${passed}/${passed + failed} ${failed === 0 ? 'PASSED' : 'FAILED'} ===`)
process.exit(failed === 0 ? 0 : 1)
