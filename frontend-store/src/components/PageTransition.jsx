import { useLocation } from 'react-router-dom'
import { useLayoutEffect, useRef } from 'react'

/**
 * Global page-change animation for the storefront.
 *
 * HOW IT WORKS (and why it's safe):
 * - Keyed on `location.pathname` ONLY (search params excluded), so navigating
 *   /checkout?step=2 → /checkout?step=3 or ticking filter checkboxes never
 *   re-runs the entrance animation — the page content itself keeps its state
 *   and the flow feels continuous.
 * - The key change remounts the subtree for a new page, which is exactly what
 *   <Routes> does anyway on navigation, so there is no behavioral difference —
 *   only the enter animation is added on top.
 * - Animation is opacity-only (no transform). Transform on an ancestor creates
 *   a containing block that silently breaks `position: fixed` children (sticky
 *   mobile bars, modals, the map picker would anchor to the wrapper instead of
 *   the viewport). Opacity is composited on the GPU and fixes nothing.
 * - No exit animation / no AnimatePresence: React Router swaps pages instantly
 *   by design. Any "keep old page mounted while new fades in" approach would
 *   double-mount pages (double fetches, double toasts, broken scroll anchors)
 *   — too risky for checkout/payments, so it's deliberately avoided.
 * - The running animation is force-restarted on remount so rapid navigation
 *   (back/forward spam) always replays cleanly instead of getting stuck.
 */
export default function PageTransition({ children }) {
  const location = useLocation()
  const ref = useRef(null)
  const firstRun = useRef(true)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (firstRun.current) {
      // First mount (initial load): the page is already visible — don't fade
      // the whole app in from black on every refresh.
      firstRun.current = false
      return
    }
    // Restart the animation deterministically on every page change.
    el.classList.remove('page-enter')
    // Force a reflow so removing + re-adding the class reliably replays it.
    void el.offsetWidth
    el.classList.add('page-enter')
  }, [location.pathname])

  return (
    <div ref={ref} className="page-transition-root">
      {children}
    </div>
  )
}
