import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--deny-permission-prompts'] })
const page = await browser.newPage()
await page.setViewport({ width: 412, height: 915 })
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 45000 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(4000)
const dump = async (label) => {
  const t = await page.evaluate(() => {
    const el = document.querySelector('.z-\\[10050\\]')
    if (!el) return 'SHEET_GONE'
    const btns = [...el.querySelectorAll('button')].map((b) => b.textContent.trim().slice(0, 30)).join(' | ')
    return el.textContent.replace(/\s+/g, ' ').slice(0, 260) + ' || BUTTONS: ' + btns
  })
  console.log(`[${label}]`, t)
}
await dump('initial')
// allow card1
await page.evaluate(() => { [...document.querySelectorAll('.z-\\[10050\\] button')].find((b) => /allow/i.test(b.textContent))?.click() })
await sleep(200); await dump('after allow1 +200ms')
await sleep(1600); await dump('after allow1 +1800ms')
await page.evaluate(() => { [...document.querySelectorAll('.z-\\[10050\\] button')].find((b) => /allow/i.test(b.textContent))?.click() })
await sleep(200); await dump('after allow2 +200ms')
await sleep(1600); await dump('after allow2 +1800ms')
await page.evaluate(() => { [...document.querySelectorAll('.z-\\[10050\\] button')].find((b) => /allow/i.test(b.textContent))?.click() })
await sleep(200); await dump('after allow3 +200ms')
await sleep(1600); await dump('after allow3 +1800ms')
await sleep(1500); await dump('after allow3 +3300ms')
await browser.close()
