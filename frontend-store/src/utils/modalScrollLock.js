/**
 * Global modal scroll lock.
 *
 * Jab bhi project me koi bhi full-screen popup/modal/slide-over mount hota hai
 * (fixed inset-0 backdrop wala), background page completely freeze ho jata hai:
 * scroll, touch, wheel, keyboard — background me kuch nahi chalta. Sirf popup
 * ke andar ke scrollable areas chalte hain. Popup unmount/hide hote hi
 * background bilkul waise ka waisa restore ho jata hai (scroll position
 * included).
 *
 * Detection is STRUCTURAL, not per-modal: kisi component me register nahi
 * karna padta — existing aur future dono popups automatically covered hain.
 *
 * What qualifies as a popup:
 *   - element with Tailwind's `fixed` positioning class
 *   - covers >= 85% of viewport width AND height (real viewport overlap)
 *   - actually visible & interactive (pointer-events != none)
 * Tiny fixed things (toasts, floating buttons) and purely decorative layers
 * (pointer-events-none) never trigger the lock.
 *
 * TWO lock layers (belt-and-suspenders — layouts differ across the apps):
 *   1. Body freeze (position:fixed + negative top) — kills the page scroll
 *      path entirely; the only technique that also works on iOS Safari.
 *      Some layouts scroll an INNER container (admin's <main overflow-y-auto>,
 *      embedded scroll areas) where a body freeze alone does nothing.
 *   2. Event guard — while locked, wheel/touchmove/scroll-keys are
 *      preventDefault-ed at the window unless the event originates INSIDE a
 *      detected overlay or inside a floating scrollable (a sidebar/drawer
 *      sitting beside the backdrop, never covered by the overlay itself).
 *      This deterministically freezes every scroll path.
 */

let locked = false
let savedScrollY = 0
let observer = null
let rafPending = false
let currentOverlays = new Set()
let taggedOverlays = new Set()
let floatingScrollables = new Set()

function isModalOverlay(el) {
  const cs = window.getComputedStyle(el)
  if (cs.pointerEvents === 'none') return false // decorative layer
  if (cs.visibility === 'hidden' || cs.display === 'none') return false
  // Class `fixed` can be overridden at breakpoints (e.g. lg:sticky) — the
  // COMPUTED position is what actually applies.
  if (cs.position !== 'fixed') return false
  if (el.getClientRects().length === 0) return false
  // Coverage is measured as ACTUAL OVERLAP with the viewport, not raw size:
  // off-screen drawers (translate-x-full) keep their layout rect after the
  // transform and must never count, while a mid-animation slide-over only
  // locks once it genuinely covers the screen.
  const rect = el.getBoundingClientRect()
  const overlapX = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)
  const overlapY = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)
  return (
    overlapX >= window.innerWidth * 0.85 &&
    overlapY >= window.innerHeight * 0.85
  )
}

function evaluate() {
  rafPending = false
  const next = new Set()
  // Candidate collection via the `fixed` class keeps this cheap — the
  // expensive computed-style checks run only on the handful of overlays.
  document.querySelectorAll('.fixed').forEach((el) => {
    if (isModalOverlay(el)) next.add(el)
  })
  currentOverlays = next
  // Floating scrollables: sidebars/drawers that sit BESIDE a modal backdrop
  // instead of inside it — e.g. the panel sidebars, whose 100%-viewport
  // backdrop qualifies as an overlay while the 288px drawer itself does not.
  // They must stay interactive while the lock is on.
  floatingScrollables = new Set()
  if (next.size > 0) {
    document.querySelectorAll(
      '[class*="overflow-y-auto"], [class*="overflow-auto"], [class*="overflow-y-scroll"], [class*="overflow-scroll"]'
    ).forEach((el) => {
      if (!isScrollableArea(el)) return
      // Only scrollables that float ABOVE every overlay (a sidebar/drawer
      // sitting on top of the backdrop) stay interactive. The page's own
      // scroll containers sit BELOW the backdrop and must stay frozen —
      // otherwise modals would leak background scrolling again.
      if (stacksAboveAllOverlays(el, next)) floatingScrollables.add(el)
    })
  }
  if (next.size > 0) lock()
  else unlock()
}

