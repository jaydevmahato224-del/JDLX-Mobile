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
    AlertTriangle,
    DollarSign,
    Zap
} from 'lucide-react'
import { API_BASE_URL } from '../../../config'
import { useStore } from '../../../store/useStore'
import { apiFetch } from '../../../utils/apiFetch'

export default function ProductPricing({
    newProductData,
    setNewProductData,
    setMessage,
}) {
    return (
        <>
            {/* SECTION 4: PRICING */}
            <div className="warehouse-panel p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group">
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-amber-400/10 text-amber-500">
                        <DollarSign size={22} />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-white uppercase tracking-tight">Pricing Architecture</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Global and warehouse specific margins</p>
                    </div>
                </div>

                <div className="space-y-4 sm:space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Base Selling Price</label>
                            <div className="relative">
                                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-sm">₹</div>
                                <input
                                    required
                                    type="number"
                                    min="0"
                                    value={newProductData.price}
                                    onChange={(e) => {
                                        const s = parseFloat(e.target.value) || 0;
                                        const m = parseFloat(newProductData.mrp) || 0;
                                        setNewProductData(prev => ({
                                            ...prev,
                                            price: e.target.value,
                                            mrp: m > s ? prev.mrp : s
                                        }))
                                    }
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 pl-14 pr-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">MRP (Max Retail Price)</label>
                            <div className="relative">
                                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-sm">₹</div>
                                <input
                                    type="number"
                                    min="0"
                                    value={newProductData.mrp}
                                    onChange={(e) => setNewProductData(prev => ({ ...prev, mrp: e.target.value }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 pl-14 pr-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4 sm:space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Discount Type</label>
                                <div className="relative">
                                    <select
                                        value={newProductData.discount_pct ? 'percentage' : newProductData.discount_amt ? 'fixed' : 'percentage'}
                                        onChange={(e) => setNewProductData(prev => ({
                                            ...prev,
                                            discount_pct: e.target.value === 'percentage' ? (prev.discount_pct || 0) : null,
                                            discount_amt: e.target.value === 'fixed' ? (prev.discount_amt || 0) : null,
                                        }))}
                                        className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 pl-6 pr-12 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 appearance-none transition-all outline-none"
                                    >
                                        <option value="percentage">Percentage (%)</option>
                                        <option value="fixed">Fixed Amount (₹)</option>
                                    </select>
                                    <Zap className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-700 pointer-events-none" size={18} />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Discount Value</label>
                                <div className="relative">
                                    <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-sm">
                                        {newProductData.discount_pct ? '%' : '₹'}
                                    </div>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={newProductData.discount_pct || newProductData.discount_amt || ''}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value) || 0;
                                            setNewProductData(prev => ({
                                                ...prev,
                                                discount_pct: prev.discount_pct ? val : null,
                                                discount_amt: prev.discount_amt ? val : null,
                                            }))
                                        }}
                                        className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 pl-14 pr-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Max Discount Cap (₹)</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={newProductData.max_discount_amount || ''}
                                    onChange={(e) => setNewProductData(prev => ({ ...prev, max_discount_amount: parseFloat(e.target.value) || null }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Min Order Amount (₹)</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={newProductData.min_order_amount || ''}
                                    onChange={(e) => setNewProductData(prev => ({ ...prev, min_order_amount: parseFloat(e.target.value) || null }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Usage Limit</label>
                                <input
                                    type="number"
                                    min="1"
                                    value={newProductData.usage_limit || ''}
                                    onChange={(e) => setNewProductData(prev => ({ ...prev, usage_limit: parseInt(e.target.value) || null }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Per User Limit</label>
                                <input
                                    type="text"
                                    value={newProductData.per_user_limit || '1'}
                                    onChange={(e) => setNewProductData(prev => ({ ...prev, per_user_limit: e.target.value }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Start Date</label>
                                <input
                                    type="date"
                                    value={newProductData.start_date}
                                    onChange={(e) => setNewProductData(prev => ({ ...prev, start_date: e.target.value }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">End Date</label>
                                <input
                                    type="date"
                                    value={newProductData.end_date}
                                    onChange={(e) => setNewProductData(prev => ({ ...prev, end_date: e.target.value }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Usage Limit</label>
                                <input
                                    type="number"
                                    min="1"
                                    value={newProductData.usage_limit || ''}
                                    onChange={(e) => setNewProductData(prev => ({ ...prev, usage_limit: parseInt(e.target.value) || null }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Per User Limit</label>
                                <input
                                    type="text"
                                    value={newProductData.per_user_limit || '1'}
                                    onChange={(e) => setNewProductData(prev => ({ ...prev, per_user_limit: e.target.value }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Start Date</label>
                                <input
                                    type="date"
                                    value={newProductData.start_date}
                                    onChange={(e) => setNewProductData(prev => ({ ...prev, start_date: e.target.value }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">End Date</label>
                                <input
                                    type="date"
                                    value={newProductData.end_date}
                                    onChange={(e) => setNewProductData(prev => ({ ...prev, end_date: e.target.value }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 flex items-center justify-between">
                                <span>Active Status</span>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={newProductData.is_active}
                                        onChange={(e) => setNewProductData(prev => ({ ...prev, is_active: e.target.checked }))}
                                    />
                                    <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}