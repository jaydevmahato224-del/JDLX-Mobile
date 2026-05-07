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
  const [isDismissed, setIsDismissed] = useState(() => localStorage.getItem('pwa_banner_dismissed') === 'true');
  const [config, setConfig] = useState({
    enabled: true,
    title: 'Install JDLX Mobile',
    description: 'Get the full premium experience on your home screen.'
  });

  const isPreview = new URLSearchParams(window.location.search).get('preview_pwa') === '1';
  const shouldShowBanner = (isInstallable || isPreview) && !isInstalled && !isDismissed && config.enabled;

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
          <div className="relative flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 shadow-lg shadow-indigo-500/20">
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
              onClick={isPreview ? () => alert('This is a preview. In a real scenario, this would open the install prompt.') : handleInstallClick}
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
        <div className="h-1 w-full bg-gradient-to-r from-transparent via-indigo-500/30 to-transparent" />
      </div>
    </div>
  );
};

export default PWAInstallBanner;
