import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';

/**
 * Hook to manage PWA installation prompt logic.
 * Uses the global store to access the 'beforeinstallprompt' event.
 *
 * handleInstallClick resolves to:
 *   true  -> the native browser install prompt was shown AND accepted.
 *   false -> no prompt available / user dismissed it / it errored. Callers
 *            should fall back to the step-by-step install guide so the user
 *            is never stuck on a dead "Install" button.
 */
export function usePWAInstall() {
  const installPrompt = useStore((state) => state.pwaInstallPrompt);
  const clearPwaInstallPrompt = useStore((state) => state.clearPwaInstallPrompt);
  
  const [isInstalled, setIsInstalled] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.matchMedia('(display-mode: standalone)').matches || !!(window.navigator && window.navigator.standalone);
  });

  const isInstallable = !!installPrompt;

  useEffect(() => {
    const handleAppInstalled = () => {
      setIsInstalled(true);
      clearPwaInstallPrompt();
      console.log('JDLX App was installed');
    };

    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [clearPwaInstallPrompt]);

  const handleInstallClick = async () => {
    if (!installPrompt) return false;

    try {
      // prompt() must run inside a user gesture and can only be invoked ONCE
      // per captured beforeinstallprompt event. After the user dismisses it or
      // the event is reused, calling prompt() again silently does nothing — so
      // always clear the stale prompt and let the UI fall back to the guide.
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      console.log(`User response to install prompt: ${outcome}`);
      
      if (outcome === 'accepted') {
        clearPwaInstallPrompt();
        return true;
      }

      // User dismissed the native prompt — it cannot be re-shown.
      clearPwaInstallPrompt();
      return false;
    } catch (err) {
      console.error('Installation failed:', err);
      clearPwaInstallPrompt();
      return false;
    }
  };

  return { isInstallable, isInstalled, handleInstallClick };
}
