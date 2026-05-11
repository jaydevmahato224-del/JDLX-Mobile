function getDefaultApiBaseUrl() {
  if (typeof window === 'undefined') return 'http://localhost:5000/api';
  const hostname = window.location.hostname;
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  
  if (hostname.includes('vercel.app') || hostname.includes('jdlxmobile.in')) {
    return `${protocol}//${hostname}/api`;
  }
  return `${protocol}//${hostname}:5000/api`;
}

export const API_BASE_URL = import.meta.env.VITE_API_URL || getDefaultApiBaseUrl();
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

export function resolveMediaUrl(value) {
  if (!value || typeof value !== 'string') return '';
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/')) return `${API_ORIGIN}${value}`;
  return `${API_ORIGIN}/${value.replace(/^\.?\//, '')}`;
}
