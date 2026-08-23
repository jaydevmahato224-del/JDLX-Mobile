import React, { useState, useEffect } from 'react';
import { Wallet, ArrowUpRight, ArrowDownLeft, Clock, ShoppingBag } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { useStore } from '../store/useStore';

const WalletPage = () => {
  const [wallet, setWallet] = useState({ balance: 0, transactions: [] });
  const [loading, setLoading] = useState(true);
  const token = useStore(state => state.token);

  useEffect(() => {
    const fetchWallet = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/wallet/balance`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setWallet(data);
        }
      } catch (error) {
        console.error('Failed to fetch wallet:', error);
      } finally {
        setLoading(false);
      }
    };

    if (token) fetchWallet();
  }, [token]);

  if (loading) return <div className="flex justify-center items-center min-h-[60vh] animate-pulse text-slate-400 font-bold">Accessing Secure Wallet...</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Balance Card */}
      <div className="bg-gradient-to-br from-[#F5A623] to-[#D48A12] rounded-[2.5rem] p-10 text-white text-center shadow-2xl shadow-orange-200 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
          <svg width="100%" height="100%"><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="1"/></pattern><rect width="100%" height="100%" fill="url(#grid)" /></svg>
        </div>
        
        <div className="relative z-10">
          <p className="text-white/80 text-sm font-black uppercase tracking-[0.2em] mb-4">Total Balance</p>
          <h2 className="text-6xl font-black mb-6 tracking-tighter text-white">₹{wallet.balance.toFixed(2)}</h2>
          <div className="inline-flex items-center gap-2 bg-white/20 px-4 py-2 rounded-full backdrop-blur-md border border-white/30">
            <ShoppingBag size={14} />
            <span className="text-xs font-bold">Used at checkout automatically</span>
          </div>
        </div>
      </div>

      {/* Transaction History */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-2">
          <h3 className="text-xl font-black text-[var(--color-on-surface)]">History</h3>
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{wallet.transactions.length} Transactions</span>
        </div>

        {wallet.transactions.length === 0 ? (
          <div className="bg-[var(--color-surface-card)] rounded-[2rem] p-12 text-center border border-dashed border-[var(--color-surface-high)]">
            <div className="w-16 h-16 bg-[var(--color-surface-low)] text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
              <Clock size={32} />
            </div>
            <p className="text-slate-400 font-bold">No transactions yet</p>
            <p className="text-slate-300 text-xs mt-1">Your rewards and spends will appear here</p>
          </div>
        ) : (
          <div className="bg-[var(--color-surface-card)] rounded-[2rem] overflow-hidden shadow-sm border border-[var(--color-surface-high)]">
            {wallet.transactions.map((tx, idx) => (
              <div 
                key={idx} 
                className={`p-6 flex items-center justify-between border-b border-slate-50 last:border-0 hover:bg-[var(--color-surface-low)] transition-colors ${idx === 0 ? 'animate-in fade-in slide-in-from-top-2 duration-500' : ''}`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${tx.type === 'credit' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                    {tx.type === 'credit' ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
                  </div>
                  <div>
                    <p className="font-black text-[var(--color-on-surface)] text-sm">{tx.reason || (tx.type === 'credit' ? 'Wallet Credit' : 'Wallet Debit')}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                      {new Date(tx.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} • {new Date(tx.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
                <div className={`text-lg font-black ${tx.type === 'credit' ? 'text-emerald-600' : 'text-[var(--color-on-surface)]'}`}>
                  {tx.type === 'credit' ? '+' : '-'}₹{tx.amount.toFixed(0)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default WalletPage;
