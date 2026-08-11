/**
 * AppShell — native-app-like gesture guards for the JDLX storefront.
 *
 * The storefront runs as a standalone PWA. In a browser tab the page can
 * still be pinch-zoomed / double-tap-zoomed, which makes the layout reflow
 * (text and UI sliding sideways). These guards lock gestures so the app
 * behaves like a native app.
 *
 * Layers (belt-and-suspenders):
 *  1. viewport meta  (index.html) — user-scalable=no, maximum-scale=1
 *  2. CSS            (index.css)   — touch-action: manipulation / pan-x pan-y
 *  3. JS             (this file)   — blocks iOS gesture events + multi-touch
 *                                    pinch that some browsers still allow.
 *
 * IMPORTANT: only multi-touch / pinch gestures are suppressed — normal
 * single-finger scroll, tap and the banner swipe handlers are untouched.
 * No business logic is changed.
 */

let _initialized = false

function initAppShellBehavior() {
  if (_initialized) return () => {}
  _initialized = true

  const cleanups = []

  // iOS Safari fires `gesture*` events for pinch zoom. Block them.
  const blockGesture = (e) => {
    if (e.preventDefault) e.preventDefault()
    return false
  }
  ;['gesturestart', 'gesturechange', 'gestureend'].forEach((eventName) => {
    document.addEventListener(eventName, blockGesture, { passive: false })
    cleanups.push(() => document.removeEventListener(eventName, blockGesture))
  })

  // Android Chrome / others: suppress ONLY multi-touch pinch moves. Single
  // finger scroll must keep working, so we check touches.length.
  const blockMultiTouch = (e) => {
    if (e.touches && e.touches.length > 1) {
      e.preventDefault()
    }
  }
  document.addEventListener('touchmove', blockMultiTouch, { passive: false })
  cleanups.push(() => document.removeEventListener('touchmove', blockMultiTouch))

  // iOS: block multi-touch start too (prevents the two-finger pinch even
  // before the move, and the old double-tap-zoom). Single taps unaffected.
  const blockMultiTouchStart = (e) => {
    if (e.touches && e.touches.length > 1) {
      e.preventDefault()
    }
  }
  document.addEventListener('touchstart', blockMultiTouchStart, { passive: false })
  cleanups.push(() => document.removeEventListener('touchstart', blockMultiTouchStart))

  // Also cover the wheel-based Ctrl+zoom on desktop trackpads? No — that is a
  // deliberate accessibility gesture and should stay available on desktop.

  return () => {
    cleanups.forEach((fn) => fn())
    _initialized = false
  }
}

export default initAppShellBehavior
