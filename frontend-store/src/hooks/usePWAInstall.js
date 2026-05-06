import { useState, useEffect } from 'react';

/**
 * Hook to manage PWA installation prompt logic.
 * Listens for 'beforeinstallprompt' and provides status/trigger.
 */
export function usePWAInstall() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.matchMedia('(display-mode: standalone)').matches;
  });

  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setInstallPrompt(null);
      console.log('JDLX App was installed');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) return;

    installPrompt.prompt();

    const { outcome } = await installPrompt.userChoice;
    console.log(`User response to install prompt: ${outcome}`);

    setInstallPrompt(null);
    setIsInstallable(false);
  };

  return { isInstallable, isInstalled, handleInstallClick };
}
