/**
 * FullscreenLoader — the warehouse panel's single, consistent loading UI.
 *
 * Replaces the scattered in-page spinners ("flex ... min-h-[400px]" blocks)
 * with one overlay that:
 *   1. centers the circular loader in the middle of the viewport,
 *   2. blurs + dims whatever page is behind it,
 *   3. swallows ALL background interaction while visible — scroll, touch,
 *      wheel, and clicks can't reach the page underneath (no more
 *      "loading hote hote scroll chal jana").
 *
 * Non-interactive by design: pointer-events on, the overlay itself absorbs
 * every gesture. Role/permission checks and business logic upstream are
 * untouched — this is purely the loading visual + input lock.
 */

export default function FullscreenLoader({ message = 'Loading...', icon: Icon }) {
    return (
        <div
            className="fixed inset-0 z-[90] flex items-center justify-center"
            role="status"
            aria-live="polite"
            aria-busy="true"
            aria-label={message}
            onWheel={(e) => e.preventDefault()}
            onTouchMove={(e) => e.preventDefault()}
            // Interaction lock: every pointer/key event that lands on the
            // overlay is absorbed so nothing behind it can react.
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={(e) => e.preventDefault()}
            onKeyDown={(e) => e.preventDefault()}
        >
            {/* Blurred page backdrop — renders over the page content behind
                this loader, at a z-level below modals (z-[100]+) but above
                every page element. */}
            <div className="absolute inset-0 bg-[#020617]/60 backdrop-blur-md" />

            {/* Centered circular loader */}
            <div className="relative z-10 flex flex-col items-center gap-4 pointer-events-none select-none">
                <div className="relative h-16 w-16">
                    {/* Outer spinning arc (amber) */}
                    <div className="absolute inset-0 rounded-full border-4 border-amber-400/15 border-t-amber-400 animate-spin" />
                    {/* Inner counter-rotating arc (white) for depth */}
                    <div className="absolute inset-2 rounded-full border-3 border-white/10 border-b-white/70 animate-spin [animation-duration:1.4s] [animation-direction:reverse]" />
                    {Icon && (
                        <div className="absolute inset-0 flex items-center justify-center text-amber-400">
                            <Icon size={20} />
                        </div>
                    )}
                </div>
                {message && (
                    <p className="text-sm font-bold text-slate-300 tracking-wide animate-pulse">{message}</p>
                )}
            </div>
        </div>
    )
}
