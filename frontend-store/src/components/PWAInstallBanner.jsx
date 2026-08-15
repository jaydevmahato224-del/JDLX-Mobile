import toast from "react-hot-toast"
import React, { useCallback, useState, useEffect, useRef } from 'react';
import { Download, X, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import useScrollLock from '../hooks/useScrollLock';
import { API_BASE_URL } from '../config';

/**
 * PWAInstallBanner - A bottom-left floating card inviting the user to install
 * the app. A cute animated 2D doll mascot waves at first-time visitors to
 * nudge them toward installing.
 *
 * UX: while the page scrolls, the card jelly-hides into the LEFT edge of the
 * screen (like it slips behind the wall) and jelly-bounces back in as soon as
 * scrolling stops — so users never need a close (X) button. The banner quietly
 * retires itself after a few appearances without an install.
 */
const PWAInstallBanner = () => {
  const { isInstallable, isInstalled, handleInstallClick } = usePWAInstall();
  const [isVisible, setIsVisible] = useState(false);
  const [showPwaGuide, setShowPwaGuide] = useState(false);
  const [isDismissed, setIsDismissed] = useState(() => localStorage.getItem('pwa_banner_dismissed') === 'true');
  // Hidden while the user is actively scrolling — returns (jelly) on idle.
  const [isScrollHidden, setIsScrollHidden] = useState(false);
  const [config, setConfig] = useState({
    enabled: true,
    title: 'Install JDLX Mobile',
    description: 'Get the full premium experience on your home screen.'
  });

  const isPreview = new URLSearchParams(window.location.search).get('preview_pwa') === '1';
  // Show on all devices where the app is not installed, so older devices and
  // iOS also get PWA benefits.
  const shouldShowBanner = !isInstalled && !isDismissed && config.enabled;

  const lastScrollYRef = useRef(typeof window !== 'undefined' ? window.scrollY : 0);
  const scrollIdleTimerRef = useRef(null);
  const guidePointerStartedOnBackdrop = useRef(false);

  const handleInstallClickWithFallback = async () => {
    if (isInstallable) {
      const usedNativePrompt = await handleInstallClick();
      // Prompt was dismissed / already used / errored → show the manual guide
      // instead of a dead "Install" button.
      if (!usedNativePrompt) {
        setShowPwaGuide(true);
      }
    } else {
      setShowPwaGuide(true);
    }
  };

  // Dismissal persistence — kept so the banner retires itself quietly after a
  // few no-install appearances instead of nagging forever.
  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    localStorage.setItem('pwa_banner_dismissed', 'true');
    setIsDismissed(true);
  }, []);

  // Lock the page behind the guide modal so scrolling inside the guide never
  // scrolls the background app (scroll chaining).
  useScrollLock(showPwaGuide);

  useEffect(() => {
    fetch(`${API_BASE_URL}/settings`)
      .then(res => res.json())
      .then(json => {
        if (json?.data) {
          setConfig({
            enabled: json.data.pwa_install_prompt_enabled !== 'false',
            title: json.data.pwa_banner_title || 'Install JDLX Mobile',
            description: json.data.pwa_banner_description || 'Get the full premium experience on your home screen.'
          });
        }
      })
      .catch(err => console.error('Failed to load PWA banner config:', err));
  }, []);

  useEffect(() => {
    if (!shouldShowBanner || isVisible) return;
    const timer = setTimeout(() => {
      // Quiet auto-dismiss after a few no-install appearances (dismissal logic
      // preserved — no UI close button, so the banner retires on its own).
      const appearances = Number(localStorage.getItem('pwa_banner_appearances') || 0) + 1;
      localStorage.setItem('pwa_banner_appearances', String(appearances));
      if (appearances >= 5) {
        handleDismiss();
      } else {
        setIsVisible(true);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [isVisible, shouldShowBanner, handleDismiss]);

  // Auto-hide while scrolling (jelly into the left wall) — jelly back in
  // shortly after scrolling stops. Always visible near the top of the page.
  useEffect(() => {
    if (!shouldShowBanner) return;

    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastScrollYRef.current;
      lastScrollYRef.current = y;

      if (Math.abs(delta) < 6) return;

      if (y < 100) {
        setIsScrollHidden(false);
        if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
        return;
      }

      // Hide while actively scrolling (any direction)…
      setIsScrollHidden(true);

      // …and jelly back in once the scroll settles.
      if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
      scrollIdleTimerRef.current = setTimeout(() => setIsScrollHidden(false), 350);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
    };
  }, [shouldShowBanner]);

  return (
    <>
      {shouldShowBanner && isVisible && (
        <div
          className={`pwa-install-banner ${isScrollHidden ? 'is-hiding' : 'is-showing'}`}
          role="region"
          aria-label="Install JDLX Mobile"
        >
          {/* Animated wrapper — transform/opacity only (GPU composited). */}
          <div className="pwa-install-card">
            {/* Glass visuals live on an inner layer so backdrop-filter never
                sits on the animated element. */}
            <div className="overflow-hidden rounded-[28px] border border-[var(--color-surface-high)] bg-[var(--color-surface-card)]/90 backdrop-blur-xl shadow-[0_24px_48px_-16px_rgba(0,0,0,0.18)] ring-1 ring-[var(--color-surface-high)]/40">
              <div className="flex items-center gap-2.5 p-2.5 pl-3 pr-2.5">
                {/* Cute animated 2D doll mascot */}
                <div className="doll-wrap relative h-[62px] w-[62px] shrink-0">
                  <svg viewBox="0 0 100 100" className="h-full w-full drop-shadow-md" aria-hidden="true">
                    {/* Sparkles */}
                    <g className="doll-sparkle">
                      <path d="M17 22l2.1 4.8 4.8 2.1-4.8 2.1-2.1 4.8-2.1-4.8-4.8-2.1 4.8-2.1z" fill="#f59e0b" />
                    </g>
                    <g className="doll-sparkle doll-sparkle-2">
                      <path d="M84 30l1.8 4.2 4.2 1.8-4.2 1.8-1.8 4.2-1.8-4.2-4.2-1.8 4.2-1.8z" fill="#fbbf24" />
                    </g>

                    {/* Soft warm glow behind the doll */}
                    <circle cx="50" cy="54" r="31" fill="#f59e0b" opacity="0.12" />

                    {/* Antenna + tip heart */}
                    <line x1="50" y1="18" x2="50" y2="30" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" />
                    <circle className="doll-heart" cx="50" cy="14" r="4.2" fill="#f59e0b" />

                    {/* Feet */}
                    <ellipse cx="42" cy="86" rx="7" ry="3.5" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />
                    <ellipse cx="58" cy="86" rx="7" ry="3.5" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />

                    {/* Ears (drawn behind the head) */}
                    <circle cx="28.5" cy="37" r="5.5" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />
                    <circle cx="71.5" cy="37" r="5.5" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />

                    {/* Head */}
                    <circle cx="50" cy="38" r="20" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />

                    {/* Eyes (blink together) */}
                    <g className="doll-eye">
                      <circle cx="42.5" cy="37" r="4.2" fill="#0f172a" />
                      <circle cx="42.5" cy="35.4" r="1.3" fill="#ffffff" />
                      <circle cx="57.5" cy="37" r="4.2" fill="#0f172a" />
                      <circle cx="57.5" cy="35.4" r="1.3" fill="#ffffff" />
                    </g>

                    {/* Rosy cheeks */}
                    <circle cx="34.5" cy="44" r="3.2" fill="#fda4af" opacity="0.75" />
                    <circle cx="65.5" cy="44" r="3.2" fill="#fda4af" opacity="0.75" />

                    {/* Smile */}
                    <path d="M43.5 44.5 Q50 50 56.5 44.5" stroke="#0f172a" strokeWidth="2.4" fill="none" strokeLinecap="round" />

                    {/* Waving hand */}
                    <g className="doll-wave-hand">
                      <path d="M64 54q8.5-2 6.5-10" stroke="#ffffff" strokeWidth="6" fill="none" strokeLinecap="round" />
                      <circle cx="72.5" cy="44" r="5.5" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />
                    </g>

                    {/* Chest heart */}
                    <path
                      className="doll-heart"
                      d="M50 63.5c-1.5-2.4-5.4-2.2-5.4.4 0 2.2 2.5 3.7 5.4 5.4 2.9-1.7 5.4-3.2 5.4-5.4 0-2.6-3.9-2.8-5.4-.4z"
                      fill="#f43f5e"
                    />
                  </svg>
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[14px] font-black tracking-tight text-[var(--color-on-surface)]">
                    {config.title}
                  </h3>
                  <p className="mt-0.5 line-clamp-2 text-[11.5px] font-bold leading-snug text-[var(--color-on-surface-variant)]">
                    {config.description}
                  </p>
                </div>

                {/* Install CTA */}
                <button
                  onClick={isPreview ? () => toast.error('This is a preview. In a real scenario, this would open the install prompt.') : handleInstallClickWithFallback}
                  className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-[var(--color-on-surface)] px-3.5 py-2.5 text-[11px] font-black uppercase tracking-wide text-[var(--color-surface-card)] shadow-lg shadow-black/20 transition-all hover:opacity-90 active:scale-95"
                >
                  <Download size={14} />
                  Install
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Premium PWA Guide Modal - rendered outside the banner for proper z-index and positioning */}
      {showPwaGuide && (
        <div
          className="fixed inset-0 z-[999] overflow-y-auto overscroll-contain bg-black/85 backdrop-blur-md animate-in fade-in duration-300"
          onPointerDown={(e) => { guidePointerStartedOnBackdrop.current = e.target === e.currentTarget; }}
          onClick={() => { if (guidePointerStartedOnBackdrop.current) setShowPwaGuide(false); }}
          role="dialog"
          aria-modal="true"
          aria-label="How to install JDLX Mobile"
        >
          <div className="flex min-h-full items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
            <div className="relative my-auto w-full max-w-md overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-b from-[#16161a] to-[#0a0a0c] p-6 text-white shadow-2xl animate-in zoom-in-95 duration-300">
              {/* Close button */}
              <button
                onClick={() => setShowPwaGuide(false)}
                className="absolute top-5 right-5 p-2 rounded-full bg-white/5 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex flex-col items-center text-center mt-4">
                <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center shadow-lg border border-slate-100/10 animate-bounce p-3">
                  <img src="/logo192.png" alt="JDLX Logo" className="w-full h-full object-contain" />
                </div>
                <h3 className="text-xl font-black mt-4 tracking-tight text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>Download JDLX Mobile</h3>
                <p className="text-[13px] text-slate-400 mt-2 font-medium leading-relaxed">
                  Install the digital concierge app on your device screen for full performance, instant checkout, and order tracking.
                </p>
              </div>

              {/* Instructions */}
              <div className="mt-6 space-y-4">
                {/* Android/Chrome */}
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                  <h4 className="text-[12px] font-black uppercase tracking-wider text-primary flex items-center gap-2">
                    <Smartphone className="w-4 h-4" /> Android & Windows (Chrome/Edge)
                  </h4>
                  <ol className="list-decimal pl-4 mt-2 text-[12px] font-bold text-slate-300 space-y-1">
                    <li>Tap the <strong>three dots (⋮)</strong> in Chrome/Edge top-right.</li>
                    <li>Select <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>.</li>
                    <li>Confirm the prompt. JDLX is now installed!</li>
                  </ol>
                </div>

                {/* iOS/Safari */}
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                  <h4 className="text-[12px] font-black uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                    📲 iPhone & iPad (Safari Only)
                  </h4>
                  <ol className="list-decimal pl-4 mt-2 text-[12px] font-bold text-slate-300 space-y-1">
                    <li>Tap the <strong>Share</strong> button (box with up arrow) in Safari.</li>
                    <li>Scroll down and tap <strong>"Add to Home Screen"</strong>.</li>
                    <li>Tap <strong>"Add"</strong> in the top right. JDLX is ready!</li>
                  </ol>
                </div>
              </div>

              {/* Note about HTTPS */}
              <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/10 text-amber-400 text-[10px] font-bold leading-normal">
                ⚠️ Note: Secure connection (HTTPS) is strictly required by browser policies for PWA installation. Please access using your standard domain (jdlxmobile.in) for the best experience.
              </div>

              <button
                onClick={() => setShowPwaGuide(false)}
                className="mt-6 w-full py-3.5 bg-slate-100 text-slate-900 rounded-2xl hover:bg-white active:scale-95 transition-all font-black text-xs tracking-wider uppercase"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PWAInstallBanner;
