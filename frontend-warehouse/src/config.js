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
  
  if (hostname.includes('vercel.app') || hostname.includes('jdlxmobile.in')) {
    return `${protocol}//${hostname}/api`;
  }

  return `${protocol}//${resolvedHost}:5000/api`;
}

const PROD_BACKEND_URL = "https://jdlx-mobile.onrender.com/api";

export const API_BASE_URL = import.meta.env.VITE_API_URL || 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? getDefaultApiBaseUrl() 
    : PROD_BACKEND_URL);
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

// DB-backed media proxy on the backend. When a product image fails to load
// from its original cloud host (Catbox etc. are intermittently blocked/down),
// the panel retries once through the backend, which serves the same bytes from
// the persistent uploaded_media table. Only absolute (cloud-hosted) URLs are
// proxied — local /static paths are served by the backend itself.
// Only the URL's basename is sent — it is the key the backend stored the
// backup under, and it avoids slash-encoding issues in the path.
export function mediaProxyUrl(value) {
  if (!value || typeof value !== 'string') return '';
  if (!/^https?:\/\//i.test(value)) return '';
  const base = value.split('?')[0].split('/').filter(Boolean).pop() || '';
  if (!base || !base.includes('.')) return '';
  return `${API_BASE_URL}/media-proxy/${base}`;
}

export function resolveMediaUrl(value) {
  if (!value || typeof value !== 'string') return '';
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/')) return `${API_ORIGIN}${value}`;
  return `${API_ORIGIN}/${value.replace(/^\.?\//, '')}`;
}

// Exactly-once retry bookkeeping (per URL) so onError handlers never loop.
const MEDIA_PROXY_RETRIES = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

export function markMediaProxyTried(url) {
  if (MEDIA_PROXY_RETRIES && typeof url === 'string') MEDIA_PROXY_RETRIES.add(url);
}

export function hasMediaProxyBeenTried(url) {
  return Boolean(MEDIA_PROXY_RETRIES && typeof url === 'string' && MEDIA_PROXY_RETRIES.has(url));
}
