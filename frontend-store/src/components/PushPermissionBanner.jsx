import { useEffect, useRef, useState } from 'react'
import { BellRing, X, Settings } from 'lucide-react'
import toast from 'react-hot-toast'
import { API_BASE_URL } from '../config'
import { useStore } from '../store/useStore'
import { apiFetch } from '../utils/apiFetch'

// Dismissal is session-scoped on purpose: closing the banner stops it nagging
// during the current visit, but it returns on the next visit until the user
// actually grants (or permanently blocks) notification permission.
const DISMISSED_FLAG = 'jdlx_push_banner_dismissed';

/**
 * PushPermissionBanner — shown in the header whenever browser notification
 * permission is NOT granted ('default' or 'denied'). The "Allow" button
 * re-triggers the native permission popup on the user's device; once granted,
 * the subscription is registered with the backend so pushes are delivered.
 */
const PushPermissionBanner = () => {
  const user = useStore((state) => state.user);
  const [permission, setPermission] = useState('checking'); // checking | granted | denied | default | unsupported
  const [configured, setConfigured] = useState(false);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISSED_FLAG) === '1');
  const [submitting, setSubmitting] = useState(false);
  const mountedRef = useRef(true);

  // Read the current permission (and whether push is configured at all).
  const refreshState = async () => {
    try {
      const { getPushPermission, isPushConfigured } = await import('../push');
      setConfigured(isPushConfigured());
      setPermission(getPushPermission());
    } catch {
      setConfigured(false);
      setPermission('unsupported');
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    refreshState();

    // The native permission popup steals focus; when it closes (allow/deny/
    // dismiss) the page regains focus/visibility, so re-check then so the
    // banner appears/disappears immediately without a page reload.
    const onRecheck = () => refreshState();
    window.addEventListener('focus', onRecheck);
    document.addEventListener('visibilitychange', onRecheck);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('focus', onRecheck);
      document.removeEventListener('visibilitychange', onRecheck);
    };
  }, []);

  const show = configured && !dismissed && (permission === 'denied' || permission === 'default');

  const handleAllow = async () => {
    setSubmitting(true);
    try {
      const { subscribeToPush } = await import('../push');
      // subscribeToPush() requests the native permission popup (when the
      // browser allows re-prompting) and creates the push subscription.
      const sub = await subscribeToPush();
      const current = ('Notification' in window) ? Notification.permission : 'unsupported';
      setPermission(current);

      if (sub) {
        // Register the subscription with the backend so pushes are delivered
        // to this user (works immediately when logged in; otherwise the
        // existing subscription is picked up automatically on next login).
        if (user) {
          try {
            await apiFetch('/notifications/register-token', {
              method: 'POST',
              body: JSON.stringify({ subscription: sub, device_type: 'web' })
            });
          } catch (err) {
            console.error('Error registering push subscription:', err);
          }
        }
        toast.success('Notifications enabled 🔔', { duration: 3000 });
      } else if (current === 'denied') {
        // Browsers block re-prompting after a previous "Block" — guide the
        // user to the site-settings toggle instead of a dead button.
        toast(
          () => (
            <span className="flex items-center gap-2">
              <Settings size={16} />
              <span>Notifications are blocked. Allow them from browser site settings.</span>
            </span>
          ),
          { duration: 5000 }
        );
      }
      // current === 'default' → popup was dismissed; keep the banner so the
      // user can try again later.
    } catch (err) {
      console.warn('Push enable failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISSED_FLAG, '1');
    setDismissed(true);
  };

  if (!show) return null;

  return (
    <div
      className="flex items-center gap-2 sm:gap-3 border-b border-primary/20 bg-primary/10 px-3 sm:px-6 py-2 animate-in slide-in-from-top-2 duration-300"
      role="region"
      aria-label="Enable notifications"
    >
      <BellRing className="h-4 w-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 truncate text-[11px] sm:text-xs font-bold text-[var(--color-on-surface)]">
        Turn on notifications for order updates &amp; offers
      </p>
      <button
        onClick={handleAllow}
        disabled={submitting}
        className="shrink-0 rounded-xl bg-primary px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-white shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-60"
      >
        {submitting ? '…' : 'Allow'}
      </button>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss notification banner"
        className="shrink-0 grid h-6 w-6 place-items-center rounded-full text-[var(--color-on-surface-variant)] transition-colors hover:bg-black/5 dark:hover:bg-white/10 active:scale-90"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

export default PushPermissionBanner;
