import { useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { API_BASE_URL } from '../config';

function getSessionId() {
  let sid = sessionStorage.getItem('jdlx_sid');
  if (!sid) {
    sid = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    sessionStorage.setItem('jdlx_sid', sid);
  }
  return sid;
}

function getDeviceInfo() {
  const ua = navigator.userAgent;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
  const isTablet = /iPad|Android(?!.*Mobile)/i.test(ua);
  return {
    device_type: isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop',
    browser: ua.includes('Chrome') ? 'Chrome'
           : ua.includes('Firefox') ? 'Firefox'
           : ua.includes('Safari') ? 'Safari'
           : ua.includes('Edg/') ? 'Edge' : 'Other',
    os: ua.includes('Android') ? 'Android'
      : ua.includes('iPhone') || ua.includes('iPad') ? 'iOS'
      : ua.includes('Windows') ? 'Windows'
      : ua.includes('Mac') ? 'macOS'
      : ua.includes('Linux') ? 'Linux' : 'Other',
    screen_resolution: window.screen.width + 'x' + window.screen.height,
  };
}

function getUTMParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get('utm_source') || null,
    utm_medium: params.get('utm_medium') || null,
    utm_campaign: params.get('utm_campaign') || null,
  };
}

export function useAnalytics(userId = null) {
  const location = useLocation();
  // Initialized in the mount effect below (Date.now() must not run during render).
  const pageEnterTime = useRef(0);
  const sessionId = getSessionId();

  // Auto track page view on route change
  useEffect(() => {
    const deviceInfo = getDeviceInfo();
    const utmParams = getUTMParams();

    fetch(`${API_BASE_URL}/analytics/pageview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        user_id: userId,
        page_path: location.pathname,
        page_title: document.title,
        referrer: document.referrer || null,
        ...deviceInfo,
        ...utmParams,
      }),
    }).catch(() => {});

    pageEnterTime.current = Date.now();

    // Send duration when leaving page
    return () => {
      const duration = Math.floor((Date.now() - pageEnterTime.current) / 1000);
      if (duration > 1) {
        navigator.sendBeacon(
          `${API_BASE_URL}/analytics/duration`,
          JSON.stringify({
            session_id: sessionId,
            page_path: location.pathname,
            duration_seconds: duration,
          })
        );
      }
    };
  }, [location.pathname, sessionId, userId]);

  // Track custom events
  const trackEvent = useCallback((event_type, event_category, event_label = null, event_value = null) => {
    fetch(`${API_BASE_URL}/analytics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        user_id: userId,
        event_type,
        event_category,
        event_label,
        event_value: event_value ? String(event_value) : null,
        page_path: window.location.pathname,
      }),
    }).catch(() => {});
  }, [sessionId, userId]);

  // Track search queries
  const trackSearch = useCallback((query, results_count = 0) => {
    fetch(`${API_BASE_URL}/analytics/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        user_id: userId,
        query,
        results_count,
      }),
    }).catch(() => {});
  }, [sessionId, userId]);

  return { trackEvent, trackSearch };
}
