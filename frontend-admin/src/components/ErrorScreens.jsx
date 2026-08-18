import React, { useState, useEffect } from 'react';
import { RefreshCcw, Server, CloudOff, AlertTriangle, Send, X, CheckCircle2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { API_BASE_URL } from '../config';
import toast from 'react-hot-toast';

// ─── Network Error Screen (Cartoonish) ────────────────────────────────────────
export const NetworkErrorScreen = () => {
    return (
        <div className="fixed inset-0 z-[9999] bg-white flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-500">
            <div className="relative w-64 h-64 mb-8">
                <svg viewBox="0 0 200 200" className="w-full h-full">
                    <style>
                        {`
                            @keyframes flicker {
                                0%, 100% { opacity: 1; }
                                50% { opacity: 0.3; }
                            }
                            @keyframes look {
                                0%, 100% { transform: translateX(0); }
                                25% { transform: translateX(-5px); }
                                75% { transform: translateX(5px); }
                            }
                            @keyframes tear {
                                0% { transform: translateY(0); opacity: 0; }
                                50% { opacity: 1; }
                                100% { transform: translateY(20px); opacity: 0; }
                            }
                            .wifi-path { animation: flicker 1.5s infinite; }
                            .robot-eyes { animation: look 4s infinite; }
                            .tear-drop { animation: tear 3s infinite; }
                        `}
                    </style>
                    <rect x="50" y="60" width="100" height="80" rx="20" fill="#1a2332" />
                    <rect x="65" y="75" width="70" height="40" rx="10" fill="#2a3a52" />
                    <g className="robot-eyes">
                        <circle cx="85" cy="95" r="8" fill="#F5C518" />
                        <circle cx="115" cy="95" r="8" fill="#F5C518" />
                    </g>
                    <line x1="100" y1="60" x2="100" y2="40" stroke="#1a2332" strokeWidth="6" strokeLinecap="round" />
                    <g className="wifi-path">
                        <path d="M80 30 Q 100 15, 120 30" fill="none" stroke="#F5C518" strokeWidth="4" strokeLinecap="round" />
                        <path d="M90 35 Q 100 28, 110 35" fill="none" stroke="#F5C518" strokeWidth="4" strokeLinecap="round" />
                        <line x1="85" y1="20" x2="115" y2="45" stroke="red" strokeWidth="3" opacity="0.7" />
                    </g>
                    <circle className="tear-drop" cx="85" cy="110" r="3" fill="#60a5fa" />
                </svg>
            </div>
            <h1 className="text-3xl font-black text-[#1a2332] mb-2">No Internet Connection</h1>
            <p className="text-slate-500 mb-8 max-w-xs">Check your WiFi or mobile data and try again</p>
            <button 
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 px-10 py-4 bg-[#F5C518] text-[#1a2332] font-black rounded-2xl shadow-lg hover:scale-105 active:scale-95 transition-all"
            >
                <RefreshCcw size={20} />
                Try Again
            </button>
        </div>
    );
};

// ─── Server Error Screen (Professional) ───────────────────────────────────────
export const ServerErrorScreen = () => {
    const [showReportModal, setShowReportModal] = useState(false);
    return (
        <div className="fixed inset-0 z-[9999] bg-slate-50 flex flex-col items-center justify-center p-6 text-center animate-in zoom-in-95 duration-300">
            <div className="mb-12">
                <div className="flex flex-col items-center gap-4">
                    <img src="/logo192.png" alt="JDLX Mobile" className="w-16 h-16 object-contain" />
                    <div className="text-2xl font-black tracking-tighter text-[#1a2332]">
                        JDLX ADMIN
                    </div>
                </div>
            </div>
            <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl shadow-slate-200 border border-slate-100 max-w-md w-full">
                <div className="w-20 h-20 bg-rose-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
                    <Server size={40} className="text-rose-500" />
                </div>
                <h1 className="text-2xl font-bold text-[#1a2332] mb-3">Server Connection Failed</h1>
                <p className="text-slate-500 text-sm mb-8">
                    The admin panel is unable to communicate with the main server. Our engineers are investigating.
                </p>
                <div className="flex flex-col gap-3 mb-8">
                    <div className="flex items-center justify-center gap-2 py-2 px-4 bg-slate-50 rounded-full text-slate-600 text-xs font-bold">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                        </span>
                        🔧 Critical infrastructure monitoring active
                    </div>
                </div>
                <div className="grid grid-cols-1 gap-3">
                    <button 
                        onClick={() => window.location.reload()}
                        className="w-full py-4 bg-[#1a2332] text-white font-bold rounded-2xl hover:bg-[#2a3a52] transition-colors"
                    >
                        Retry Connection
                    </button>
                    <button 
                        onClick={() => setShowReportModal(true)}
                        className="w-full py-4 bg-white text-[#1a2332] font-bold rounded-2xl border-2 border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                        Report This Issue
                    </button>
                </div>
            </div>
            {showReportModal && <ReportModal onClose={() => setShowReportModal(false)} />}
        </div>
    );
};

// ─── Report Modal ────────────────────────────────────────────────────────────
const ReportModal = ({ onClose }) => {
    const { adminUser } = useStore();
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        const reportData = {
            error_type: "Admin Panel API Failure",
            page: window.location.pathname,
            timestamp: new Date().toISOString(),
            user_id: adminUser?.id || "Admin Guest",
            description: description
        };
        try {
            const res = await fetch(`${API_BASE_URL}/report-issue`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reportData)
            });
            if (res.ok) {
                setIsSuccess(true);
                setTimeout(() => onClose(), 3000);
            } else {
                toast.error("Failed to send report");
            }
        } catch {
            toast.error("Network error");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isSuccess) {
        return (
            <div className="fixed inset-0 z-[10000] bg-[#1a2332]/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white rounded-[2rem] p-10 max-w-sm w-full text-center animate-in zoom-in-95">
                    <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle2 size={40} className="text-green-500" />
                    </div>
                    <h2 className="text-2xl font-bold text-[#1a2332] mb-2">Report Sent!</h2>
                    <p className="text-slate-500 text-sm">Thank you for helping us improve.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[10000] bg-[#1a2332]/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white rounded-[2rem] w-full max-w-lg overflow-hidden animate-in slide-in-from-bottom-10">
                <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                    <h2 className="text-xl font-bold text-[#1a2332]">Report an Issue</h2>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-8 space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Error Type</label>
                            <div className="p-3 bg-slate-50 rounded-xl text-xs font-medium text-slate-600 border border-slate-100">
                                Admin API Failure
                            </div>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Page</label>
                            <div className="p-3 bg-slate-50 rounded-xl text-xs font-medium text-slate-600 border border-slate-100 truncate">
                                {window.location.pathname}
                            </div>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Describe what you were doing</label>
                        <textarea 
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full p-4 bg-slate-50 rounded-2xl border-2 border-transparent focus:border-[#F5C518] focus:bg-white outline-none transition-all text-sm min-h-[120px]"
                            placeholder="Optional: Tell us more..."
                        />
                    </div>
                    <button 
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full py-4 bg-[#F5C518] text-[#1a2332] font-black rounded-2xl flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-all"
                    >
                        {isSubmitting ? <RefreshCcw className="animate-spin" size={20} /> : <Send size={20} />}
                        Send Report
                    </button>
                </form>
            </div>
        </div>
    );
};

export const GlobalErrorOverlay = () => {
    const { globalError, setGlobalError, clearGlobalError } = useStore();
    useEffect(() => {
        const handleOnline = () => {
            if (globalError === 'network') {
                toast.success('Connection restored!');
                setTimeout(() => {
                    clearGlobalError();
                    window.location.reload();
                }, 2000);
            }
        };
        const checkConnection = setInterval(() => {
            if (!navigator.onLine && !globalError) {
                setGlobalError('network');
            } else if (navigator.onLine && globalError === 'network') {
                handleOnline();
            }
        }, 10000);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', () => setGlobalError('network'));
        return () => {
            clearInterval(checkConnection);
            window.removeEventListener('online', handleOnline);
        };
    }, [globalError, setGlobalError, clearGlobalError]);
    if (!globalError) return null;
    return (
        <div className="fixed inset-0 z-[9999]">
            {globalError === 'network' ? <NetworkErrorScreen /> : <ServerErrorScreen />}
        </div>
    );
};
