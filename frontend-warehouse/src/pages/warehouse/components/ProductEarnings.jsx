import {
    Wallet,
    TrendingUp,
    Clock,
    Percent,
    ArrowDownToLine,
    RefreshCw,
    ChevronLeft,
    ChevronRight,
    CheckCircle2,
    XCircle,
    Hourglass,
    Info,
    IndianRupee,
    History,
    FileText,
    X,
    AlertTriangle
} from 'lucide-react'
import { API_BASE_URL } from '../../../config'
import { useStore } from '../../../store/useStore'
import { apiFetch } from '../../../utils/apiFetch'

export default function ProductEarnings({
    newProductData,
    setNewProductData,
}) {
    return (
        <>
            {/* SECTION 5: EARNINGS */}
            <div className="warehouse-panel p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group">
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-amber-400/10 text-amber-500">
                        <Wallet size={22} />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-white uppercase tracking-tight">Earnings & Payouts</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Settlement and commission configuration</p>
                    </div>
                </div>

                <div className="space-y-4 sm:space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Commission Rate (%)</label>
                            <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={newProductData.commission_rate || ''}
                                onChange={(e) => setNewProductData(prev => ({ ...prev, commission_rate: parseFloat(e.target.value) || null }))}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Platform Fee (%)</label>
                            <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={newProductData.platform_fee || ''}
                                onChange={(e) => setNewProductData(prev => ({ ...prev, platform_fee: parseFloat(e.target.value) || null }))}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Settlement Cycle</label>
                            <select
                                value={newProductData.settlement_cycle || 'weekly'}
                                onChange={(e) => setNewProductData(prev => ({ ...prev, settlement_cycle: e.target.value }))}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 appearance-none transition-all outline-none"
                            >
                                <option value="daily">Daily</option>
                                <option value="weekly">Weekly</option>
                                <option value="biweekly">Bi-weekly</option>
                                <option value="monthly">Monthly</option>
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Minimum Payout Amount (₹)</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={newProductData.min_payout_amount || ''}
                                onChange={(e) => setNewProductData(prev => ({ ...prev, min_payout_amount: parseFloat(e.target.value) || null }))}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Auto Payout</label>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={newProductData.auto_payout}
                                    onChange={(e) => setNewProductData(prev => ({ ...prev, auto_payout: e.target.checked }))}
                                />
                                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                            </label>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 flex items-center justify-between">
                                <span>Hold Payouts on Dispute</span>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={newProductData.hold_on_dispute}
                                        onChange={(e) => setNewProductData(prev => ({ ...prev, hold_on_dispute: e.target.checked }))}
                                    />
                                    <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
</label>
                        </label>
                    </div>
                </div>
            </div>
        </>
    )
}