function isScrollableArea(el) {
  const cs = window.getComputedStyle(el)
  if (!/(auto|scroll)/.test(cs.overflowY)) return false
  // Only actually-scrollable elements (content taller than the box) count —
  // keeps the allowlist tight so the background stays fully frozen.
  return el.scrollHeight > el.clientHeight + 1
}

function stacksAboveAllOverlays(el, overlays) {
  // Highest explicit z-index on the element's own stacking chain.
  let z = 0
  let node = el
  while (node && node !== document.body) {
    const nodeZ = parseInt(window.getComputedStyle(node).zIndex, 10)
    if (!Number.isNaN(nodeZ) && nodeZ > z) z = nodeZ
    node = node.parentElement
  }
  // The element must strictly beat EVERY overlay's z-index; ties and
  // un-numbered overlays resolve conservatively to "frozen" (DOM order
  // decides those, and a modal rendered above the drawer must win).
  for (const ov of overlays) {
    const ovZ = parseInt(window.getComputedStyle(ov).zIndex, 10)
    if (Number.isNaN(ovZ) || ovZ >= z) return false
  }
  return true
}

function lock() {
  if (locked) return
  locked = true
  savedScrollY = window.scrollY || window.pageYOffset || 0
  const body = document.body
  // position:fixed + negative top is the only scroll-freeze that also works
  // on iOS Safari (overflow:hidden alone is ignored there).
  body.style.position = 'fixed'
  body.style.top = `-${savedScrollY}px`
  body.style.left = '0'
  body.style.right = '0'
  body.style.width = '100%'
  body.style.overflow = 'hidden'
  body.style.overscrollBehavior = 'contain'
  // Scroll chaining inside overlays must stop at the overlay — otherwise a
  // wheel at the end of a modal's inner list scrolls the page behind it.
  for (const el of currentOverlays) {
    el.style.overscrollBehavior = 'contain'
    taggedOverlays.add(el)
  }
}

function unlock() {
  if (!locked) return
  locked = false
  const body = document.body
  body.style.position = ''
  body.style.top = ''
  body.style.left = ''
  body.style.right = ''
  body.style.width = ''
  body.style.overflow = ''
  body.style.overscrollBehavior = ''
  for (const el of taggedOverlays) {
    el.style.overscrollBehavior = ''
  }
  taggedOverlays.clear()
  window.scrollTo(0, savedScrollY)
}

function originatesInsideOverlay(e) {
  const target = e.target
  if (!(target instanceof Element)) return false
  for (const el of currentOverlays) {
    if (el.contains(target)) return true
  }
  return false
}

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])

function originatesInsideScrollable(e) {
  const target = e.target
  if (!(target instanceof Element)) return false
  for (const el of floatingScrollables) {
    if (el.contains(target)) return true
  }
  return false
}

function guardWheelAndTouch(e) {
  if (!locked) return
  if (originatesInsideOverlay(e)) return
  // Panel sidebars/drawers floating beside a full-viewport backdrop stay
  // scrollable — only the true background behind them is frozen.
  if (originatesInsideScrollable(e)) return
  // Background interaction while a popup is open — freeze it.
  e.preventDefault()
}

function guardScrollKeys(e) {
  if (!locked || !SCROLL_KEYS.has(e.key)) return
  if (originatesInsideOverlay(e)) return
  if (originatesInsideScrollable(e)) return
  const target = e.target
  if (target instanceof HTMLElement && target.isContentEditable) return
  e.preventDefault()
}

function scheduleEvaluate() {
  if (rafPending) return
  rafPending = true
  requestAnimationFrame(evaluate)
}

export function initGlobalModalScrollLock() {
  if (typeof window === 'undefined' || observer) return
  observer = new MutationObserver(scheduleEvaluate)
  // childList covers mount/unmount (every modal in this codebase renders
  // conditionally); class/style attribute changes cover show/hide toggles.
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style'],
  })
  // Viewport size changes can flip the 85% coverage verdicts.
  window.addEventListener('resize', scheduleEvaluate)
  // Layer-2 event guards. passive:false is required for preventDefault;
  // capture ensures we see events targeted at any element.
  window.addEventListener('wheel', guardWheelAndTouch, { passive: false, capture: true })
  window.addEventListener('touchmove', guardWheelAndTouch, { passive: false, capture: true })
  window.addEventListener('keydown', guardScrollKeys)
  evaluate()
}
