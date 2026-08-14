import { useCallback, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../config';
import { useStore } from '../store/useStore';
import toast from 'react-hot-toast';

// Storage flag so we only auto-prompt the notification permission once per
// browser (never nag on every visit).
const PROMPTED_FLAG = 'jdlx_push_permission_prompted';

const PushNotificationManager = () => {
  const { token, user } = useStore();
  const subscriptionRef = useRef(null);

  // Foreground toasts: the push service worker posts a message to open tabs
  // whenever a push arrives, so we can show the same notification in-app.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event) => {
      if (event.data && event.data.type === 'PUSH_RECEIVED') {
        toast.success(`${event.data.title}: ${event.data.body}`, {
          duration: 5000,
          icon: '🔔'
        });
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  // Ask for notification permission as soon as the app opens (first install).
  // The subscription is created right away; it gets registered with the backend
  // once the user is logged in.
  // NOTE: the localStorage flag is only set INSIDE the timeout callback — React
  // StrictMode (dev) runs effects twice, and setting the flag synchronously
  // would let the first (cancelled) run suppress the real one.
  useEffect(() => {
    let cancelled = false;
    if (!('Notification' in window) || !('PushManager' in window)) return;
    if (localStorage.getItem(PROMPTED_FLAG)) return;

    const timer = setTimeout(async () => {
      try {
        const { subscribeToPush, isPushConfigured } = await import('../push');
        if (!isPushConfigured() || cancelled) return;
        const sub = await subscribeToPush();
        if (sub) subscriptionRef.current = sub;
      } catch (err) {
        console.warn('Auto push prompt failed:', err);
      } finally {
        localStorage.setItem(PROMPTED_FLAG, '1');
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Once logged in, make sure the browser subscription is registered with the
  // backend so pushes can actually be delivered to this user.
  const registerSubscription = useCallback(async () => {
    if (!token || !user) return;
    try {
      const { subscribeToPush, isPushConfigured } = await import('../push');
      if (!isPushConfigured()) return;
      const sub = subscriptionRef.current || (await subscribeToPush());
      if (!sub) return;
      await fetch(`${API_BASE_URL}/notifications/register-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          subscription: sub,
          device_type: 'web'
        })
      });
    } catch (error) {
      console.error('Error registering push subscription:', error);
    }
  }, [token, user]);

  useEffect(() => {
    if (token && user) {
      registerSubscription();
    }
  }, [token, user, registerSubscription]);

  return null; // This component doesn't render anything
};

export default PushNotificationManager;
