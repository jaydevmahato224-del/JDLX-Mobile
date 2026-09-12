// API Configuration
const PROD_BACKEND_URL = "https://jdlx-mobile.onrender.com/api";
// Bare backend origin — used to build absolute media/static URLs. Media is
// public (no cookies needed), so it can always load straight from the backend
// even when the API itself is served same-origin through a proxy.
const PROD_BACKEND_ORIGIN = "https://jdlx-mobile.onrender.com";

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
  
  // In production, we should prioritize the Render URL.
  if (hostname === 'jdlxmobile.in' || hostname === 'www.jdlxmobile.in' || hostname.includes('vercel.app')) {
    return PROD_BACKEND_URL; 
  }

  return `${protocol}//${resolvedHost}:5000/api`;
}

// Determine if we are on a production domain or any remote host
const currentHostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isLocalhost = currentHostname === 'localhost' || currentHostname === '127.0.0.1';

function resolveApiBaseUrl() {
  let base = import.meta.env.VITE_API_URL ||
    (isLocalhost ? getDefaultApiBaseUrl() : PROD_BACKEND_URL);

  if (typeof window === 'undefined') return base;

  const hostname = window.location.hostname;
  const isAndroid = /Android/i.test(navigator.userAgent || '');
  const baseUsesLoopback = /localhost|127\.0\.0\.1/.test(base);

  // Android emulator: even when VITE_API_URL is set in .env, `localhost` /
  // `127.0.0.1` still point to the emulator itself, not the host machine.
  // Rewrite the host so the emulator can reach the backend.
  // (Only needed for the VITE_API_URL path — getDefaultApiBaseUrl() already
  // resolves 10.0.2.2 when no env override is present.)
  if (isAndroid && (hostname === 'localhost' || hostname === '127.0.0.1') && baseUsesLoopback) {
    return base
      .replace('localhost', '10.0.2.2')
      .replace('127.0.0.1', '10.0.2.2');
  }

  // Real phone/tablet on the same Wi-Fi: the page is served from the dev
  // machine's LAN IP (e.g. http://192.168.x.x:5173), but a loopback API base
  // (localhost/127.0.0.1 from .env) would point at the *device itself* and
  // every API call would fail — which is why the frontend shows no data on
  // mobile. The backend runs on the same machine as Vite, so rewrite the
  // loopback host to the host the page was loaded from.
  // Safety guard: never rewrite on known production/vercel domains.
  const isProductionDomain =
    hostname === 'jdlxmobile.in' ||
    hostname === 'www.jdlxmobile.in' ||
    hostname.endsWith('.vercel.app') ||
    hostname.endsWith('onrender.com');

  if (!isProductionDomain && hostname !== 'localhost' && hostname !== '127.0.0.1' && baseUsesLoopback) {
    return base.replace(/localhost|127\.0\.0\.1/, hostname);
  }

  return base;
}

// Export API_BASE_URL: Use environment variable if set, otherwise use local fallback for localhost or production URL for everything else.
export const API_BASE_URL = resolveApiBaseUrl();

// When API_BASE_URL is an absolute URL we derive the origin from it. When it is
// relative (same-origin proxy, e.g. VITE_API_URL=/api via the Vercel rewrite),
// there is no origin to derive, so media keeps pointing at the backend host —
// otherwise every product/profile image URL would resolve to the frontend and
// 404.
export const API_ORIGIN = /^https?:\/\//i.test(API_BASE_URL)
  ? API_BASE_URL.replace(/\/api\/?$/, '')
  : PROD_BACKEND_ORIGIN;

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
