import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from '../utils/analytics';

/**
 * AnalyticsTracker component
 * Listens to route changes and sends page_view events to GA4
 */
const AnalyticsTracker = () => {
  const location = useLocation();

  useEffect(() => {
    // Send page_view event on route change
    trackPageView(location.pathname + location.search);
  }, [location]);

  return null;
};

export default AnalyticsTracker;
