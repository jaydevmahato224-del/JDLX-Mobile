import React, { useState, useEffect } from 'react';
import { Users, Gift, CheckCircle, Clock, TrendingUp, IndianRupee, Search, Wallet } from 'lucide-react';
import { API_BASE_URL } from '../../config';

const ReferralDashboard = () => {
  const [referrals, setReferrals] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [stats, setStats] = useState({ total_liability: 0, active_wallets: 0, total_credits: 0, total_debits: 0 });
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem('adminToken') || localStorage.getItem('token');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [refRes, statsRes, rewardsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/admin/referrals`, { headers: { 'Authorization': `Bearer ${token}` } }),
          fetch(`${API_BASE_URL}/admin/wallet-stats`, { headers: { 'Authorization': `Bearer ${token}` } }),
          fetch(`${API_BASE_URL}/admin/referral-rewards`, { headers: { 'Authorization': `Bearer ${token}` } })
        ]);

        if (refRes.ok) setReferrals(await refRes.json());
        if (statsRes.ok) setStats(await statsRes.json());
        if (rewardsRes.ok) setRewards(await rewardsRes.json());
      } catch (error) {
        console.error('Failed to fetch admin referral data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [token]);

  const completedCount = referrals.filter(r => r.status === 'completed').length;
  // Actual money paid out, straight from the wallet ledger (not a formula).
  const rewardsGiven = rewards.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  // Referrals that armed their order reward but are still waiting for the
  // return/exchange/cancellation window to close.
  const pendingPayouts = referrals.filter(r => r.reward_armed === 1 && r.status === 'pending').length;

  if (loading) return <div className="p-8 text-center text-slate-400 font-bold animate-pulse">Loading Referral Analytics...</div>;

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tighter">Referrals & Wallet</h1>
          <p className="text-slate-400 text-sm font-bold uppercase tracking-widest mt-1">System-wide performance</p>
        </div>
        <div className="flex gap-2">
          <div className="bg-emerald-50 text-emerald-600 px-4 py-2 rounded-xl border border-emerald-100 flex items-center gap-2">
            <TrendingUp size={16} />
            <span className="text-sm font-black">Growth: +12%</span>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-4">
            <Users size={24} />
          </div>
          <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Total Referrals</p>
          <h4 className="text-2xl font-black text-slate-800">{referrals.length}</h4>
        </div>
        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-4">
            <CheckCircle size={24} />
          </div>
          <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Completed</p>
          <h4 className="text-2xl font-black text-slate-800">{completedCount}</h4>
        </div>
        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
          <div className="w-12 h-12 bg-[#F5A623]/10 text-[#F5A623] rounded-2xl flex items-center justify-center mb-4">
            <Gift size={24} />
          </div>
          <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Rewards Paid (ledger)</p>
          <h4 className="text-2xl font-black text-slate-800">₹{rewardsGiven.toLocaleString('en-IN')}</h4>
        </div>
        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
          <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mb-4">
            <Clock size={24} />
          </div>
          <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Pending Payouts</p>
          <h4 className="text-2xl font-black text-slate-800">{pendingPayouts}</h4>
        </div>
      </div>

      {/* Referrals Table */}
      <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-50 flex items-center justify-between">
          <h3 className="font-black text-slate-800">Recent Referrals</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
            <input
              type="text"
              placeholder="Search user..."
              className="pl-10 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold focus:outline-none focus:border-indigo-500 transition-all"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <th className="px-6 py-4">Referrer</th>
                <th className="px-6 py-4">Referred User</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Code Used</th>
                <th className="px-6 py-4">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {referrals.map((ref, idx) => (
                <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center text-[10px] font-black">
                        {ref.referrer_name?.charAt(0)}
                      </div>
                      <div>
                        <span className="text-xs font-black text-slate-700 block">{ref.referrer_name}</span>
                        <span className="text-[10px] font-bold text-slate-400">{ref.referrer_email}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-slate-100 text-slate-600 rounded-full flex items-center justify-center text-[10px] font-black">
                        {ref.referred_name?.charAt(0)}
                      </div>
                      <div>
                        <span className="text-xs font-black text-slate-700 block">{ref.referred_name}</span>
                        <span className="text-[10px] font-bold text-slate-400">{ref.referred_email}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${ref.status === 'completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                      {ref.status}
                    </span>
                    {ref.reward_due_at && ref.status === 'pending' && (
                      <span className="block mt-1 text-[9px] font-bold text-slate-400">
                        reward due {new Date(ref.reward_due_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 font-mono text-xs font-bold text-slate-400">{ref.referral_code}</td>
                  <td className="px-6 py-4 text-xs font-bold text-slate-400">
                    {new Date(ref.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reward Ledger — who got how much, when, and why */}
      <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-50 flex items-center justify-between">
          <div>
            <h3 className="font-black text-slate-800">Reward Ledger</h3>
            <p className="text-[11px] font-bold text-slate-400 mt-0.5">Every referral credit — kab, kitna, kis user ko, kaise</p>
          </div>
          <div className="flex items-center gap-2 bg-amber-50 text-amber-600 px-4 py-2 rounded-xl border border-amber-100">
            <Wallet size={16} />
            <span className="text-sm font-black">₹{rewardsGiven.toLocaleString('en-IN')} total</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                <th className="px-6 py-4">When</th>
                <th className="px-6 py-4">User</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">How (reason)</th>
                <th className="px-6 py-4">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rewards.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-xs font-bold text-slate-400">
                    No referral rewards paid yet.
                  </td>
                </tr>
              ) : rewards.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 text-xs font-bold text-slate-400 whitespace-nowrap">
                    {new Date(t.created_at).toLocaleString('en-IN', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                    })}
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs font-black text-slate-700 block">{t.name}</span>
                    <span className="text-[10px] font-bold text-slate-400">{t.email}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 text-[11px] font-black">
                      +₹{Number(t.amount).toLocaleString('en-IN')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs font-bold text-slate-600">{t.reason}</td>
                  <td className="px-6 py-4 font-mono text-[10px] font-bold text-slate-400">{t.reference_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ReferralDashboard;
