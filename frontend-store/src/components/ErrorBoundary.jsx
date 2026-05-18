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
            const isOffline = !navigator.onLine || (this.state.error && this.state.error.message.includes('fetch'));

            return (
                <div className="min-h-screen bg-white px-6 flex items-center justify-center font-sans">
                    <div className="w-full max-w-lg text-center space-y-8 animate-in fade-in duration-700">
                        {/* Animated Robot Character */}
                        <div className="relative h-64 flex justify-center items-center">
                            <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-2xl">
                                <style>
                                    {`
                                        @keyframes wobble {
                                            0%, 100% { transform: rotate(-3deg) translateY(0); }
                                            50% { transform: rotate(3deg) translateY(-10px); }
                                        }
                                        @keyframes blink {
                                            0%, 90%, 100% { transform: scaleY(1); }
                                            95% { transform: scaleY(0.1); }
                                        }
                                        @keyframes antenna-shake {
                                            0%, 100% { transform: rotate(0); }
                                            25% { transform: rotate(-15deg); }
                                            75% { transform: rotate(15deg); }
                                        }
                                        .robot-body { animation: wobble 4s ease-in-out infinite; transform-origin: center; }
                                        .robot-eye { animation: blink 5s infinite; transform-origin: center; }
                                        .robot-antenna { animation: antenna-shake 2s ease-in-out infinite; transform-origin: bottom center; }
                                    `}
                                </style>
                                {/* Antenna */}
                                <g className="robot-antenna" style={{ transformBox: 'fill-box' }}>
                                    <line x1="120" y1="60" x2="120" y2="40" stroke="#1a2332" strokeWidth="6" strokeLinecap="round" />
                                    <circle cx="120" cy="35" r="8" fill="#F5C518" />
                                </g>
                                {/* Robot Head/Body */}
                                <g className="robot-body">
                                    <rect x="60" y="60" width="120" height="120" rx="30" fill="#1a2332" />
                                    <rect x="75" y="75" width="90" height="70" rx="15" fill="#2a3a52" />
                                    {/* Eyes */}
                                    <circle className="robot-eye" cx="100" cy="110" r="10" fill="#F5C518" />
                                    <circle className="robot-eye" cx="140" cy="110" r="10" fill="#F5C518" />
                                    {/* Mouth/Panel */}
                                    <rect x="95" y="145" width="50" height="8" rx="4" fill="#F5C518" opacity="0.8" />
                                </g>
                                {/* Floating Gears/Signals */}
                                <path d="M40 100 Q 30 80, 20 100" stroke="#F5C518" strokeWidth="4" fill="none" className="animate-pulse" />
                                <path d="M200 80 Q 210 60, 220 80" stroke="#F5C518" strokeWidth="4" fill="none" className="animate-pulse" style={{ animationDelay: '0.5s' }} />
                            </svg>
                        </div>

                        <div className="space-y-4">
                            <h1 className="text-3xl md:text-4xl font-black text-[#1a2332] tracking-tight">
                                {isOffline ? "No signal found! 📡" : "Oops! Lost connection..."}
                            </h1>
                            <p className="text-slate-500 font-medium text-lg">
                                Check your internet and try again
                            </p>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
                            <button
                                onClick={() => window.location.reload()}
                                className="px-10 py-4 bg-[#F5C518] text-[#1a2332] font-black rounded-2xl shadow-[0_10px_30px_-5px_rgba(245,197,24,0.4)] hover:shadow-[0_15px_40px_-5px_rgba(245,197,24,0.6)] active:scale-95 transition-all duration-300"
                            >
                                Try Again
                            </button>
                            <a
                                href="/"
                                className="px-10 py-4 bg-white text-[#1a2332] font-bold rounded-2xl border-2 border-slate-100 hover:bg-slate-50 active:scale-95 transition-all duration-300"
                            >
                                Go Home
                            </a>
                        </div>

                        {/* Technical Details Hidden but available */}
                        {this.state.error && (
                            <details className="mt-12 text-left opacity-30 hover:opacity-100 transition-opacity">
                                <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center">
                                    Technical Log
                                </summary>
                                <pre className="mt-4 p-4 bg-slate-50 rounded-xl text-[10px] text-slate-500 overflow-auto max-h-40">
                                    {this.state.error.toString()}
                                    {"\n"}
                                    {this.state.error.stack}
                                </pre>
                            </details>
                        )}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
