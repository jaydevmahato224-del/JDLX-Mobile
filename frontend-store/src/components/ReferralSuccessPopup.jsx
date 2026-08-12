import React from 'react';
import { X, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import useScrollLock from '../hooks/useScrollLock';

const CONFETTI_COLORS = ['#f59e0b', '#f43f5e', '#8b5cf6', '#10b981', '#3b82f6', '#fbbf24'];
// Pre-generated confetti specs (deterministic, avoids re-randomizing per render).
const CONFETTI = [
  { left: '6%', delay: '0s', duration: '2.6s', color: CONFETTI_COLORS[0], size: 8, rotate: -20 },
  { left: '18%', delay: '0.4s', duration: '3.1s', color: CONFETTI_COLORS[1], size: 7, rotate: 25 },
  { left: '30%', delay: '0.9s', duration: '2.8s', color: CONFETTI_COLORS[2], size: 9, rotate: -35 },
  { left: '42%', delay: '0.2s', duration: '3.4s', color: CONFETTI_COLORS[3], size: 6, rotate: 15 },
  { left: '55%', delay: '0.7s', duration: '2.9s', color: CONFETTI_COLORS[4], size: 8, rotate: -10 },
  { left: '66%', delay: '1.1s', duration: '3.2s', color: CONFETTI_COLORS[5], size: 7, rotate: 30 },
  { left: '78%', delay: '0.3s', duration: '2.7s', color: CONFETTI_COLORS[0], size: 9, rotate: -25 },
  { left: '90%', delay: '0.6s', duration: '3.0s', color: CONFETTI_COLORS[1], size: 6, rotate: 20 },
  { left: '12%', delay: '1.3s', duration: '3.3s', color: CONFETTI_COLORS[2], size: 7, rotate: -15 },
  { left: '48%', delay: '1.5s', duration: '2.9s', color: CONFETTI_COLORS[3], size: 8, rotate: 10 },
  { left: '72%', delay: '1.8s', duration: '3.1s', color: CONFETTI_COLORS[4], size: 6, rotate: -30 },
  { left: '84%', delay: '0.5s', duration: '2.8s', color: CONFETTI_COLORS[5], size: 7, rotate: 5 },
];

/**
 * ReferralSuccessPopup - a celebratory modal shown the moment a referral code
 * is applied successfully. A cute 2D doll mascot bounces with joy while
 * confetti falls and a ₹10 coin pops in — the instant bonus is credited to
 * both users right away, with the rest following the first-order rules.
 */
export default function ReferralSuccessPopup({ open, onClose, amount = 10 }) {
  useScrollLock(open);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] overflow-y-auto overscroll-contain bg-black/80 backdrop-blur-md animate-in fade-in duration-300"
      role="dialog"
      aria-modal="true"
      aria-label="Referral bonus credited"
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative my-auto w-full max-w-sm overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-b from-[#1a1a2e] via-[#16213e] to-[#0a0a1a] p-8 text-white shadow-[0_32px_80px_-16px_rgba(99,102,241,0.35)] animate-in zoom-in-95 duration-300">
          {/* Confetti — falls behind the card content */}
          {CONFETTI.map((c, i) => (
            <span
              key={i}
              className="pop-confetti"
              style={{
                left: c.left,
                width: c.size,
                height: c.size * 1.6,
                backgroundColor: c.color,
                animationDelay: c.delay,
                animationDuration: c.duration,
                transform: `rotate(${c.rotate}deg)`,
              }}
            />
          ))}

          {/* Soft top glow */}
          <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-indigo-500/20 blur-[80px]" />

          {/* Close */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full border border-white/10 bg-white/5 p-1.5 text-zinc-400 transition-all hover:bg-white/10 hover:text-white"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="relative flex flex-col items-center text-center">
            {/* Cute 2D doll mascot — happy bounce */}
            <div className="pop-doll-wrap relative h-[92px] w-[92px]">
              <svg viewBox="0 0 100 100" className="h-full w-full drop-shadow-[0_8px_16px_rgba(99,102,241,0.4)]" aria-hidden="true">
                {/* Sparkles */}
                <g className="pop-sparkle">
                  <path d="M17 22l2.1 4.8 4.8 2.1-4.8 2.1-2.1 4.8-2.1-4.8-4.8-2.1 4.8-2.1z" fill="#fbbf24" />
                </g>
                <g className="pop-sparkle pop-sparkle-2">
                  <path d="M84 30l1.8 4.2 4.2 1.8-4.2 1.8-1.8 4.2-1.8-4.2-4.2-1.8 4.2-1.8z" fill="#a5b4fc" />
                </g>

                {/* Glow */}
                <circle cx="50" cy="54" r="31" fill="#6366f1" opacity="0.15" />

                {/* Antenna + heart tip */}
                <line x1="50" y1="18" x2="50" y2="30" stroke="#818cf8" strokeWidth="3" strokeLinecap="round" />
                <circle className="pop-heart" cx="50" cy="14" r="4.2" fill="#f43f5e" />

                {/* Feet */}
                <ellipse cx="42" cy="86" rx="7" ry="3.5" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />
                <ellipse cx="58" cy="86" rx="7" ry="3.5" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />

                {/* Ears */}
                <circle cx="28.5" cy="37" r="5.5" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />
                <circle cx="71.5" cy="37" r="5.5" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />

                {/* Head */}
                <circle cx="50" cy="38" r="20" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />

                {/* Eyes (happy closed ^ ^) */}
                <path d="M40 37q2.5-3 5 0" stroke="#0f172a" strokeWidth="2.4" fill="none" strokeLinecap="round" />
                <path d="M55 37q2.5-3 5 0" stroke="#0f172a" strokeWidth="2.4" fill="none" strokeLinecap="round" />

                {/* Rosy cheeks */}
                <circle cx="33.5" cy="44" r="3.2" fill="#fda4af" opacity="0.8" />
                <circle cx="66.5" cy="44" r="3.2" fill="#fda4af" opacity="0.8" />

                {/* Big happy smile */}
                <path d="M43 45 Q50 53 57 45" stroke="#0f172a" strokeWidth="2.4" fill="none" strokeLinecap="round" />

                {/* Both arms up — celebration pose */}
                <g className="pop-arms">
                  <path d="M27 50q-7-6-3-13" stroke="#ffffff" strokeWidth="6" fill="none" strokeLinecap="round" />
                  <circle cx="22" cy="36" r="5.5" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />
                  <path d="M73 50q7-6 3-13" stroke="#ffffff" strokeWidth="6" fill="none" strokeLinecap="round" />
                  <circle cx="78" cy="36" r="5.5" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />
                </g>
              </svg>

              {/* ₹ coin popping above the doll */}
              <div className="pop-coin absolute -right-1 -top-2 flex h-11 w-11 items-center justify-center rounded-full border-2 border-amber-300 bg-gradient-to-b from-amber-400 to-amber-500 text-[13px] font-black text-amber-950 shadow-[0_6px_16px_rgba(245,158,11,0.5)]">
                ₹{amount}
              </div>
            </div>

            <h3 className="mt-4 text-xl font-black tracking-tight text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
              Bonus Credited! 🎉
            </h3>
            <p className="mt-1 text-[13px] font-bold text-zinc-400">
              <span className="text-amber-400">₹{amount}</span> instantly added to your wallet
            </p>
            <p className="mt-3 max-w-[280px] text-[12px] font-medium leading-relaxed text-zinc-500">
              Your friend got ₹{amount} too! Earn <span className="text-indigo-300">₹20 more</span> after your first
              order of ₹199+ — and they get ₹40 after theirs.
            </p>

            <div className="mt-6 flex w-full flex-col gap-2.5">
              <Link
                to="/profile/wallet"
                onClick={onClose}
                className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-500 py-3 text-xs font-black uppercase tracking-wider text-white transition-all hover:from-indigo-400 hover:to-violet-400 active:scale-[0.97]"
              >
                <Wallet className="h-4 w-4" />
                Check My Wallet
              </Link>
              <button
                onClick={onClose}
                className="rounded-2xl border border-white/10 bg-white/5 py-3 text-xs font-black uppercase tracking-wider text-zinc-300 transition-all hover:bg-white/10 active:scale-[0.97]"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
