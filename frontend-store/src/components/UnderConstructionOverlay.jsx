import React, { useState } from 'react';
import { Construction, Sparkles, Mail, CheckCircle2, ChevronRight, Lock } from 'lucide-react';
import { useStore } from '../store/useStore';
import toast from 'react-hot-toast';

export default function UnderConstructionOverlay() {
    const { constructionMode, constructionModeMessage } = useStore();
    const [email, setEmail] = useState('');
    const [subscribed, setSubscribed] = useState(false);
    const [showBypassModal, setShowBypassModal] = useState(false);
    const [bypassCode, setBypassCode] = useState('');

    // Check if user already bypassed in this session
    const [isBypassed, setIsBypassed] = useState(() => {
        return sessionStorage.getItem('jdlx_construction_bypass') === 'true';
    });

    if (!constructionMode || isBypassed) return null;

    const handleSubscribe = (e) => {
        e.preventDefault();
        if (!email || !email.includes('@')) {
            toast.error('Please enter a valid email address');
            return;
        }
        setSubscribed(true);
        toast.success("You're on the list! We'll notify you as soon as we launch.", {
            icon: '🚀',
            style: {
                borderRadius: '1.5rem',
                background: '#1e293b',
                color: '#fff',
            }
        });
    };

    const handleBypassSubmit = (e) => {
        e.preventDefault();
        // Super simple bypass code for testing/client review
        if (bypassCode.toLowerCase() === 'jdlx2026' || bypassCode.toLowerCase() === 'admin') {
            sessionStorage.setItem('jdlx_construction_bypass', 'true');
            setIsBypassed(true);
            toast.success('Bypass successful! Welcome to JDLX Mobile Store.', {
                icon: '🔑',
            });
        } else {
            toast.error('Invalid bypass access code');
        }
    };

    return (
        <div className="fixed inset-0 z-[99999] bg-[#0b0f19] flex flex-col items-center justify-between p-6 md:p-12 text-center overflow-y-auto">
            {/* Animated Ambient Background Glows */}
            <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-amber-500/10 rounded-full blur-[100px] pointer-events-none animate-pulse duration-[6000ms]"></div>
            <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-[400px] h-[400px] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none animate-pulse duration-[8000ms]"></div>

            {/* Top Bar / Brand Branding */}
            <div className="relative z-10 w-full max-w-5xl flex items-center justify-center py-4">
                <div className="flex items-center gap-3 backdrop-blur-md bg-white/5 px-6 py-3 rounded-full border border-white/10 shadow-lg">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center font-black text-[#0b0f19] text-sm tracking-tight shadow-md">
                        JD
                    </div>
                    <span className="text-lg font-black tracking-widest text-white">
                        JDLX <span className="text-amber-400 font-medium">MOBILE</span>
                    </span>
                </div>
            </div>

            {/* Main Luxury Glass Card Container */}
            <div className="relative z-10 flex-1 flex items-center justify-center w-full max-w-xl py-6">
                <div className="backdrop-blur-xl bg-[#111827]/70 rounded-[3rem] p-8 md:p-12 border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col items-center w-full">
                    
                    {/* Glowing Animated Construction Icon */}
                    <div className="relative w-24 h-24 mb-8 flex items-center justify-center">
                        <div className="absolute inset-0 bg-amber-400/20 rounded-[2rem] blur-xl animate-pulse duration-[2000ms]"></div>
                        <div className="relative w-20 h-20 bg-gradient-to-br from-amber-400 to-amber-600 rounded-[1.8rem] flex items-center justify-center border border-amber-300/30 shadow-lg shadow-amber-500/10 transform hover:rotate-12 transition-transform duration-500">
                            <Construction className="w-10 h-10 text-[#0b0f19] stroke-[2.2]" />
                        </div>
                        <div className="absolute -top-1 -right-1 bg-emerald-500 text-white rounded-full p-1.5 shadow-md border border-[#111827]">
                            <Sparkles className="w-3.5 h-3.5" />
                        </div>
                    </div>

                    {/* Announcement Title */}
                    <div className="mb-4">
                        <span className="inline-block px-4 py-1.5 rounded-full bg-amber-400/20 text-amber-400 text-[10px] font-black tracking-widest uppercase mb-3 border border-amber-400/30">
                            Coming Soon
                        </span>
                        <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight leading-tight drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)]">
                            We Are Under <br />
                            <span className="bg-gradient-to-r from-amber-400 via-amber-200 to-amber-500 bg-clip-text text-transparent filter drop-shadow-[0_2px_10px_rgba(251,191,36,0.2)]">
                                Construction
                            </span>
                        </h1>
                    </div>

                    {/* Custom Announcement Message (in English) */}
                    <p className="text-slate-300 text-sm md:text-base leading-relaxed mb-10 max-w-md font-semibold drop-shadow-sm">
                        {constructionModeMessage || "Our site is currently undergoing scheduled maintenance and upgrades. We will be back online with exciting new premium products shortly."}
                    </p>

                    {/* Newsletter Subscription or Confirmation */}
                    <div className="w-full max-w-sm">
                        {!subscribed ? (
                            <form onSubmit={handleSubscribe} className="relative flex items-center p-1 rounded-2xl bg-white/5 border border-white/10 focus-within:border-amber-400/50 transition-all">
                                <div className="pl-4 text-slate-400">
                                    <Mail className="w-5 h-5" />
                                </div>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="Enter your email address"
                                    className="w-full py-3.5 pl-3 pr-32 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-slate-500"
                                    required
                                />
                                <button
                                    type="submit"
                                    className="absolute right-1 py-2.5 px-5 bg-gradient-to-r from-amber-400 to-amber-500 text-[#0b0f19] font-bold rounded-xl text-xs hover:opacity-90 active:scale-95 transition-all shadow-md flex items-center gap-1.5"
                                >
                                    Notify Me
                                    <ChevronRight className="w-3.5 h-3.5 stroke-[3.5]" />
                                </button>
                            </form>
                        ) : (
                            <div className="flex items-center justify-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-400 animate-in zoom-in-95">
                                <CheckCircle2 className="w-5 h-5 shrink-0" />
                                <span className="text-xs font-bold">You'll be the first to know!</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom Section: Footer Links and Admin Access */}
            <div className="relative z-10 w-full max-w-5xl flex flex-col md:flex-row items-center justify-between gap-4 py-4 border-t border-white/5 mt-8">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    &copy; 2026 JDLX Mobile. All rights reserved.
                </p>
                <div className="flex items-center gap-6">
                    <button
                        onClick={() => setShowBypassModal(true)}
                        className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-amber-400 transition-colors flex items-center gap-1.5"
                    >
                        <Lock className="w-3 h-3" />
                        Admin Access
                    </button>
                </div>
            </div>

            {/* Bypass Modal Dialog */}
            {showBypassModal && (
                <div className="fixed inset-0 z-[100000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
                    <div className="bg-[#111827] rounded-[2rem] border border-white/10 p-8 max-w-sm w-full text-center animate-in zoom-in-95">
                        <div className="w-12 h-12 bg-amber-400/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-amber-400/20">
                            <Lock className="w-5 h-5 text-amber-400" />
                        </div>
                        <h2 className="text-lg font-black text-white mb-2">Bypass Access Gateway</h2>
                        <p className="text-slate-400 text-xs mb-6 font-medium">Enter JDLX bypass passcode to access storefront preview mode.</p>

                        <form onSubmit={handleBypassSubmit} className="space-y-4">
                            <input
                                type="password"
                                value={bypassCode}
                                onChange={(e) => setBypassCode(e.target.value)}
                                placeholder="Access Passcode"
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:border-amber-400 text-center font-bold text-sm tracking-widest"
                                autoFocus
                            />
                            <div className="grid grid-cols-2 gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowBypassModal(false)}
                                    className="py-3 bg-white/5 hover:bg-white/10 text-white font-bold rounded-xl text-xs transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    onClick={handleBypassSubmit}
                                    className="py-3 bg-amber-400 hover:bg-amber-500 text-[#0b0f19] font-bold rounded-xl text-xs transition-all shadow-lg shadow-amber-400/10"
                                >
                                    Confirm
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
