import { useCallback, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import { useStore } from '../store/useStore';
import toast from 'react-hot-toast';

const PushNotificationManager = () => {
  const { token, user } = useStore();

  const handlePushRegistration = useCallback(async () => {
    try {
      // Firebase (vendor-firebase chunk) is now lazy-loaded: it was previously
      // statically imported, which put ~44 kB into the initial page load even
      // though push notifications are only used once a user logs in.
      const { requestForToken } = await import('../firebase');
      // requestForToken only acts when real Firebase credentials are configured
      // (VITE_FIREBASE_* in .env) — otherwise it no-ops and in-app notifications
      // keep working exactly as before.
      const fcmToken = await requestForToken();
      if (fcmToken) {
        console.log('FCM Token:', fcmToken);
        // Register token with backend
        await fetch(`${API_BASE_URL}/notifications/register-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            token: fcmToken,
            device_type: 'web'
          })
        });
      }
    } catch (error) {
      console.error('Error registering push token:', error);
    }
  }, [token]);

  useEffect(() => {
    if (token && user) {
      handlePushRegistration();
    }
  }, [token, user, handlePushRegistration]);

  useEffect(() => {
    let active = true;
    import('../firebase')
      .then(({ onMessageListener }) => {
        if (!active) return null;
        return onMessageListener();
      })
      .then((payload) => {
        if (!active || !payload) return;
        console.log('Foreground Message received:', payload);
        toast.success(`${payload.notification.title}: ${payload.notification.body}`, {
          duration: 5000,
          icon: '🔔'
        });
      })
      .catch((err) => console.log('failed: ', err));
    return () => {
      active = false;
    };
  }, []);

  return null; // This component doesn't render anything
};

export default PushNotificationManager;
