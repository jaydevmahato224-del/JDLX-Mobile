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
  const promptUsed = useStore((state) => state.pwaInstallPromptUsed);
  const markPwaInstallPromptUsed = useStore((state) => state.markPwaInstallPromptUsed);
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

    // A captured beforeinstallprompt event can only drive the native prompt
    // ONCE. The banner and the Profile "Download App" button share the same
    // store-level event, so usage is tracked globally: calling prompt() a
    // second time on an already-used event silently no-ops and Chrome's
    // "Installing…" state never resolves. Bail out and let the caller fall
    // back to the step-by-step guide instead of hanging forever.
    if (promptUsed) {
      clearPwaInstallPrompt();
      return false;
    }

    try {
      markPwaInstallPromptUsed();
      installPrompt.prompt();
      // Guard against the prompt never resolving (e.g. installability changed
      // after the event was captured, or the browser swallowed the prompt):
      // timeout and fall back to the guide rather than leaving the user stuck
      // on an infinite "Installing…".
      const { outcome } = await Promise.race([
        installPrompt.userChoice,
        new Promise((resolve) => setTimeout(() => resolve({ outcome: 'timeout' }), 5000)),
      ]);
      console.log(`User response to install prompt: ${outcome}`);
      
      if (outcome === 'accepted') {
        clearPwaInstallPrompt();
        return true;
      }

      // User dismissed the native prompt, or it timed out — it cannot be re-shown.
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
