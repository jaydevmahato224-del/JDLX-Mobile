import React from 'react';
import { useStore } from '../store/useStore';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("Uncaught error:", error, errorInfo);
        
        // Filter out non-backend errors (Firebase, Push, Browser APIs)
        const errorStr = error?.toString() || '';
        const isThirdPartyError = 
            errorStr.includes('PushManager') || 
            errorStr.includes('ServiceWorker') || 
            errorStr.includes('Firebase') ||
            errorStr.includes('applicationServerKey') ||
            errorStr.includes('InvalidAccessError') ||
            errorStr.includes('messaging');

        if (isThirdPartyError) {
            console.warn("Ignoring third-party/browser API error in ErrorBoundary:", errorStr);
            return;
        }

        // Only trigger global error screens if it looks like a network failure.
        // JS/Rendering errors should NOT trigger the "Server Error" screen 
        // because that screen blames the backend ("technical difficulties on our end").
        const isNetworkError = !navigator.onLine || error.message?.toLowerCase().includes('fetch') || error.message?.toLowerCase().includes('network');
        
        if (isNetworkError) {
            useStore.getState().setGlobalError(navigator.onLine ? 'server' : 'network');
        } else {
            // It's a JS/Rendering error - log it and trigger global error screen as 'client' error
            console.error("Frontend Rendering Error:", error);
            useStore.getState().setGlobalError('client');
        }
    }

    render() {
        if (this.state.hasError) {
            return null; // Let GlobalErrorOverlay handle the UI
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
