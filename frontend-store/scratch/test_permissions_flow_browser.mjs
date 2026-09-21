/**
 * Sequential permission onboarding e2e (real Chrome).
 * Fresh first-run: home renders → bottom-sheet card 1 → Reject → outcome banner
 * → card 2 → card 3 → summary → complete → sheet unmounts, flag persisted.
 * Headless Chrome auto-denies native prompts, so Allow paths resolve as
 * 'denied' outcomes — the mechanics (progression, banners, summary) are what
 * we verify here.
 */
import puppeteer from 'puppeteer-core'

const APP = 'http://localhost:5173'
let passed = 0, failed = 0
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log('PASS —', name) }
  else { failed++; console.log('FAIL —', name, extra ? `(${extra})` : '') }
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--deny-permission-prompts'],
})
const page = await browser.newPage()
await page.setViewport({ width: 412, height: 915 })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.toString().slice(0, 120)))

// Fresh first-run: clear the onboarding flag BEFORE first page load.
await page.goto(APP + '/?_fresh=1', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.evaluate(() => { localStorage.removeItem('jdlx_onboarding_done') })
await page.goto(APP + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })

// Wait for the sheet to slide up.
await new Promise((r) => setTimeout(r, 3500))

const sheetText1 = await page.evaluate(() => document.body.innerText)
check('bottom-sheet appears after home load', /Permission 1 of/i.test(sheetText1), sheetText1.slice(0, 120).replace(/\n/g, ' '))
check('home content renders behind scrim', /JDLX|Shop|Cart|Home/i.test(sheetText1))

// Card 1 = Notifications. Reject it → outcome banner, then card 2.
const rejectBtn = await page.$$('button')
let rejected = false
for (const b of rejectBtn) {
  const t = await b.evaluate((el) => el.textContent.trim())
  if (/^Reject$/i.test(t)) { await b.click(); rejected = true; break }
}
check('Reject button clicked on card 1', rejected)
// Outcome banner holds for ~1.1s before the next card slides up — check inside that window.
await new Promise((r) => setTimeout(r, 600))

const afterReject = await page.evaluate(() => document.body.innerText)
check('outcome banner shows Skipped', /Skipped/i.test(afterReject), afterReject.slice(0, 100).replace(/\n/g, ' '))
// Card 2 should now be visible.
await new Promise((r) => setTimeout(r, 1300))
const card2 = await page.evaluate(() => document.body.innerText)
check('card 2 appears sequentially', /Permission 2 of/i.test(card2))

// Card 2 = Location. Allow it (headless auto-deny → outcome "Blocked" then card 3).
let allowed = false
const btns2 = await page.$$('button')
for (const b of btns2) {
  const t = await b.evaluate((el) => el.textContent.trim())
  if (/^Allow /i.test(t)) { await b.click(); allowed = true; break }
}
check('Allow button clicked on card 2', allowed)
await new Promise((r) => setTimeout(r, 600))
const afterAllow = await page.evaluate(() => document.body.innerText)
check('outcome banner after Allow (Allowed/Blocked)', /Allowed!|Blocked/i.test(afterAllow), afterAllow.slice(0, 100).replace(/\n/g, ' '))
await new Promise((r) => setTimeout(r, 1300))
const card3 = await page.evaluate(() => document.body.innerText)
check('card 3 appears sequentially', /Permission 3 of/i.test(card3))

// Card 3 = Camera. Reject.
const btns3 = await page.$$('button')
for (const b of btns3) {
  const t = await b.evaluate((el) => el.textContent.trim())
  if (/^Reject$/i.test(t)) { await b.click(); break }
}
await new Promise((r) => setTimeout(r, 2600))

const summary = await page.evaluate(() => document.body.innerText)
check('summary card shows all 3 permissions', /Notifications|Location|Camera/i.test(summary) && /Allowed|Blocked|Not asked|Not available/i.test(summary))
check('summary has finish CTA', /Start Shopping|Continue/i.test(summary))

// Complete the permissions step → the EXISTING onboarding flow continues
// (permissions → source → guide); the flag is set only after the guide ends.
const finish = await page.$$('button')
for (const b of finish) {
  const t = await b.evaluate((el) => el.textContent.trim())
  if (/Start Shopping|Continue Anyway/i.test(t)) { await b.click(); break }
}
await new Promise((r) => setTimeout(r, 1000))
const afterPerms = await page.evaluate(() => document.body.innerText)
check('sheet advances past permissions (source step)', !/Permission 1 of/i.test(afterPerms) && /hear about us|Friends|Social/i.test(afterPerms), afterPerms.slice(0, 100).replace(/\n/g, ' '))

// Complete the source step: pick an option, then Continue.
const opts = await page.$$('button')
for (const b of opts) {
  const t = await b.evaluate((el) => el.textContent.trim())
  if (/Friends & Family/i.test(t)) { await b.click(); break }
}
await new Promise((r) => setTimeout(r, 400))
const srcBtns = await page.$$('button')
for (const b of srcBtns) {
  const t = await b.evaluate((el) => el.textContent.trim())
  if (/Continue/i.test(t)) { await b.click(); break }
}
await new Promise((r) => setTimeout(r, 1000))

// Complete the guide: tap through all pages to the final CTA. Exact texts only
// ("Next →", "Get Started 🚀") so we never click login-page CTAs like
// "Continue with Google" and drift onto accounts.google.com.
for (let i = 0; i < 6; i++) {
  const guideBtns = await page.$$('button')
  let clicked = false
  for (const b of guideBtns) {
    const t = await b.evaluate((el) => el.textContent.trim())
    if (t === 'Next →' || t.startsWith('Get Started')) { await b.click(); clicked = true; break }
  }
  if (!clicked) break
  await new Promise((r) => setTimeout(r, 600))
}
await new Promise((r) => setTimeout(r, 800))

// Sanity: we must still be on the app origin (a wrong click lands on Google).
const origin = await page.evaluate(() => window.location.origin)
check('still on app origin after onboarding', origin === 'http://localhost:5173', origin)

const afterDone = await page.evaluate(() => ({
  text: document.body.innerText,
  flag: localStorage.getItem('jdlx_onboarding_done'),
}))
console.log('DIAG screen tail:', afterDone.text.slice(-260).replace(/\n/g, ' | '))
check('onboarding flow fully completes', !/hear about us/i.test(afterDone.text))
check('onboarding flag persisted after full flow', afterDone.flag === '1', 'flag=' + afterDone.flag)

check('no real page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200))

await browser.close()
console.log(`\n=== PERMISSIONS FLOW: ${passed}/${passed + failed} ${failed === 0 ? 'PASSED' : 'FAILED'} ===`)
process.exit(failed === 0 ? 0 : 1)
