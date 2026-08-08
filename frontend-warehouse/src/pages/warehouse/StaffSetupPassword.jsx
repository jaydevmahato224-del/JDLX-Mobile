import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { KeyRound, ShieldCheck, ArrowRight, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../../config';
import { useStore } from '../../store/useStore';

export default function StaffSetupPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!token) {
      setErrorMessage('Invalid setup link. Token is missing.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/warehouse/staff/setup-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Failed to setup password');
      }

      // Store JWT & user info upon successful setup — sync the shared store so
      // the route guard (WarehouseRoute) recognizes the fresh staff session.
      if (data.token) {
        localStorage.setItem('warehouse_token', data.token);
        localStorage.setItem('staff_token', data.token);
        localStorage.setItem('warehouseToken', data.token);
        if (data.user) {
          localStorage.setItem('warehouse_user', JSON.stringify(data.user));
          localStorage.setItem('warehouseUser', JSON.stringify(data.user));
          useStore.getState().setWarehouseUser(data.user, data.token);
        }
      }

      setSuccess(true);
      toast.success('Password generated successfully!');
      setTimeout(() => {
        navigate('/warehouse/billing', { replace: true });
      }, 1500);
    } catch (err) {
      console.error('Password setup error:', err);
      setErrorMessage(err.message || 'Password setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
        {/* Decorative ambient background glow */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl" />

        <div className="text-center mb-8 relative z-10">
          <div className="w-16 h-16 bg-gradient-to-tr from-indigo-600 to-emerald-500 p-0.5 rounded-2xl mx-auto mb-4 shadow-lg flex items-center justify-center">
            <div className="w-full h-full bg-slate-900 rounded-[14px] flex items-center justify-center text-indigo-400">
              <KeyRound className="w-8 h-8" />
            </div>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white mb-2">First-Time Agent Setup</h1>
          <p className="text-xs text-slate-400">Generate your account password to unlock Billing & POS access</p>
        </div>

        {success ? (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6 text-center space-y-3 relative z-10 animate-in fade-in">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
            <h2 className="text-lg font-bold text-white">Password Activated!</h2>
            <p className="text-xs text-slate-300">Your account is ready. Redirecting you to the POS Billing Dashboard...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
            {errorMessage && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-xl text-xs flex items-center gap-2">
                <XCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">New Password</label>
              <input
                type="password"
                required
                placeholder="Enter at least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">Confirm Password</label>
              <input
                type="password"
                required
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !token}
              className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white font-bold rounded-xl text-sm shadow-xl flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating Password...
                </>
              ) : (
                <>
                  Activate & Log In <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
