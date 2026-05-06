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
            const errorMessage = this.state.error ? this.state.error.toString() : "An unexpected error occurred.";

            return (
                <div className="min-h-screen bg-[var(--color-surface)] px-6 py-10 text-center">
                    <div className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-3xl items-center justify-center">
                        <div className="ui-card-premium w-full overflow-hidden p-8 sm:p-10">
                            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 text-red-500 shadow-[0_20px_50px_-20px_rgba(185,28,28,0.45)]">
                                <AlertTriangle size={38} />
                            </div>
                            <div className="mb-3 flex items-center justify-center gap-2">
                                <div className="h-px w-8 bg-primary/20"></div>
                                <span className="ui-label text-primary/70">Storefront Recovery</span>
                                <div className="h-px w-8 bg-primary/20"></div>
                            </div>
                            <h1 className="ui-h2 mb-3 text-slate-900 sm:text-4xl">Something went wrong</h1>
                            <p className="mx-auto mb-8 max-w-xl font-medium text-slate-500">
                                {errorMessage}
                            </p>
                            {this.state.error && this.state.error.stack && (
                                <details className="mb-8 rounded-[24px] border border-red-100 bg-red-50/40 p-4 text-left">
                                    <summary className="cursor-pointer list-none text-sm font-black uppercase tracking-[0.2em] text-red-700">
                                        Technical details
                                    </summary>
                                    <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-white/80 p-4 text-xs text-red-600">
                                        {this.state.error.stack}
                                    </pre>
                                </details>
                            )}

                            <div className="mx-auto flex w-full max-w-sm flex-col gap-4 sm:flex-row">
                                <button
                                    onClick={() => window.location.reload()}
                                    className="flex-1 rounded-2xl bg-primary py-4 text-white font-black shadow-xl shadow-primary/20 flex items-center justify-center gap-2 active:scale-95 transition-all"
                                >
                                    <RefreshCcw size={20} /> Reload App
                                </button>
                                <a
                                    href="/"
                                    className="flex-1 rounded-2xl border border-slate-200 bg-white/80 py-4 text-slate-800 font-black shadow-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
                                >
                                    <Home size={20} /> Go Home
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
