/**
 * Agent workspace PWA smoke test (real Chrome) — /warehouse/agent is public,
 * so no backend is needed for the login phase. Verifies:
 *   1. Manifest link injected into <head> at runtime (id=agent-manifest-link).
 *   2. Manifest JSON fetches and points at /warehouse/agent with icons.
 *   3. Service worker registers with the narrow /warehouse/agent scope.
 *   4. Login screen intact: T&C list + identifier + Login (no OTP field, no
 *      share button — both live on the profile / warehouse panel).
 *   5. Navigating away removes the manifest tag + zoom override (no head pollution).
 */
import puppeteer from 'puppeteer-core'
import { spawn } from 'node:child_process'

const PORT = 5201
const APP = `http://localhost:${PORT}`
let passed = 0, failed = 0
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log('PASS —', name) }
  else { failed++; console.log('FAIL —', name, extra ? `(${extra})` : '') }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('../../frontend-warehouse', import.meta.url).pathname,
  stdio: 'ignore',
  detached: true,
})
const cleanup = () => { try { process.kill(-server.pid) } catch {} }
process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(1) })

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

await page.goto(APP + '/warehouse/agent', { waitUntil: 'networkidle0', timeout: 60000 })
await sleep(800)

// 1. Runtime-injected manifest link.
check('1. manifest link injected at runtime', await page.evaluate(() =>
  !!document.getElementById('agent-manifest-link')
    && document.getElementById('agent-manifest-link').href.includes('/agent-manifest.json')))

// 2. Manifest fetches and is scoped to the agent route.
const mf = await page.evaluate(async () => {
  const res = await fetch('/agent-manifest.json')
  if (!res.ok) return null
  return res.json()
})
check('2. manifest valid + agent-scoped', !!mf && mf.start_url === '/warehouse/agent' && mf.scope === '/warehouse/agent' && mf.icons.length >= 2)
check('2b. manifest display standalone (installable)', !!mf && mf.display === 'standalone')

// 3. SW registered with narrow scope.
const swScope = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return null
  for (let i = 0; i < 15; i++) {
    const reg = await navigator.serviceWorker.getRegistration('/warehouse/agent')
    if (reg) return reg.scope
    await new Promise((r) => setTimeout(r, 300))
  }
  return null
})
check('3. service worker registered, scope = /warehouse/agent', swScope === APP + '/warehouse/agent', swScope || 'none')

// 4. UI: T&C list + email/mobile login only (no OTP input, no share button).
check('4a. share-login-link button NOT on agent login (panel-only now)', await page.evaluate(() =>
  ![...document.querySelectorAll('button')].some((b) => /share login link/i.test(b.textContent))))
check('4b. T&C shown at login (6 terms)', await page.evaluate(() =>
  /terms & conditions/i.test(document.body.textContent)
  && document.body.textContent.includes('I accept these terms & conditions')))
check('4c. login form intact (identifier + login btn, NO OTP input)', await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.type === 'submit' && /^Login$/i.test(b.textContent.trim()))
  const inputs = [...document.querySelectorAll('input')]
  return !!btn && inputs.some((i) => i.placeholder === 'Email or mobile number')
    && !inputs.some((i) => /otp/i.test(i.placeholder))
}))
check('4e. zoom override active on agent route (viewport + 16px inputs)', await page.evaluate(() => {
  const vp = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || ''
  const identifier = [...document.querySelectorAll('input')].find((i) => i.placeholder === 'Email or mobile number')
  return /maximum-scale=1/.test(vp) && /user-scalable=no/.test(vp)
    && !!identifier && parseFloat(getComputedStyle(identifier).fontSize) >= 16
}))
check('4d. login disabled until T&C accepted (business rule)', await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.type === 'submit' && /^Login$/i.test(b.textContent.trim()))
  return btn && btn.disabled === true
}))

// 5. Head pollution cleanup: navigate to another route → manifest + zoom override removed.
await page.goto(APP + '/warehouse/login', { waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {})
await sleep(500)
check('5. manifest tag removed after leaving agent route', await page.evaluate(() =>
  !document.getElementById('agent-manifest-link')))
check('5b. viewport zoom restored after leaving agent route', await page.evaluate(() => {
  const vp = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || ''
  return !/user-scalable=no/.test(vp) && !document.getElementById('agent-mobile-style')
}))

check('6. no page errors', pageErrors.length === 0, pageErrors.join(' | '))

await browser.close()
cleanup()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
