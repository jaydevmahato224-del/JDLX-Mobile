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

export default function ProductFulfillment({
    newProductData,
    setNewProductData,
}) {
    return (
        <>
            {/* SECTION 5: FULFILLMENT */}
            <div className="warehouse-panel p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group">
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-amber-400/10 text-amber-500">
                        <Wallet size={22} />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-white uppercase tracking-tight">Fulfillment</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Global and warehouse specific margins</p>
                    </div>
                </div>

                <div className="space-y-4 sm:space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Package Weight (kg)</label>
                            <div className="relative">
                                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-sm">kg</div>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={newProductData.fulfillment?.package_weight || 0}
                                    onChange={(e) => setNewProductData(prev => ({
                                        ...prev,
                                        fulfillment: { ...prev.fulfillment, package_weight: parseFloat(e.target.value) || 0 }
                                    }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 pl-14 pr-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Length (cm)</label>
                            <div className="relative">
                                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-sm">cm</div>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    value={newProductData.fulfillment?.length || 0}
                                    onChange={(e) => setNewProductData(prev => ({
                                        ...prev,
                                        fulfillment: { ...prev.fulfillment, length: parseFloat(e.target.value) || 0 }
                                    }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 pl-14 pr-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Width (cm)</label>
                            <div className="relative">
                                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-sm">cm</div>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    value={newProductData.fulfillment?.width || 0}
                                    onChange={(e) => setNewProductData(prev => ({
                                        ...prev,
                                        fulfillment: { ...prev.fulfillment, width: parseFloat(e.target.value) || 0 }
                                    }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 pl-14 pr-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Height (cm)</label>
                            <div className="relative">
                                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-sm">cm</div>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    value={newProductData.fulfillment?.height || 0}
                                    onChange={(e) => setNewProductData(prev => ({
                                        ...prev,
                                        fulfillment: { ...prev.fulfillment, height: parseFloat(e.target.value) || 0 }
                                    }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 pl-14 pr-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Dispatch SLA (hours)</label>
                            <div className="relative">
                                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-sm">hrs</div>
                                <input
                                    type="number"
                                    min="1"
                                    value={newProductData.fulfillment?.dispatch_sla || 24}
                                    onChange={(e) => setNewProductData(prev => ({
                                        ...prev,
                                        fulfillment: { ...prev.fulfillment, dispatch_sla: parseInt(e.target.value) || 24 }
                                    }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 pl-14 pr-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Return Window (days)</label>
                            <div className="relative">
                                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-sm">days</div>
                                <input
                                    type="number"
                                    min="1"
                                    value={newProductData.fulfillment?.return_window || 7}
                                    onChange={(e) => setNewProductData(prev => ({
                                        ...prev,
                                        fulfillment: { ...prev.fulfillment, return_window: parseInt(e.target.value) || 7 }
                                    }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 pl-14 pr-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Shipping Tier</label>
                            <select
                                value={newProductData.fulfillment?.shipping_tier || 'standard'}
                                onChange={(e) => setNewProductData(prev => ({
                                    ...prev,
                                    fulfillment: { ...prev.fulfillment, shipping_tier: e.target.value }
                                }))}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 appearance-none transition-all outline-none"
                            >
                                <option value="standard">Standard</option>
                                <option value="express">Express</option>
                                <option value="premium">Premium</option>
                            </select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 flex items-center justify-between">
                                <span>Fragile</span>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={newProductData.fulfillment?.is_fragile || false}
                                        onChange={(e) => setNewProductData(prev => ({
                                            ...prev,
                                            fulfillment: { ...prev.fulfillment, is_fragile: e.target.checked }
                                        }))}
                                    />
                                    <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 flex items-center justify-between">
                                <span>Temp Sensitive</span>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={newProductData.fulfillment?.is_temp_sensitive || false}
                                        onChange={(e) => setNewProductData(prev => ({
                                            ...prev,
                                            fulfillment: { ...prev.fulfillment, is_temp_sensitive: e.target.checked }
                                        }))}
                                    />
                                    <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                                </label>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 flex items-center justify-between">
                                <span>Express Eligible</span>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={newProductData.fulfillment?.is_express_eligible || false}
                                        onChange={(e) => setNewProductData(prev => ({
                                            ...prev,
                                            fulfillment: { ...prev.fulfillment, is_express_eligible: e.target.checked }
                                        }))}
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