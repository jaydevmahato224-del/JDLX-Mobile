/**
 * OnboardingGuide page-switch e2e (real Chrome).
 * Regression test for the page-switch jitter: all 3 guide pages now render in
 * a single grid stack (fixed container height), so switching pages must NOT
 * change the layout height of the guide's inner block. Also verifies content
 * switching (emoji/title/points), dot navigation, Back, and that the skip →
 * login-sheet → onboarding-complete flow still works end-to-end.
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

await page.goto(APP + '/?_fresh=1', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.evaluate(() => localStorage.removeItem('jdlx_onboarding_done'))
await page.goto(APP + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(3500)

// Reach the guide: skip all 3 permission cards, then source step.
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

const guideVisible = await page.evaluate(() => /Shop Anything, Anytime/.test(document.body.innerText))
check('guide page 1 visible', guideVisible)

// — Jitter regression: guide block height must be IDENTICAL on every page.
const heights = []
const titles = ['Shop Anything, Anytime', 'Fast Delivery, Live Tracking', 'Offers, Referrals & Wallet']
const emoj = ['🛍️', '🚚', '🎁']
for (let i = 0; i < 3; i++) {
  const h = await page.evaluate(() => {
    const el = document.querySelector('.z-\\[10050\\] .grid.w-full')
    return el ? el.getBoundingClientRect().height : -1
  })
  heights.push(h)
  if (i < 2) {
    await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next →')?.click() })
    await sleep(600) // let the 300ms transition fully settle
  }
}
check('all 3 guide pages reached', heights.every((h) => h > 0), JSON.stringify(heights))
check('guide block height stable across page switches (no jitter)', Math.abs(heights[0] - heights[1]) < 1 && Math.abs(heights[1] - heights[2]) < 1, JSON.stringify(heights))

// Back to page 1 to continue content checks from a known state.
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /← Back/.test(b.textContent))?.click() })
await sleep(600)

// Content switching still works: only the ACTIVE page is visible/interactive.
// (Back above lands on page 2, so index 1 must be the active one.)
const visibility = await page.evaluate(() => {
  const pages = [...document.querySelectorAll('.z-\\[10050\\] .grid.w-full > div')]
  return pages.map((el) => {
    const cs = getComputedStyle(el)
    return { opacity: cs.opacity, pe: cs.pointerEvents }
  })
})
check('only active page visible (opacity swap)', visibility[1].opacity === '1' && visibility[0].opacity === '0' && visibility[2].opacity === '0', JSON.stringify(visibility))
check('inactive pages non-interactive', visibility[0].pe === 'none' && visibility[2].pe === 'none', JSON.stringify(visibility))

// Dot navigation works.
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Go to page 3')?.click() })
await sleep(600)
const onP3 = await page.evaluate(() => document.body.innerText)
check('dot navigation switches to page 3', /Offers, Referrals & Wallet/.test(onP3))
check('last page shows Get Started', /Get Started/.test(onP3))

// Back button works.
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /← Back/.test(b.textContent))?.click() })
await sleep(600)
const onP2 = await page.evaluate(() => document.body.innerText)
check('Back returns to page 2', /Fast Delivery, Live Tracking/.test(onP2))

// — Full flow completion: guide finish → first-run login sheet → skip → home.
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /Go to page 3/.test(b.getAttribute('aria-label') || ''))?.click() })
await sleep(400)
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Get Started'))?.click() })
await sleep(1500)
const afterGuide = await page.evaluate(() => ({ path: window.location.pathname, text: document.body.innerText }))
check('guide completes → first-run login sheet', afterGuide.path === '/login' && /Welcome to JDLX Mobile/.test(afterGuide.text), afterGuide.path)

await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /Skip for now/i.test(b.textContent))?.click() })
await sleep(1200)
const afterSkip = await page.evaluate(() => ({ path: window.location.pathname, flag: localStorage.getItem('jdlx_onboarding_done') }))
check('skip → guest home, flag persisted', afterSkip.path === '/' && afterSkip.flag === '1', JSON.stringify(afterSkip))

check('no real page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200))

await browser.close()
console.log(`\n=== GUIDE JITTER: ${passed}/${passed + failed} ${failed === 0 ? 'PASSED' : 'FAILED'} ===`)
process.exit(failed === 0 ? 0 : 1)
