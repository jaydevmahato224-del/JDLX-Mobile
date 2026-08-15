import React, { useState, useEffect } from 'react';
import { Share2, Copy, CheckCircle2, Gift, Users, Trophy, ChevronRight } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { API_BASE_URL } from '../config';
import { useStore } from '../store/useStore';

const ReferAndEarn = () => {
  const [refData, setRefData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState(false);
  const token = useStore(state => state.token);

  useEffect(() => {
    const fetchRefData = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/referral/my-code`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setRefData(data);
        }
      } catch (error) {
        console.error('Failed to fetch referral data:', error);
      } finally {
        setLoading(false);
      }
    };

    if (token) fetchRefData();
  }, [token]);

  const copyToClipboard = (text, message) => {
    navigator.clipboard.writeText(text);
    toast.success(message || 'Copied to clipboard!');
  };

  // Copy referral code with inline success feedback on the button itself.
  const copyCode = () => {
    copyToClipboard(refData?.code || '', 'Code copied!');
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const shareOnWhatsApp = () => {
    if (!refData) return;
    const text = `Hey! Shop on JDLX Mobile — get ₹10 instantly + ₹20 after your first order! Use my link: ${refData.referral_url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  if (loading) return <div className="flex justify-center items-center min-h-[60vh] animate-pulse text-slate-400 font-bold">Loading Referral Program...</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Hero Section */}
      <div className="bg-[#1B2341] rounded-[2rem] p-8 text-white relative overflow-hidden shadow-2xl shadow-indigo-900/20">
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 rounded-full text-indigo-200 text-[10px] font-black uppercase tracking-widest mb-4">
            Limited Time Offer
          </div>
          <h1 className="text-4xl font-black tracking-tight mb-2 text-white">Refer & Earn 🎉</h1>
          <p className="text-indigo-200 font-medium">Invite friends, earn ₹10 instantly + ₹40 after their first order</p>
        </div>
        <Gift className="absolute bottom-4 right-4 text-white/5 w-24 h-24 rotate-12" />
      </div>

      {/* Referral Code Card */}
      <div className="bg-[var(--color-surface-card)] rounded-[2rem] p-8 shadow-sm border border-[var(--color-surface-high)] text-center">
        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-4">Your Unique Referral Code</p>
        <div className="flex flex-col sm:flex-row items-stretch justify-center gap-3 mb-8">
          <div className="flex items-center justify-center min-w-0 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl px-8 py-4 font-black text-2xl sm:text-3xl tracking-widest text-[#1B2341] select-all">
            {refData?.code || '------'}
          </div>
          <button 
            onClick={copyCode}
            className={`group inline-flex items-center justify-center gap-2 px-6 rounded-2xl font-black text-sm transition-all duration-200 active:scale-95 shadow-lg ${
              copiedCode
                ? 'bg-emerald-500 text-white shadow-emerald-200'
                : 'bg-slate-900 text-white shadow-slate-300 hover:bg-slate-800 hover:shadow-xl hover:-translate-y-0.5'
            }`}
          >
            {copiedCode ? (
              <CheckCircle2 size={20} className="shrink-0" />
            ) : (
              <Copy size={20} className="shrink-0 transition-transform duration-200 group-hover:scale-110" />
            )}
            <span className="whitespace-nowrap">{copiedCode ? 'Copied!' : 'Copy Code'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button 
            onClick={shareOnWhatsApp}
            className="flex items-center justify-center gap-3 bg-[#25D366] text-white font-black py-4 rounded-2xl hover:brightness-105 transition-all shadow-lg shadow-green-100"
          >
            <Share2 size={20} />
            Share on WhatsApp
          </button>
          <button 
            onClick={() => copyToClipboard(refData?.referral_url, 'Link copied!')}
            className="group flex items-center justify-center gap-3 bg-slate-100 text-slate-700 font-black py-4 rounded-2xl hover:bg-slate-200 transition-all"
          >
            <Copy size={18} className="transition-transform duration-200 group-hover:scale-110" />
            Copy Referral Link
          </button>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-[var(--color-surface-card)] rounded-[2rem] p-8 shadow-sm border border-[var(--color-surface-high)]">
        <h3 className="text-xl font-black text-slate-800 mb-6">How it works</h3>
        <div className="space-y-6">
          <div className="flex gap-4">
            <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0 font-black">1</div>
            <div>
              <p className="font-bold text-slate-800">Share your referral link</p>
              <p className="text-slate-500 text-sm">Send your unique link to friends and family.</p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0 font-black">2</div>
            <div>
              <p className="font-bold text-slate-800">Friend applies your code</p>
              <p className="text-slate-500 text-sm">You both get ₹10 in your wallets the moment they apply it.</p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="w-10 h-10 bg-[#F5A623]/10 text-[#F5A623] rounded-xl flex items-center justify-center shrink-0 font-black">3</div>
            <div>
              <p className="font-bold text-slate-800">Get Rewarded</p>
              <p className="text-slate-500 text-sm">After their first order of ₹199+, you get ₹40 more and they get ₹20 more (₹50 & ₹30 total).</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[var(--color-surface-card)] rounded-[1.5rem] p-5 border border-[var(--color-surface-high)] shadow-sm text-center">
          <Users size={20} className="mx-auto text-slate-400 mb-2" />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Referrals</p>
          <p className="text-xl font-black text-slate-800">{refData?.stats?.total || 0}</p>
        </div>
        <div className="bg-[var(--color-surface-card)] rounded-[1.5rem] p-5 border border-[var(--color-surface-high)] shadow-sm text-center">
          <Trophy size={20} className="mx-auto text-[#F5A623] mb-2" />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Successful</p>
          <p className="text-xl font-black text-slate-800">{refData?.stats?.completed || 0}</p>
        </div>
        <div className="bg-[var(--color-surface-card)] rounded-[1.5rem] p-5 border border-[#F5A623]/20 bg-gradient-to-br from-[var(--color-surface-card)] to-[#F5A623]/5 shadow-sm text-center">
          <Gift size={20} className="mx-auto text-[#F5A623] mb-2" />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Earned</p>
          <p className="text-xl font-black text-[#F5A623]">₹{refData?.stats?.earnings || 0}</p>
        </div>
      </div>
    </div>
  );
};

export default ReferAndEarn;
