import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { API_BASE_URL } from '../config';
import { Loader2, Mail, ShieldCheck, LogOut, ArrowRight, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

const AdminReauthModal = () => {
    const isReauthenticating = useStore(state => state.isReauthenticating);
    const setReauthenticating = useStore(state => state.setReauthenticating);
    const adminUser = useStore(state => state.adminUser);
    const setAdminUser = useStore(state => state.setAdminUser);
    const adminLogout = useStore(state => state.adminLogout);

    const [otp, setOtp] = useState('');
    const [loading, setLoading] = useState(false);
    const [requesting, setRequesting] = useState(false);
    const [otpSent, setOtpSent] = useState(false);
    const [timer, setTimer] = useState(0);

    useEffect(() => {
        let interval;
        if (timer > 0) {
            interval = setInterval(() => {
                setTimer(prev => prev - 1);
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [timer]);

    if (!isReauthenticating || !adminUser) return null;

    const handleRequestOtp = async () => {
        if (timer > 0) return;
        
        setRequesting(true);
        try {
            const res = await fetch(`${API_BASE_URL}/admin/request-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: adminUser.email })
            });
            const data = await res.json();
            
            if (data.success) {
                toast.success('OTP sent to your email');
                setOtpSent(true);
                setTimer(60); // 60 seconds cooldown
            } else {
                toast.error(data.error || 'Failed to send OTP');
            }
        } catch (err) {
            toast.error('Network error. Try again.');
        } finally {
            setRequesting(false);
        }
    };

    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        if (otp.length !== 6) {
            toast.error('Please enter a valid 6-digit OTP');
            return;
        }

        setLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/admin/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: adminUser.email, otp })
            });
            const data = await res.json();

            if (data.success) {
                setAdminUser(data.user, data.token);
                setReauthenticating(false);
                toast.success('Session extended successfully!');
                // Reload to resume pending actions if necessary, 
                // but usually the user just wants to continue.
                // window.location.reload(); 
            } else {
                toast.error(data.error || 'Invalid OTP');
            }
        } catch (err) {
            toast.error('Verification failed. Try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleFullLogout = () => {
        adminLogout();
        setReauthenticating(false);
        window.location.replace('/admin/login');
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/80 backdrop-blur-md p-4">
            <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden border border-white/20 animate-in fade-in zoom-in duration-300">
                {/* Header */}
                <div className="bg-slate-900 p-8 text-center relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-primary/30"></div>
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-2xl mb-4 backdrop-blur-sm border border-white/10">
                        <ShieldCheck className="w-8 h-8 text-primary" />
                    </div>
                    <h2 className="text-xl font-black text-white tracking-tight">Session Expired</h2>
                    <p className="text-slate-400 text-sm mt-1">For your security, please re-verify your identity.</p>
                </div>

                {/* Body */}
                <div className="p-8">
                    <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 mb-6">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <Mail className="w-5 h-5 text-primary" />
                        </div>
                        <div className="overflow-hidden">
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Logged in as</p>
                            <p className="text-sm font-bold text-slate-700 truncate">{adminUser.email}</p>
                        </div>
                    </div>

                    {!otpSent ? (
                        <button
                            onClick={handleRequestOtp}
                            disabled={requesting}
                            className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold py-4 rounded-2xl transition-all flex items-center justify-center gap-2 group shadow-xl shadow-slate-900/20 active:scale-95"
                        >
                            {requesting ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    <span>Send Verification OTP</span>
                                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                </>
                            )}
                        </button>
                    ) : (
                        <form onSubmit={handleVerifyOtp} className="space-y-6">
                            <div>
                                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 px-1">
                                    Enter 6-Digit Code
                                </label>
                                <input
                                    type="text"
                                    maxLength="6"
                                    value={otp}
                                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                                    placeholder="000000"
                                    autoFocus
                                    className="w-full bg-slate-50 border-2 border-slate-100 p-5 rounded-2xl text-center text-3xl font-black tracking-[0.5em] focus:border-primary focus:bg-white outline-none transition-all placeholder:text-slate-200"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={loading || otp.length !== 6}
                                className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 text-slate-900 font-black py-4 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-xl shadow-primary/20 active:scale-95"
                            >
                                {loading ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <span>Extend Session</span>
                                )}
                            </button>

                            <div className="flex items-center justify-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleRequestOtp}
                                    disabled={timer > 0 || requesting}
                                    className="text-xs font-bold text-slate-400 hover:text-primary transition-colors flex items-center gap-1 disabled:opacity-50"
                                >
                                    <RefreshCw className={`w-3 h-3 ${requesting ? 'animate-spin' : ''}`} />
                                    {timer > 0 ? `Resend in ${timer}s` : 'Resend Code'}
                                </button>
                            </div>
                        </form>
                    )}

                    <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col gap-3">
                        <button
                            onClick={handleFullLogout}
                            className="w-full flex items-center justify-center gap-2 text-slate-400 hover:text-red-500 font-bold text-sm transition-colors py-2"
                        >
                            <LogOut className="w-4 h-4" />
                            <span>Logout & Switch Account</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminReauthModal;
