import { useEffect } from 'react';
import { requestForToken, onMessageListener } from '../firebase';
import { API_BASE_URL } from '../config';
import { useStore } from '../store/useStore';
import toast from 'react-hot-toast';

const PushNotificationManager = () => {
  const { token, user } = useStore();

  const handlePushRegistration = async () => {
    try {
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
  };

  useEffect(() => {
    if (token && user) {
      handlePushRegistration();
    }
  }, [token, user]);

  useEffect(() => {
    onMessageListener()
      .then((payload) => {
        console.log('Foreground Message received:', payload);
        toast.success(`${payload.notification.title}: ${payload.notification.body}`, {
          duration: 5000,
          icon: '🔔'
        });
      })
      .catch((err) => console.log('failed: ', err));
  }, []);

  return null; // This component doesn't render anything
};

export default PushNotificationManager;
