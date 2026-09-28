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
 *      detected overlay. This deterministically freezes every scroll path.
 */

let locked = false
let savedScrollY = 0
let observer = null
let rafPending = false
let currentOverlays = new Set()
let taggedOverlays = new Set()

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
  if (next.size > 0) lock()
  else unlock()
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

function guardWheelAndTouch(e) {
  if (!locked) return
  if (originatesInsideOverlay(e)) return
  // Background interaction while a popup is open — freeze it.
  e.preventDefault()
}

function guardScrollKeys(e) {
  if (!locked || !SCROLL_KEYS.has(e.key)) return
  if (originatesInsideOverlay(e)) return
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
