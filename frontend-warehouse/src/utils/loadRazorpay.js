/**
 * Lazy-loads the Razorpay checkout SDK.
 *
 * The SDK was previously loaded as a render-blocking <script> in index.html on
 * EVERY store page — even though it's only needed during payment. This helper
 * injects the script on demand (first payment attempt) and caches the promise
 * so subsequent calls are instant. No UI or checkout behavior changes: the SDK
 * is guaranteed to be loaded before `new window.Razorpay(...)` runs.
 */
let razorpayPromise = null;

export function loadRazorpay() {
  if (typeof window !== 'undefined' && window.Razorpay) {
    return Promise.resolve(window.Razorpay);
  }

  if (!razorpayPromise) {
    razorpayPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => resolve(window.Razorpay);
      script.onerror = () => {
        razorpayPromise = null; // allow retry on next attempt
        reject(new Error('Failed to load payment gateway. Please check your connection and try again.'));
      };
      document.head.appendChild(script);
    });
  }

  return razorpayPromise;
}

export default loadRazorpay;
