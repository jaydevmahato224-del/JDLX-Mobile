/**
 * Scroll-lock e2e (real Chrome) — runs against the REAL production module
 * via the Vite dev server serving scratch/scrolllock_harness.html, which
 * replicates the panel layout structure (fixed backdrop z-40, fixed sidebar
 * z-50 with an overflow-y-auto nav, below-backdrop main scroll container,
 * above-everything modal with inner scroll).
 *
 * Verification uses defaultPrevented on cancelable dispatched events —
 * untrusted wheel events never perform default scrolling, but preventDefault
 * by the guard is still observable, which is exactly the behavior we fixed.
 *
 * Scenario flow:
 *  A. Backdrop open (sidebar drawer up)  → sidebar scrollable, background frozen.
 *  B. Modal opens ABOVE the sidebar      → modal inner scroll works, sidebar now frozen.
 *  C. Modal closes, backdrop remains     → sidebar scrollable again, background frozen.
 *  D. Backdrop closes                    → everything unlocked, body styles restored.
 */
import puppeteer from 'puppeteer-core'
import { spawn } from 'node:child_process'

const PORT = 5199
const APP = `http://localhost:${PORT}`
let passed = 0, failed = 0
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log('PASS —', name) }
  else { failed++; console.log('FAIL —', name, extra ? `(${extra})` : '') }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// — Start the dev server for frontend-warehouse (the harness + module live
// there); the test itself runs from frontend-store because puppeteer-core is
// installed only in that package.
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../../frontend-warehouse', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
})
const cleanup = () => { try { process.kill(-server.pid) } catch {} }
process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(1) })

// Wait for the server to accept connections.
let up = false
for (let i = 0; i < 60 && !up; i++) {
  try { up = (await fetch(APP)).ok } catch { await sleep(500) }
}
if (!up) { console.error('dev server did not start'); process.exit(1) }

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 412, height: 915 })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 120)))

await page.goto(APP + '/scratch/scrolllock_harness.html', { waitUntil: 'networkidle0', timeout: 60000 })
await page.waitForFunction('window.__harnessReady === true', { timeout: 15000 })
await sleep(300)

// Dispatch a cancelable wheel/touchmove on `selector`; returns defaultPrevented.
const prevented = (type, selector) =>
  page.evaluate((t, sel) => {
    const el = document.querySelector(sel)
    const ev = new WheelEvent(t, { bubbles: true, cancelable: true, deltaY: 120 })
    el.dispatchEvent(ev)
    return ev.defaultPrevented
  }, type, selector)

const show = (sel, disp) => page.evaluate(([s, d]) => { document.querySelector(s).style.display = d }, [sel, disp])
const bodyFrozen = () => page.evaluate(() => document.body.style.position === 'fixed')
const waitLock = async (on) => { for (let i = 0; i < 20; i++) { if ((await bodyFrozen()) === on) return true; await sleep(150) } return false }

// — A. Backdrop (drawer backdrop) opens — the reported bug scenario.
await show('#backdrop', 'block')
check('A0. lock engages when backdrop appears', await waitLock(true))
check('A1. wheel inside sidebar nav is ALLOWED', (await prevented('wheel', '#nav')) === false)
check('A2. touchmove inside sidebar nav is ALLOWED', (await prevented('touchmove', '#nav')) === false)
check('A3. wheel inside background main container is FROZEN', (await prevented('wheel', '#main-scroll')) === true)
check('A4. touchmove inside background main container is FROZEN', (await prevented('touchmove', '#main-scroll')) === true)
check('A5. body freeze applied', await bodyFrozen())

// — B. A modal opens ABOVE the sidebar (z-10050 > z-50).
await show('#modal', 'flex')
await sleep(400) // observer rAF re-evaluate
check('B1. wheel inside modal inner scroll is ALLOWED', (await prevented('wheel', '#modal-inner')) === false)
check('B2. sidebar below the modal is frozen (stacking rule)', (await prevented('wheel', '#nav')) === true)

// — C. Modal closes, backdrop stays.
await show('#modal', 'none')
await sleep(400)
check('C1. sidebar scrollable again after modal closes', (await prevented('wheel', '#nav')) === false)
check('C2. background still frozen while backdrop is up', (await prevented('wheel', '#main-scroll')) === true)

// — D. Backdrop closes → full unlock + restore.
await show('#backdrop', 'none')
check('D0. lock releases when last overlay goes away', await waitLock(false))
check('D1. wheel in main container allowed after unlock', (await prevented('wheel', '#main-scroll')) === false)
check('D2. body styles fully restored', await page.evaluate(() =>
  document.body.style.position === '' && document.body.style.overflow === '' && document.body.style.top === ''))

check('E1. no page errors during the whole run', pageErrors.length === 0, pageErrors.join(' | '))

await browser.close()
cleanup()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
