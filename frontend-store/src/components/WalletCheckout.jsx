import React, { useState, useEffect } from 'react';
import { Wallet, CheckCircle2 } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { useStore } from '../store/useStore';

const WalletCheckout = ({ onApply, totalAmount }) => {
  const [balance, setBalance] = useState(0);
  const [isApplied, setIsApplied] = useState(false);
  const token = useStore(state => state.token);

  useEffect(() => {
    const fetchBalance = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/wallet/balance`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setBalance(data.balance);
        }
      } catch (error) {
        console.error('Failed to fetch wallet balance:', error);
      }
    };

    if (token) fetchBalance();
  }, [token]);

  const toggleApply = () => {
    const nextState = !isApplied;
    setIsApplied(nextState);
    const amountToApply = nextState ? Math.min(balance, totalAmount) : 0;
    onApply(amountToApply);
  };

  if (balance <= 0) return null;

  return (
    <div className={`bg-[var(--color-surface-card)] rounded-3xl p-6 border-2 transition-all duration-300 ${isApplied ? 'border-[#F5A623] bg-orange-50/30' : 'border-[var(--color-surface-high)]'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors shrink-0 ${isApplied ? 'bg-[#F5A623] text-white shadow-lg shadow-orange-200' : 'bg-[var(--color-surface-low)] text-slate-400'}`}>
            <Wallet size={24} />
          </div>
          <div className="min-w-0">
            <p className="font-black text-[var(--color-on-surface)] tracking-tight">Wallet Balance</p>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">₹{balance.toFixed(2)} available</p>
          </div>
        </div>
        
        <button 
          onClick={toggleApply}
          className={`shrink-0 whitespace-nowrap px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${
            isApplied 
            ? 'bg-[#F5A623] text-white shadow-md' 
            : 'bg-slate-900 text-white hover:bg-slate-800'
          }`}
        >
          {isApplied ? 'Applied' : 'Apply'}
        </button>
      </div>

      {isApplied && (
        <div className="mt-4 pt-4 border-t border-orange-200/50 flex items-center gap-2 text-[#D48A12] animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 size={14} />
          <p className="text-xs font-bold">Extra ₹{Math.min(balance, totalAmount).toFixed(2)} will be deducted from your wallet</p>
        </div>
      )}
    </div>
  );
};

export default WalletCheckout;
