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
  
  // In production, we should prioritize the Render URL or the environment variable.
  if (hostname === 'jdlxmobile.in' || hostname === 'www.jdlxmobile.in' || hostname.includes('vercel.app')) {
    return PROD_BACKEND_URL; 
  }

  return `${protocol}//${resolvedHost}:5000/api`;
}

const PROD_BACKEND_URL = "https://jdlx-mobile.onrender.com/api";

  // In production domains, we force the Render URL to prevent misconfigured VITE_API_URL env vars
  const isProductionDomain = hostname === 'jdlxmobile.in' || hostname === 'www.jdlxmobile.in' || hostname.includes('vercel.app');

  export const API_BASE_URL = isProductionDomain 
    ? PROD_BACKEND_URL 
    : (import.meta.env.VITE_API_URL || getDefaultApiBaseUrl());
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
