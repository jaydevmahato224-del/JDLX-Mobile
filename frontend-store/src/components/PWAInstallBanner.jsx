import toast from "react-hot-toast"
import React, { useState, useEffect } from 'react';
import { Download, X, Smartphone, Zap } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { API_BASE_URL } from '../config';

/**
 * PWAInstallBanner - A premium glassmorphism banner to prompt app installation.
 * Shows up only when the app is 'installable' and not yet installed.
 */
const PWAInstallBanner = () => {
  const { isInstallable, isInstalled, handleInstallClick } = usePWAInstall();
  const [isVisible, setIsVisible] = useState(false);
  const [showPwaGuide, setShowPwaGuide] = useState(false);
  const [isDismissed, setIsDismissed] = useState(() => localStorage.getItem('pwa_banner_dismissed') === 'true');
  const [config, setConfig] = useState({
    enabled: true,
    title: 'Install JDLX Mobile',
    description: 'Get the full premium experience on your home screen.'
  });

  const isPreview = new URLSearchParams(window.location.search).get('preview_pwa') === '1';
  // Show banner on all devices where the app is not installed, so older devices and iOS also get PWA benefits
  const shouldShowBanner = !isInstalled && !isDismissed && config.enabled;

  const handleInstallClickWithFallback = async () => {
    if (isInstallable) {
      await handleInstallClick();
    } else {
      setShowPwaGuide(true);
    }
  };

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
    if (shouldShowBanner && !isVisible) {
      const timer = setTimeout(() => setIsVisible(true), 3000);
      return () => clearTimeout(timer);
    }
  }, [isVisible, shouldShowBanner]);

  const handleDismiss = () => {
    setIsVisible(false);
    // Optional: Save dismissal in localStorage to avoid showing it too often
    localStorage.setItem('pwa_banner_dismissed', 'true');
    setIsDismissed(true);
  };

  if (!shouldShowBanner || !isVisible) return null;

  return (
    <div className="fixed bottom-24 left-4 right-4 z-50 animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div className="mx-auto max-w-lg overflow-hidden rounded-[32px] border-4 border-white bg-white p-1 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.15)] ring-1 ring-slate-200/50">
        <div className="flex items-center gap-4 p-4 bg-gradient-to-br from-white to-slate-50/50">
          {/* App Icon Glow */}
          <div className="relative flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-600 to-violet-700 shadow-lg shadow-primary-500/20">
            <Smartphone className="text-white" size={28} />
            <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[10px] font-black text-amber-950 shadow-sm">
              <Zap size={10} fill="currentColor" />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1">
            <h3 className="text-[16px] font-black tracking-tight text-slate-900">
              {config.title}
            </h3>
            <p className="mt-0.5 text-[13px] font-bold leading-tight text-slate-600">
              {config.description}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <button
              onClick={isPreview ? () => toast.error('This is a preview. In a real scenario, this would open the install prompt.') : handleInstallClickWithFallback}
              className="flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-2.5 text-xs font-black text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-800 active:scale-95"
            >
              <Download size={14} />
              Install
            </button>
            <button
              onClick={handleDismiss}
              className="flex items-center justify-center gap-1 text-[11px] font-black uppercase tracking-wider text-slate-400 hover:text-primary transition-colors"
            >
              <X size={12} />
              Later
            </button>
          </div>
        </div>
        
        {/* Subtle bottom accent line */}
        <div className="h-1 w-full bg-gradient-to-r from-transparent via-primary-500/30 to-transparent" />
      </div>

      {/* Premium PWA Guide Modal inside Banner */}
      {showPwaGuide && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-300">
          <div className="relative w-full max-w-md overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-b from-[#16161a] to-[#0a0a0c] p-6 text-white shadow-2xl animate-in zoom-in-95 duration-300">
            {/* Close button */}
            <button 
              onClick={() => setShowPwaGuide(false)}
              className="absolute top-5 right-5 p-2 rounded-full bg-white/5 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex flex-col items-center text-center mt-4">
              <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center text-primary shadow-lg shadow-primary/10 border border-primary/20 animate-bounce">
                <Download className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-black mt-4 tracking-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>Download JDLX Mobile</h3>
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

            {/* Note about HTTPS/development */}
            <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/10 text-amber-400 text-[10px] font-bold leading-normal">
              ⚠️ Note: Secure connection (HTTPS or localhost) is strictly required by browser policies for PWA installation. If you are testing via local IP address, please access using localhost or standard domain.
            </div>

            <button
              onClick={() => setShowPwaGuide(false)}
              className="mt-6 w-full py-3.5 bg-slate-100 text-slate-900 rounded-2xl hover:bg-white active:scale-95 transition-all font-black text-xs tracking-wider uppercase"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PWAInstallBanner;
