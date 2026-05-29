import { initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

// Your web app's Firebase configuration
// Replace with your project's actual config
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const isConfigured = firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("YOUR_");
const messaging = (typeof window !== 'undefined' && isConfigured) ? getMessaging(app) : null;

/**
 * Converts a base64 string to a Uint8Array.
 * Necessary for VAPID key conversion in some browser environments.
 */
function urlBase64ToUint8Array(base64String) {
  if (!base64String || base64String.includes('YOUR_')) return null;
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export const requestForToken = async () => {
  if (!messaging) return null;
  
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const vapidKey = 'YOUR_VAPID_KEY'; // Replace with your Public VAPID Key from Firebase Console
      const convertedVapidKey = urlBase64ToUint8Array(vapidKey);
      
      const currentToken = await getToken(messaging, {
        vapidKey: convertedVapidKey || vapidKey 
      });
      if (currentToken) {
        return currentToken;
      } else {
        console.log('No registration token available. Request permission to generate one.');
      }
    }
  } catch (err) {
    console.log('An error occurred while retrieving token. ', err);
  }
  return null;
};

export const onMessageListener = () =>
  new Promise((resolve) => {
    if (!messaging) return;
    onMessage(messaging, (payload) => {
      resolve(payload);
    });
  });

export default app;
