import React, { useState, useEffect } from 'react';
import { Smartphone, Check, X } from 'lucide-react';
import useScrollLock from '../hooks/useScrollLock';

export default function PWAInstalledCelebration() {
  const [isOpen, setIsOpen] = useState(
    () => new URLSearchParams(window.location.search).get('preview_celebration') === '1'
  );

  useEffect(() => {
    const handleAppInstalled = () => {
      console.log('🎉 PWAInstalledCelebration: appinstalled event detected!');
      setIsOpen(true);
      
      // Play a subtle success vibration if supported
      if ('vibrate' in navigator) {
        navigator.vibrate([100, 50, 100]);
      }
    };

    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Lock the page behind the celebration so background scrolling never
  // happens while the modal is open (scroll chaining).
  useScrollLock(isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] overflow-y-auto overscroll-contain bg-zinc-950/70 backdrop-blur-md animate-in fade-in duration-300">
      <div className="flex min-h-full items-center justify-center p-4">
      <div className="relative my-auto w-full max-w-sm overflow-hidden rounded-[24px] border border-white/[0.06] bg-gradient-to-b from-[#1c1c1f] to-[#121214] p-8 text-white shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-300">
        
        {/* Soft elegant top glow */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-48 h-48 bg-amber-500/10 rounded-full blur-[80px] pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={() => setIsOpen(false)}
          className="absolute top-5 right-5 p-1.5 rounded-full text-zinc-500 hover:text-zinc-200 bg-white/[0.03] border border-white/[0.05] hover:bg-white/[0.08] transition-all"
          aria-label="Close dialog"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Success Icon & Content */}
        <div className="flex flex-col items-center text-center mt-4">
          <div className="relative mb-6">
            {/* Elegant App Logo with Checkmark badge */}
            <div className="w-16 h-16 rounded-[20px] bg-gradient-to-b from-amber-500/15 to-amber-500/5 border border-amber-500/30 flex items-center justify-center shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]">
              <img 
                src="/logo192.png" 
                alt="JDLX App Logo" 
                className="w-10 h-10 object-contain rounded-xl"
              />
              <div className="absolute -bottom-1 -right-1 w-5.5 h-5.5 rounded-full bg-amber-500 flex items-center justify-center text-zinc-950 shadow-md">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </div>
            </div>
          </div>

          {/* Titles & Messages */}
          <h3 
            className="text-lg font-bold tracking-tight text-white"
            style={{ fontFamily: 'Manrope, sans-serif', color: '#ffffff' }}
          >
            JDLX Mobile Installed
          </h3>
          
          <p 
            className="text-[14px] text-zinc-400 mt-2 font-normal leading-relaxed max-w-[260px]"
            style={{ color: '#a1a1aa' }}
          >
            JDLX Mobile is now installed on your device
          </p>
        </div>

        {/* Action Button */}
        <button
          onClick={() => setIsOpen(false)}
          className="mt-8 w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 rounded-xl font-semibold text-sm active:scale-[0.98] transition-all shadow-[0_4px_20px_rgba(245,158,11,0.15)]"
        >
          Open App
        </button>

      </div>
      </div>
    </div>
  );
}
