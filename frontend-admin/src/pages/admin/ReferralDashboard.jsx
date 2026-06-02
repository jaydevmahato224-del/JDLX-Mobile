import React, { useState, useEffect } from 'react';
import { Users, Gift, CheckCircle, Clock, TrendingUp, IndianRupee, Search } from 'lucide-react';
import { API_BASE_URL } from '../../config';

const ReferralDashboard = () => {
  const [referrals, setReferrals] = useState([]);
  const [stats, setStats] = useState({ total_liability: 0, active_wallets: 0, total_credits: 0, total_debits: 0 });
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem('adminToken') || localStorage.getItem('token');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [refRes, statsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/admin/referrals`, { headers: { 'Authorization': `Bearer ${token}` } }),
          fetch(`${API_BASE_URL}/admin/wallet-stats`, { headers: { 'Authorization': `Bearer ${token}` } })
        ]);

        if (refRes.ok) setReferrals(await refRes.json());
        if (statsRes.ok) setStats(await statsRes.json());
      } catch (error) {
        console.error('Failed to fetch admin referral data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [token]);

  const completedCount = referrals.filter(r => r.status === 'completed').length;

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
          <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Rewards Given</p>
          <h4 className="text-2xl font-black text-slate-800">₹{(completedCount * 80).toLocaleString()}</h4>
        </div>
        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100">
          <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mb-4">
            <IndianRupee size={24} />
          </div>
          <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Wallet Liability</p>
          <h4 className="text-2xl font-black text-slate-800">₹{stats.total_liability.toLocaleString()}</h4>
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
                      <span className="text-xs font-black text-slate-700">{ref.referrer_name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-slate-100 text-slate-600 rounded-full flex items-center justify-center text-[10px] font-black">
                        {ref.referred_name?.charAt(0)}
                      </div>
                      <span className="text-xs font-black text-slate-700">{ref.referred_name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${ref.status === 'completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                      {ref.status}
                    </span>
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
    </div>
  );
};

export default ReferralDashboard;
