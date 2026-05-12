const PROD_BACKEND_URL = "https://jdlx-mobile.onrender.com/api";

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
  
  return `${protocol}//${resolvedHost}:5000/api`;
}

const currentHostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isLocalhost = currentHostname === 'localhost' || currentHostname === '127.0.0.1';

export const API_BASE_URL = import.meta.env.VITE_API_URL || 
  (isLocalhost ? getDefaultApiBaseUrl() : PROD_BACKEND_URL);

export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

export function resolveMediaUrl(value) {
  if (!value || typeof value !== 'string') return '';
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/')) return `${API_ORIGIN}${value}`;
  return `${API_ORIGIN}/${value.replace(/^\.?\//, '')}`;
}
