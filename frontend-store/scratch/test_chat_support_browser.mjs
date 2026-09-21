/**
 * Full-page bilingual chat support e2e (real Chrome).
 * Verifies: language card first on fresh chat, English default, Hindi replies
 * after switching, full-page overlay + FAB, category navigation inside the
 * chat overlay only, restart, history-on-reopen, and zero page errors.
 */
import puppeteer from 'puppeteer-core'
import crypto from 'crypto'
import fs from 'fs'

const APP = 'http://localhost:5173'

function b64url(buf) { return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') }
let secret = ''
try {
  const envText = fs.readFileSync('/home/jaydev/Desktop/JDLX-Mobile/backend/.env', 'utf8')
  const line = envText.split('\n').find((l) => l.trim().startsWith('JWT_SECRET='))
  if (line) secret = line.split('=')[1].trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '')
} catch { /* noop */ }

const token = (() => {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const now = Math.floor(Date.now() / 1000)
  const payload = b64url(Buffer.from(JSON.stringify({ user_id: 1, email: 'test@example.com', role: 'user', iat: now, jti: 'chatsupport0123456789', exp: now + 7200 })))
  const sig = b64url(crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest())
  return `${header}.${payload}.${sig}`
})()

let passed = 0, failed = 0
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log('PASS —', name) }
  else { failed++; console.log('FAIL —', name, extra ? `(${extra})` : '') }
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 412, height: 915 })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.toString().slice(0, 140)))

await page.goto(APP + '/?_fresh=1', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.evaluate((t) => {
  localStorage.setItem('jdlx_onboarding_done', '1')
  localStorage.setItem('userToken', t)
  localStorage.setItem('user', JSON.stringify({ id: 1, name: 'Test User', email: 'test@example.com', role: 'user' }))
  sessionStorage.clear()
}, token)

// Click a button INSIDE the chat overlay only (never background page buttons).
const clickInChat = async (regex) => {
  return page.evaluate((reSrc) => {
    const re = new RegExp(reSrc, 'i')
    const chat = document.querySelector('[aria-label="Support chat"]')
    if (!chat) return false
    const els = [...chat.querySelectorAll('button, [role="button"], a')]
    const el = els.find((b) => re.test((b.textContent || '').trim()))
    if (el) { el.click(); return true }
    return false
  }, regex.source)
}
const chatText = () => page.evaluate(() => {
  const chat = document.querySelector('[aria-label="Support chat"]')
  return chat ? chat.innerText : ''
})

// 1) Profile page + FAB
await page.goto(APP + '/profile', { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise((r) => setTimeout(r, 3000))
const authed = await page.evaluate(() => document.body.innerText)
check('profile page renders (authenticated)', !/sign in with your google/i.test(authed.slice(0, 500)), authed.slice(0, 120).replace(/\n/g, ' '))

const fab = await page.$('button[aria-label="Chat with us"]')
check('FAB rendered on profile page', !!fab)
if (!fab) { console.log('CANNOT CONTINUE'); await browser.close(); process.exit(1) }

// 2) Open → full-page + language card FIRST
await fab.click()
await new Promise((r) => setTimeout(r, 1200))
let chat = await chatText()
check('full-page chat opens', /HERE TO HELP|JDLX Assistant/i.test(chat))
check('language card is FIRST (fresh chat)', /Which language would you like to chat in/i.test(chat), chat.slice(0, 160).replace(/\n/g, ' '))
check('English option shown', /English/.test(chat))
check('हिन्दी option shown', /हिन्दी/.test(chat))

// 3) Choose English → greeting in English (default language)
await clickInChat(/English/)
await new Promise((r) => setTimeout(r, 900))
chat = await chatText()
check('English greeting after choice', /What can I help you with today/i.test(chat), chat.slice(-200).replace(/\n/g, ' '))

// 4) Category navigation (decision tree, no typing)
const navOk = await clickInChat(/Order \/ Delivery issue/)
await new Promise((r) => setTimeout(r, 700))
chat = await chatText()
check('category opens sub-options', navOk && /Where is my order|Order is late/i.test(chat), chat.slice(-200).replace(/\n/g, ' '))
const hasInput = await page.evaluate(() => {
  const chatEl = document.querySelector('[aria-label="Support chat"]')
  return chatEl ? !!chatEl.querySelector('textarea, input[type="text"]') : true
})
check('no free-text typing anywhere', !hasInput)
await clickInChat(/Main menu/)
await new Promise((r) => setTimeout(r, 700))

// 5) Switch language → future bubbles in Hindi
await page.click('button[aria-label="Switch language"]').catch(() => {})
await new Promise((r) => setTimeout(r, 500))
await clickInChat(/हिन्दी/)
await new Promise((r) => setTimeout(r, 600))
await clickInChat(/Main menu|मुख्य मेनू/)
await new Promise((r) => setTimeout(r, 900))
chat = await chatText()
check('Hindi content after switch (future bubbles)', /अन्य सवाल|Cart मदद/i.test(chat), chat.slice(-160).replace(/\n/g, ' '))

// 6) Restart via header control
const restarted = await clickInChat(/Restart|फिर से/)
await new Promise((r) => setTimeout(r, 1100))
chat = await chatText()
check('restart returns to main menu (Hindi)', restarted && /अन्य सवाल/i.test(chat), `restarted=${restarted} :: ${chat.slice(-140).replace(/\n/g, ' ')}`)

// 7) Close + reopen → history preserved (resume, not blank)
await page.evaluate(() => document.querySelector('button[aria-label="Close chat"]')?.click())
await new Promise((r) => setTimeout(r, 1000))
const closedGone = await page.evaluate(() => !document.querySelector('[aria-label="Support chat"]'))
let reopened = false
for (let i = 0; i < 3 && !reopened; i++) {
  reopened = await page.evaluate(() => {
    const fab = document.querySelector('button[aria-label="Chat with us"]')
    if (!fab) return false
    fab.click()
    return true
  })
  await new Promise((r) => setTimeout(r, 1200))
  if (reopened) reopened = await page.evaluate(() => !!document.querySelector('[aria-label="Support chat"]'))
}
check('chat closes back to FAB', closedGone)
chat = await chatText()
check('reopen keeps chat history (resume)', reopened && /Which language would you like to chat in/i.test(chat), `opened=${reopened} closedGone=${closedGone} :: ${chat.slice(0, 160).replace(/\n/g, ' ')}`)

check('zero page errors during whole flow', pageErrors.length === 0, pageErrors.join(' | '))

console.log(`\n=== CHAT SUPPORT E2E: ${passed}/${passed + failed} PASSED ===`)
if (pageErrors.length) console.log('Errors:', pageErrors.slice(0, 5).join('\n'))
await browser.close()
process.exit(failed ? 1 : 0)
