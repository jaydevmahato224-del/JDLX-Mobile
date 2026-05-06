import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Server, Play, Square, RefreshCw, AlertCircle, CheckCircle2, Activity, ShieldCheck, Key, Mail, Lock, X } from 'lucide-react';

const BRIDGE_URL = 'http://localhost:9999/api';

const AdminServerControl = () => {
    const [services, setServices] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState({});
    const [error, setError] = useState(null);
    const navigate = useNavigate();
    
    // OTP & Session State
    const [showOTP, setShowOTP] = useState(true);
    const [otp, setOtp] = useState('');
    const [otpStep, setOtpStep] = useState('request');
    const [pendingAction, setPendingAction] = useState(null);
    const [isVerified, setIsVerified] = useState(false);
    const [sessionExpiry, setSessionExpiry] = useState(0);
    
    // Timers
    const [resendTimer, setResendTimer] = useState(0);
    const [lockTimer, setLockTimer] = useState("");
    const resendRef = useRef(null);
    const lockRef = useRef(null);

    const startResendTimer = (seconds) => {
        setResendTimer(seconds);
        if (resendRef.current) clearInterval(resendRef.current);
        resendRef.current = setInterval(() => {
            setResendTimer(prev => {
                if (prev <= 1) {
                    clearInterval(resendRef.current);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };

    const startSessionTimer = (expiry) => {
        setSessionExpiry(expiry);
        if (lockRef.current) clearInterval(lockRef.current);
        lockRef.current = setInterval(() => {
            const now = Math.floor(Date.now() / 1000);
            const left = expiry - now;
            if (left <= 0) {
                clearInterval(lockRef.current);
                setIsVerified(false);
                setShowOTP(true);
                setOtpStep('request');
                setServices(null);
                return;
            }
            const m = Math.floor(left / 60);
            const s = left % 60;
            setLockTimer(`${m}:${s < 10 ? '0'+s : s}`);
        }, 1000);
    };

    const fetchStatus = async () => {
        try {
            const res = await fetch(`${BRIDGE_URL}/status`);
            if (res.status === 403) {
                setIsVerified(false);
                setShowOTP(true);
                setOtpStep('request');
                return;
            }
            if (!res.ok) throw new Error('Bridge unreachable');
            const data = await res.json();
            setServices(data);
            setError(null);
            setIsVerified(true);
            setShowOTP(false);
        } catch (err) {
            setError('System Bridge is offline.');
        } finally {
            setLoading(false);
        }
    };

    const requestOTP = async () => {
        if (resendTimer > 0) return;
        setLoading(true);
        try {
            const res = await fetch(`${BRIDGE_URL}/request-otp`, { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                setOtpStep('verify');
                if (data.next_resend_seconds) startResendTimer(data.next_resend_seconds);
            } else {
                alert(data.error || 'Failed');
                if (data.next_resend_seconds) startResendTimer(data.next_resend_seconds);
            }
        } catch (err) {
            alert('Bridge error');
        } finally {
            setLoading(false);
        }
    };

    const verifyOTP = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${BRIDGE_URL}/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ otp })
            });
            const data = await res.json();
            if (res.ok) {
                setIsVerified(true);
                setShowOTP(false);
                startSessionTimer(data.session_expiry);
                fetchStatus();
            } else {
                alert(data.error || 'Invalid OTP');
            }
        } catch (err) {
            alert('Verification error');
        } finally {
            setLoading(false);
        }
    };

    const handleAction = async (key, action) => {
        setActionLoading(prev => ({ ...prev, [key]: true }));
        try {
            const res = await fetch(`${BRIDGE_URL}/${action}/${key}`, { method: 'POST' });
            if (res.status === 403) {
                setIsVerified(false);
                setShowOTP(true);
                return;
            }
            setTimeout(fetchStatus, 2000);
        } catch (err) {
            alert(`Failed to ${action} ${key}`);
        } finally {
            setActionLoading(prev => ({ ...prev, [key]: false }));
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(() => {
            if (isVerified) fetchStatus();
        }, 5000);
        return () => {
            clearInterval(interval);
            if (resendRef.current) clearInterval(resendRef.current);
            if (lockRef.current) clearInterval(lockRef.current);
        };
    }, [isVerified]);

    return (
        <div className="max-w-6xl mx-auto p-6 space-y-8">
            {/* OTP Modal Overlay */}
            {showOTP && (
                <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
                    <div className="bg-white rounded-[3rem] p-10 max-w-md w-full shadow-2xl space-y-8 border border-gray-100 relative">
                        {/* Close/Back Button */}
                        <button 
                            onClick={() => navigate('/admin/dashboard')}
                            className="absolute top-6 right-6 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-full transition-all"
                        >
                            <X className="w-6 h-6" />
                        </button>

                        <div className="text-center">
                            <div className="w-20 h-20 bg-blue-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-inner">
                                {otpStep === 'request' ? <Mail className="w-10 h-10 text-blue-600" /> : <Key className="w-10 h-10 text-blue-600" />}
                            </div>
                            <h2 className="text-3xl font-black text-gray-900 tracking-tight">Security Lock</h2>
                            <p className="text-gray-500 mt-3 font-medium">
                                {otpStep === 'request' 
                                    ? "Access to server controls is restricted. Verify your identity to unlock."
                                    : "Enter the 6-digit code sent to jdlx***@gmail.com"}
                            </p>
                        </div>

                        {otpStep === 'request' ? (
                            <button 
                                onClick={requestOTP}
                                disabled={resendTimer > 0}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-5 rounded-[1.5rem] font-bold transition-all shadow-xl shadow-blue-200 disabled:opacity-50 active:scale-95 flex items-center justify-center gap-3"
                            >
                                <Play className="w-5 h-5 fill-current" />
                                {resendTimer > 0 ? `Retry in ${resendTimer}s` : 'Request Access Code'}
                            </button>
                        ) : (
                            <div className="space-y-6">
                                <input 
                                    type="text" 
                                    value={otp}
                                    onChange={(e) => setOtp(e.target.value)}
                                    placeholder="000000"
                                    maxLength={6}
                                    className="w-full bg-gray-50 border-2 border-gray-100 p-5 rounded-[1.5rem] text-center text-4xl tracking-[0.4em] font-black focus:border-blue-500 focus:bg-white outline-none transition-all shadow-inner"
                                />
                                <button 
                                    onClick={verifyOTP}
                                    className="w-full bg-green-600 hover:bg-green-700 text-white py-5 rounded-[1.5rem] font-bold transition-all shadow-xl shadow-green-200 active:scale-95"
                                >
                                    Verify & Unlock System
                                </button>
                                
                                <div className="text-center pt-2">
                                    <button 
                                        onClick={requestOTP}
                                        disabled={resendTimer > 0}
                                        className="text-sm font-bold text-gray-400 hover:text-blue-600 transition-colors disabled:opacity-30 flex items-center justify-center gap-2 mx-auto"
                                    >
                                        <RefreshCw className={`w-4 h-4 ${resendTimer > 0 ? 'animate-spin' : ''}`} />
                                        Resend Code {resendTimer > 0 ? `(${resendTimer}s)` : ''}
                                    </button>
                                </div>
                            </div>
                        )}

                        <button 
                            onClick={() => navigate('/admin/dashboard')}
                            className="w-full text-gray-400 font-bold hover:text-gray-600 transition-colors pt-2 flex items-center justify-center gap-2"
                        >
                            <X className="w-4 h-4" />
                            Back to Dashboard
                        </button>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-5">
                    <div className="p-4 bg-blue-600 rounded-3xl shadow-xl shadow-blue-200">
                        <ShieldCheck className="w-8 h-8 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-gray-900 tracking-tight flex items-center gap-3">
                            Server Management
                        </h1>
                        <div className="flex items-center gap-3 mt-1">
                            <span className="px-3 py-1 bg-green-100 text-green-700 text-[10px] font-black uppercase tracking-widest rounded-full">Secure Session</span>
                            <span className="text-gray-400 text-xs font-bold flex items-center gap-1">
                                <Lock className="w-3 h-3" /> Locks in {lockTimer}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {services && Object.entries(services).map(([key, service]) => (
                    <div key={key} className="bg-white border border-gray-100 rounded-[2.5rem] p-8 shadow-sm hover:shadow-xl transition-all group relative overflow-hidden">
                        <div className={`absolute top-0 right-0 w-40 h-40 blur-3xl opacity-10 -mr-16 -mt-16 transition-all group-hover:opacity-20 ${service.running ? 'bg-green-500' : 'bg-red-500'}`}></div>

                        <div className="flex justify-between items-start mb-8 relative">
                            <div className="flex items-center gap-5">
                                <div className={`p-5 rounded-2xl transition-colors ${service.running ? 'bg-green-50 text-green-600' : 'bg-slate-50 text-slate-400'}`}>
                                    <Server className="w-10 h-10" />
                                </div>
                                <div>
                                    <h3 className="text-2xl font-black text-gray-900 tracking-tight">{service.name}</h3>
                                    <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-1">Local Port: {service.port}</p>
                                </div>
                            </div>
                            <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest ${service.running ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                <div className={`w-2 h-2 rounded-full ${service.running ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                                {service.running ? 'Online' : 'Offline'}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 relative">
                            {!service.running ? (
                                <button 
                                    onClick={() => handleAction(key, 'start')}
                                    disabled={actionLoading[key]}
                                    className="col-span-2 bg-slate-900 hover:bg-black text-white py-4 rounded-2xl font-black uppercase tracking-widest transition-all flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50 shadow-lg shadow-slate-200"
                                >
                                    {actionLoading[key] ? (
                                        <>
                                            <RefreshCw className="w-5 h-5 animate-spin" />
                                            Booting Service...
                                        </>
                                    ) : (
                                        <>
                                            <Play className="w-5 h-5 fill-current" />
                                            Start Service
                                        </>
                                    )}
                                </button>
                            ) : (
                                <>
                                    <button 
                                        onClick={() => handleAction(key, 'stop')}
                                        disabled={actionLoading[key]}
                                        className="bg-red-50 hover:bg-red-100 text-red-600 py-4 rounded-2xl font-black uppercase tracking-widest transition-all flex items-center justify-center gap-3 active:scale-95 shadow-sm disabled:opacity-50"
                                    >
                                        <Square className={`w-5 h-5 fill-current ${actionLoading[key] ? 'animate-pulse' : ''}`} />
                                        {actionLoading[key] ? 'Stopping...' : 'Stop'}
                                    </button>
                                    <button 
                                        onClick={() => handleAction(key, 'start')}
                                        disabled={actionLoading[key]}
                                        className="bg-blue-50 hover:bg-blue-100 text-blue-600 py-4 rounded-2xl font-black uppercase tracking-widest transition-all flex items-center justify-center gap-3 active:scale-95 shadow-sm disabled:opacity-50"
                                    >
                                        <RefreshCw className={`w-5 h-5 ${actionLoading[key] ? 'animate-spin' : ''}`} />
                                        {actionLoading[key] ? 'Restarting...' : 'Restart'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default AdminServerControl;
