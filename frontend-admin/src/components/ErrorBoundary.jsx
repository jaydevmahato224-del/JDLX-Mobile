import React from 'react';
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        // Log to backend in production
        console.error("Uncaught error:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gray-50 text-center">
                    <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-6 animate-bounce">
                        <AlertTriangle size={40} className="text-red-500" />
                    </div>
                    <h1 className="text-3xl font-black text-gray-800 mb-2">Something went wrong</h1>
                    <p className="text-gray-500 mb-8 max-w-md mx-auto font-medium">
                        An unexpected error occurred. We've been notified and are working on a fix.
                    </p>

                    <div className="flex flex-col sm:flex-row gap-4 w-full max-w-xs">
                        <button
                            onClick={() => window.location.reload()}
                            className="flex-1 py-4 bg-primary text-white rounded-2xl font-black shadow-xl shadow-primary/20 flex items-center justify-center gap-2 active:scale-95 transition-all"
                        >
                            <RefreshCcw size={20} /> Reload App
                        </button>
                        <a
                            href="/"
                            className="flex-1 py-4 bg-white text-gray-800 border-2 border-gray-100 rounded-2xl font-black shadow-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
                        >
                            <Home size={20} /> Go Home
                        </a>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
