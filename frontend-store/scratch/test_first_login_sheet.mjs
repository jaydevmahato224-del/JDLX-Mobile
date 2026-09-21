/**
 * First-run login sheet e2e (real Chrome).
 * Fresh first run: onboarding completes → PostOnboardingRedirect lands on
 * /login with state {firstRun:true} → login must appear as a bottom sheet
 * with a "Skip for now" escape. Skip → guest home. Header login → the regular
 * full login page (unchanged). Also checks the sheet's Google button exists
 * (headless cannot complete real OAuth).
 */
import puppeteer from 'puppeteer-core'

const APP = 'http://localhost:5173'
let passed = 0, failed = 0
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log('PASS —', name) }
  else { failed++; console.log('FAIL —', name, extra ? `(${extra})` : '') }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 412, height: 915 })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.toString().slice(0, 120)))

// Fresh first run: wipe the onboarding flag BEFORE first load.
await page.goto(APP + '/?_fresh=1', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.evaluate(() => localStorage.removeItem('jdlx_onboarding_done'))
await page.goto(APP + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(3500)

// — Onboarding: permissions (3 cards) → source → guide → complete.
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.z-\\[10050\\] button')].find((b) => /^Reject$/i.test(b.textContent.trim()))
    if (btn) btn.click()
  })
  await sleep(2000)
}
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /Start Shopping|Continue/i.test(b.textContent))?.click() })
await sleep(1200)
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /Friends & Family|Friends/i.test(b.textContent))?.click() })
await sleep(400)
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /^Continue/i.test(b.textContent.trim()))?.click() })
await sleep(1200)
for (let i = 0; i < 6; i++) {
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Next →' || x.textContent.trim().startsWith('Get Started'))
    if (b) { b.click(); return true }
    return false
  })
  if (!clicked) break
  await sleep(600)
}
await sleep(1000)

// — Post-onboarding: first-run login must be the bottom sheet.
const onLogin = await page.evaluate(() => window.location.pathname)
check('redirected to /login after onboarding', onLogin === '/login', onLogin)

const sheetText = await page.evaluate(() => {
  const el = document.querySelector('.z-\\[10050\\]')
  return el ? el.textContent.replace(/\s+/g, ' ') : 'SHEET_GONE'
})
check('first-run login shows as bottom sheet', /Welcome to JDLX Mobile/.test(sheetText), sheetText.slice(0, 140))
check('sheet has Google login button', /Continue with Google/i.test(sheetText))
check('sheet has Skip escape', /Skip for now/i.test(sheetText), sheetText.slice(0, 140))
check('sheet shows terms line', /Terms of Service|Privacy Policy/i.test(sheetText))

// — Skip → guest home, sheet gone.
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /Skip for now/i.test(b.textContent))?.click() })
await sleep(1200)
const afterSkip = await page.evaluate(() => ({ path: window.location.pathname, text: document.body.innerText }))
check('skip lands on guest home', afterSkip.path === '/' && /JDLX|Shop|Home/i.test(afterSkip.text), afterSkip.path + ' | ' + afterSkip.text.slice(0, 90).replace(/\n/g, ' '))
check('sheet unmounted after skip', !(await page.$('.z-\\[10050\\]')))

// — Regular login entry (header) must still show the FULL login page.
await page.evaluate(() => { [...document.querySelectorAll('a,button')].find((b) => /login|sign in/i.test(b.textContent))?.click() })
await sleep(1500)
const loginPage = await page.evaluate(() => ({ path: window.location.pathname, text: document.body.innerText }))
check('regular login page still reachable', loginPage.path === '/login', loginPage.path)
check('regular login page unchanged (no sheet)', /Welcome to JDLX Mobile/.test(loginPage.text) && /Continue with Google/i.test(loginPage.text) && !(await page.$('.z-\\[10050\\]')), loginPage.text.slice(0, 140).replace(/\n/g, ' '))

// — Protected route still bounces guests to /login (auth flow intact).
await page.goto(APP + '/profile', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(1500)
const bounce = await page.evaluate(() => window.location.pathname)
check('protected route still bounces guests to /login', bounce === '/login', bounce)

check('no real page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200))

await browser.close()
console.log(`\n=== FIRST LOGIN SHEET: ${passed}/${passed + failed} ${failed === 0 ? 'PASSED' : 'FAILED'} ===`)
process.exit(failed === 0 ? 0 : 1)
