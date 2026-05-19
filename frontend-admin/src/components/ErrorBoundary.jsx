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
        const isNetworkError = !navigator.onLine || error.message?.toLowerCase().includes('fetch') || error.message?.toLowerCase().includes('network');
        
        if (isNetworkError) {
            useStore.getState().setGlobalError(navigator.onLine ? 'server' : 'network');
        } else {
            console.error("Admin Frontend Rendering Error (Not a Server Error):", error);
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
