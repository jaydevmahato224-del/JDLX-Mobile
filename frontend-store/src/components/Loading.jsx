/**
 * Loading.jsx — the single smart loading system for the storefront.
 *
 * One visual family everywhere: the brand JD mark wrapped in an amber arc
 * (same design language as LoadingScreen) with an optional status label.
 *
 *   <PageLoader label="..." />     Full-page data loads (profile, wallet,
 *                                  lists) — vertically centered, steady.
 *   <InlineLoader label="..." />   Small inline status (dropdowns, panels).
 *   <OrderListSkeleton />          My Orders skeleton that mirrors the real
 *                                  order-card layout so the page never jumps.
 *
 * Deliberately simple: one spinner style instead of the previous mix of
 * border-spinners, icon-spins and pulsing texts — fewer moving parts, feels
 * faster, and reads as one professional system.
 */

const JD_MARK_SIZE = 46;
const ARC_SIZE = 64;

function JDLoaderArc({ label, compact = false, className = '' }) {
    const arcSize = compact ? 26 : ARC_SIZE;
    const markSize = compact ? 18 : JD_MARK_SIZE;
    return (
        <div className={`flex ${compact ? 'flex-row items-center gap-2.5' : 'flex-col items-center gap-4'} ${className}`}>
            <div
                className="relative flex-shrink-0 flex items-center justify-center animate-spin"
                style={{ width: arcSize, height: arcSize }}
                role="status"
                aria-live="polite"
                aria-busy="true"
            >
                {/* Spinning arc */}
                <div
                    className="absolute inset-0 rounded-full border-transparent"
                    style={{
                        borderTop: '3px solid #F5A623',
                        borderRight: compact ? '3px solid rgba(245,166,35,0.25)' : '3px solid #F5A623',
                    }}
                />
                {/* JD core mark (hidden when compact — arc alone reads cleaner inline) */}
                {!compact && (
                    <div
                        className="flex items-center justify-center rounded-[12px] shadow-lg"
                        style={{
                            width: markSize,
                            height: markSize,
                            background: 'linear-gradient(135deg, #1B2341 0%, #2A345E 100%)',
                        }}
                    >
                        <span
                            className="font-black text-[10px] tracking-wider"
                            style={{ color: '#F5A623', fontFamily: 'system-ui, sans-serif' }}
                        >
                            JD
                        </span>
                    </div>
                )}
            </div>
            {label && (
                <p
                    className={
                        compact
                            ? 'text-[11px] font-black uppercase tracking-widest text-[var(--color-on-surface-variant)]'
                            : 'text-[10px] font-black uppercase tracking-[0.2em] text-slate-400'
                    }
                >
                    {label}
                </p>
            )}
        </div>
    );
}

/** Full-page data-load placeholder. */
export function PageLoader({ label = 'Loading', className = '' }) {
    return (
        <div className={`w-full py-16 flex flex-col items-center justify-center ${className}`}>
            <JDLoaderArc label={label} />
        </div>
    );
}

/** Small inline status for dropdowns, panels and sections. */
export function InlineLoader({ label = 'Loading', className = '' }) {
    return <JDLoaderArc label={label} compact className={className} />;
}

/**
 * My Orders skeleton — mirrors the real order-card layout so the page
 * doesn't jump when orders arrive. Top padding keeps this block clear of
 * the floating back button, so the two never overlap.
 */
export function OrderListSkeleton() {
    return (
        <div className="pt-14 md:pt-16">
            <div className="h-7 w-36 rounded-lg bg-gray-100 animate-pulse mb-4" />
            <div className="flex flex-col gap-4">
                {[0, 1, 2].map((i) => (
                    <div key={i} className="glass-card p-4 flex flex-col gap-3 animate-pulse">
                        <div className="flex justify-between items-start">
                            <div className="space-y-2">
                                <div className="h-3 w-24 rounded bg-gray-100" />
                                <div className="h-2.5 w-32 rounded bg-gray-50" />
                                <div className="h-4 w-16 rounded bg-gray-100" />
                            </div>
                            <div className="h-6 w-20 rounded-full bg-gray-100" />
                        </div>
                        <div className="flex items-center justify-between border-t border-gray-50 pt-3">
                            <div className="h-2.5 w-40 rounded bg-gray-50" />
                            <div className="h-3 w-16 rounded bg-gray-100" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default PageLoader;
