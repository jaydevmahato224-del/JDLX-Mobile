import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useStore } from '../store/useStore';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorKind: null };
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
            // Third-party/browser API failures (push, service worker, etc.)
            // must never take down the app — keep rendering the children.
            console.warn("Ignoring third-party/browser API error in ErrorBoundary:", errorStr);
            this.setState({ errorKind: 'third_party' });
            return;
        }

        // Only trigger the full-screen network/server overlay for network failures.
        // NOTE: avoid a bare 'fetch' match here — it also matches messages like
        // "Cannot access 'fetchBillingProducts' before initialization".
        const message = (error?.message || '').toLowerCase()
        const isNetworkError =
            !navigator.onLine ||
            /(failed to fetch|networkerror|network error|load failed|net::|err_|fetch failed|typeerror: failed|aborted)/.test(message);

        if (isNetworkError) {
            useStore.getState().setGlobalError(navigator.onLine ? 'server' : 'network');
            this.setState({ errorKind: 'network' });
        } else {
            // A plain rendering error — show a visible, recoverable fallback.
            // Returning null here (old behaviour) silently blanked the whole app.
            console.error("Warehouse Frontend Rendering Error (Not a Server Error):", error);
            this.setState({ errorKind: 'render' });
        }
    }

    render() {
        // Third-party/browser API errors are spurious (push, SW, Firebase) —
        // keep rendering the app instead of blanking it.
        if (this.state.hasError && this.state.errorKind === 'third_party') {
            return this.props.children;
        }

        if (!this.state.hasError) {
            return this.props.children;
        }

        // Network/server failures are shown by GlobalErrorOverlay (which lives
        // OUTSIDE this boundary in App.jsx, so it stays mounted).
        if (this.state.errorKind === 'network') {
            return null;
        }

        // Visible fallback for rendering errors — never a blank page.
        const message =
            this.state.error?.message ||
            String(this.state.error || '') ||
            'Something went wrong while rendering this page.';

        return (
            <div className="min-h-screen bg-[#020617] flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center shadow-2xl">
                    <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center">
                        <AlertTriangle className="w-7 h-7 text-rose-400" />
                    </div>
                    <h1 className="text-xl font-black text-slate-100 mb-2">Something went wrong</h1>
                    <p className="text-sm text-slate-400 mb-6 break-words">{message}</p>
                    <div className="flex gap-3">
                        <button
                            onClick={() => window.location.reload()}
                            className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm transition"
                        >
                            Reload Page
                        </button>
                        <button
                            onClick={() => this.setState({ hasError: false, error: null, errorKind: null })}
                            className="py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-sm transition"
                        >
                            Try Again
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

export default ErrorBoundary;
