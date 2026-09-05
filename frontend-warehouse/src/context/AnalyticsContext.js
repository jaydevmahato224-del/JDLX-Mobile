import React, { createContext, useContext } from 'react';

export const AnalyticsContext = createContext({
    trackEvent: () => {},
    trackSearch: () => {}
});

export const useAnalyticsContext = () => useContext(AnalyticsContext);
