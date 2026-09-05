import {
    Star,
    Zap,
    Plus,
    X,
    ArrowRight,
    CheckCircle2,
    Trash2,
    Search,
    ChevronRight,
    ChevronLeft,
    ChevronDown,
    ChevronUp,
    ShieldCheck,
    Link2,
    Settings,
    ArrowUpRight,
    Cross,
    Calendar,
    Sun,
} from 'lucide-react'
import { API_BASE_URL, resolveMediaUrl } from '../../../config'
import { useStore } from '../../../store/useStore'
import VariantManager from './VariantManager'
import { apiFetch } from '../../../utils/apiFetch'
import { toast } from 'react-hot-toast'

const OFFER_TYPE_META = {
    related: { label: 'Related Products', icon: 'link' },
    upsell: { label: 'Upsell Products', icon: 'arrow-up-right' },
    cross_sell: { label: 'Cross-sell Products', icon: 'cross' },
    seasonal: { label: 'Seasonal', icon: 'calendar' },
    daily: { label: 'Daily', icon: 'sun' },
}

const ICON_MAP = {
    link: <Link2 size={16} />,
    'arrow-up-right': <ArrowUpRight size={16} />,
    cross: <Cross size={16} />,
    calendar: <Calendar size={16} />,
    sun: <Sun size={16} />,
}

export default function ProductRecommendations({
    newProductData,
    setNewProductData,
    recSearchTarget,
    setRecSearchTarget,
    productSearch,
    setProductSearch,
    foundProducts,
    categories,
}) {
    return (
        <>
            {/* SECTION 8: RECOMMENDATIONS */}
            <div className="warehouse-panel p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group">
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-violet-400/10 text-violet-400">
                        <Zap size={22} />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-white uppercase tracking-tight">Smart Recommendations</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Cross-sell, upsell, and bundle opportunities</p>
                    </div>
                </div>

                <div className="space-y-4 sm:space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                        {[
                            { type: 'related', label: 'Related Products', icon: 'link' },
                            { type: 'upsell', label: 'Upsell Products', icon: 'arrow-up-right' },
                            { type: 'cross_sell', label: 'Cross-sell Products', icon: 'cross' },
                            { type: 'seasonal', label: 'Seasonal', icon: 'calendar' },
                            { type: 'daily', label: 'Daily', icon: 'sun' },
                        ].map((type) => (
                            <div key={type.type} className="p-4 rounded-[24px] bg-slate-950/40 border border-white/5 flex flex-col gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 rounded-2xl bg-violet-400/10 text-violet-400">
                                        {type.type === 'related' && <Link2 size={22} />}
                                        {type.type === 'upsell' && <ArrowUpRight size={22} />}
                                        {type.type === 'cross_sell' && <Cross size={22} />}
                                        {type.type === 'seasonal' && <Calendar size={22} />}
                                        {type.type === 'daily' && <Sun size={22} />}
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black text-white uppercase tracking-tight">{type.label}</h3>
                                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">AI-powered recommendations</p>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    {newProductData.recommendations[type.type].map((id, idx) => (
                                        <div key={idx} className="flex items-center gap-3 p-3 rounded-2xl bg-slate-950/40 border border-white/5 hover:bg-white/5 transition-all group">
                                            <div className="w-12 h-12 rounded-lg bg-slate-800 overflow-hidden flex-shrink-0">
                                                <img src={resolveMediaUrl(foundProducts.find(p => p.id === id)?.images?.[0])} alt="" className="w-full h-full object-cover" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-[11px] font-bold text-white truncate">{foundProducts.find(p => p.id === id)?.name || 'Loading...'}</p>
                                                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter mt-1">{foundProducts.find(p => p.id === id)?.category || 'N/A'}</div>
                                            </div>
<button
                                                onClick={() => setNewProductData(prev => ({
                    ...prev,
                    recommendations: {
                        ...prev.recommendations,
                        [type.type]: prev.recommendations[type.type].filter(v => v !== id)
                    }
                }))}
                    className="ml-auto p-1.5 rounded-xl text-rose-400/50 hover:bg-rose-500 hover:text-white transition-all opacity-0 group-hover:opacity-100 group-hover:bg-rose-500 group-hover:text-white"
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Recommendation Search Overlay */}
                    {recSearchTarget && (
                        <div
                            className="fixed inset-0 z-[200]"
                            onClick={() => setRecSearchTarget(null)}
                        >
                            <div
                                className="fixed w-[320px] max-h-[400px] bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-y-auto animate-in fade-in zoom-in-95 duration-200"
                                style={{
                                    top: Math.min(window.innerHeight - 420, recSearchTarget.rect.bottom + 10),
                                    left: recSearchTarget.rect.left
                                }}
                                onClick={e => e.stopPropagation()}
                            >
                                <div className="p-3 border-b border-white/5 bg-slate-950/50 sticky top-0">
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                                        <input
                                            autoFocus
                                            type="text"
                                            placeholder="Filter products..."
                                            value={productSearch}
                                            onChange={(e) => setProductSearch(e.target.value)}
                                            className="w-full bg-slate-950 border border-white/10 rounded-xl py-2 pl-9 pr-4 text-xs text-white font-bold focus:outline-none"
                                        />
                                    </div>
                                </div>
                                <div className="p-2 space-y-1">
                                    {(productSearch ? [...foundProducts, ...inventory.map(i => ({ id: i.product_id, name: i.product_name, images: i.images, brand: i.brand }))] : inventory.map(i => ({ id: i.product_id, name: i.product_name, images: i.images, brand: i.brand })))
                                        .filter((p, idx, self) => self.findIndex(t => t.id === p.id) === idx)
                                        .filter(p => p.name?.toLowerCase().includes(productSearch.toLowerCase()))
                                        .slice(0, 50)
                                        .map(prod => (
                                            <button
                                                key={prod.id}
                                                type="button"
                                                disabled={newProductData.recommendations[recSearchTarget.type].includes(prod.id)}
                                                onClick={() => {
                                                    setNewProductData(prev => ({
                                                        ...prev,
                                                        recommendations: {
                                                            ...prev.recommendations,
                                                            [recSearchTarget.type]: [...prev.recommendations[recSearchTarget.type], prod.id]
                                                        }
                                                    });
                                                    setProductSearch('');
                                                    setRecSearchTarget(null);
                                                }}/>
                                                className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <div className="w-10 h-10 rounded-lg bg-slate-800 overflow-hidden flex-shrink-0">
                                                    <img src={resolveMediaUrl(prod.images?.[0])} alt="" className="w-full h-full object-cover" />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="text-[11px] font-bold text-white truncate">{prod.name}</div>
                                                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">{prod.category || 'N/A'}</div>
                                                </div>
                                                {newProductData.recommendations[recSearchTarget.type].includes(prod.id) && (
                                                    <CheckCircle2 size={14} className="ml-auto text-emerald-500" />
                                                )}
                                            </button>
                                        ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}