import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';

/**
 * Hook to manage PWA installation prompt logic.
 * Uses the global store to access the 'beforeinstallprompt' event.
 */
export function usePWAInstall() {
  const installPrompt = useStore((state) => state.pwaInstallPrompt);
  const clearPwaInstallPrompt = useStore((state) => state.clearPwaInstallPrompt);
  
  const [isInstalled, setIsInstalled] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.matchMedia('(display-mode: standalone)').matches;
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
    if (!installPrompt) return;

    try {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      console.log(`User response to install prompt: ${outcome}`);
      
      if (outcome === 'accepted') {
        clearPwaInstallPrompt();
      }
    } catch (err) {
      console.error('Installation failed:', err);
    }
  };

  return { isInstallable, isInstalled, handleInstallClick };
}
