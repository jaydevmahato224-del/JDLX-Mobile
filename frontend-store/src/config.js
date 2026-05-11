// API Configuration
function getDefaultApiBaseUrl() {
  if (typeof window === 'undefined') {
    return 'http://localhost:5000/api';
  }

  const hostname = window.location.hostname;
  const userAgent = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
  const isAndroid = /Android/i.test(userAgent);

  // Android emulator: `localhost` points to the emulator, not your host machine.
  const resolvedHost =
    isAndroid && (hostname === 'localhost' || hostname === '127.0.0.1')
      ? '10.0.2.2'
      : hostname;

  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  
  // If we are on the main domain, we should not default to port 5000 
  // unless we are explicitly in a development environment.
  if (hostname === 'jdlxmobile.in' || hostname === 'www.jdlxmobile.in' || hostname.includes('vercel.app')) {
    // Return a placeholder or the most likely backend URL if known
    // For now, we'll return the origin without 5000 to avoid obvious errors,
    // but the user SHOULD set VITE_API_URL.
    return `${protocol}//${hostname}/api`; 
  }

  return `${protocol}//${resolvedHost}:5000/api`;
}

const PROD_BACKEND_URL = "https://jdlx-mobile.onrender.com/api"; // Your Actual Render URL

export const API_BASE_URL = import.meta.env.VITE_API_URL || 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? getDefaultApiBaseUrl() 
    : PROD_BACKEND_URL);

export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

export function resolveMediaUrl(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  if (/^(https?:|data:|blob:)/i.test(value)) {
    return value;
  }

  if (value.startsWith('//')) {
    return `https:${value}`;
  }

  if (value.startsWith('/')) {
    return `${API_ORIGIN}${value}`;
  }

  return `${API_ORIGIN}/${value.replace(/^\.?\//, '')}`;
}
