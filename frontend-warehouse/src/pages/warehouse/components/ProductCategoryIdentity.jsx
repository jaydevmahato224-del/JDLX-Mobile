import {
    Barcode,
    Layers,
    Store,
    Tag,
    Plus,
    X,
    Search,
    ChevronRight,
    CheckCircle2,
    XCircle,
    Clock,
    Phone,
    Package,
    Truck,
    AlertCircle,
    ArrowRight,
    Maximize,
    Layers as LayersIcon,
    RefreshCw,
} from 'lucide-react'
import { API_BASE_URL, resolveMediaUrl } from '../../../config'
import { useStore } from '../../../store/useStore'
import { apiFetch } from '../../../utils/apiFetch'

export default function ProductCategoryIdentity({
    newProductData,
    setNewProductData,
    categories,
    brands,
    setShowCreateCategoryModal,
    setShowCreateBrandModal,
    hasSubCategory,
    setHasSubCategory,
    uniqueSubCategories,
    generateRandomSku,
    editingItemId,
}) {
    return (
        <>
            {/* SECTION 2: CATEGORY & IDENTITY */}
            <div className="warehouse-panel p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group">
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-blue-400/10 text-blue-400">
                        <Barcode size={22} />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-white uppercase tracking-tight">Category & Identity</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">System identifiers and taxonomy</p>
                    </div>
                </div>

                <div className="space-y-4 sm:space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Brand Name</label>
                            <input
                                type="text"
                                list="brand-options"
                                placeholder="Select or type brand (e.g. Realme, Xiaomi)"
                                value={newProductData.brand}
                                onChange={(e) => setNewProductData(prev => ({ ...prev, brand: e.target.value }))}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                            />
                            <datalist id="brand-options">
                                <option value="None" />
                                {brands.map(b => (
                                    <option key={b.id} value={b.name} />
                                ))}
                            </datalist>
                            <button
                                type="button"
                                onClick={() => setShowCreateBrandModal(true)}
                                className="mt-2 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-amber-500 hover:text-amber-400 transition-colors"
                            >
                                <Plus size={10} />
                                Create New Brand
                            </button>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Primary Category</label>
                            <div className="relative">
                                <select
                                    required
                                    disabled={!!newProductData.product_id}
                                    value={newProductData.category_id}
                                    onChange={(e) => {
                                        const cat = categories.find(c => c.id === parseInt(e.target.value))
setNewProductData(prev => ({
                                            ...prev,
                                            category_id: e.target.value,
                                            category: cat ? cat.name : '',
                                            return_policy: (!prev.return_policy || categories.some(c => c.return_policy === prev.return_policy)) ? (cat?.return_policy || '') : prev.return_policy
                                        }))))
                                    }
                                    className={`w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all appearance-none outline-none ${newProductData.product_id ? 'opacity-70 cursor-not-allowed border-amber-400/20' : ''}`}
                                >
                                    <option value="">Select Category</option>
                                    {categories.map(cat => (
                                        <option key={cat.id} value={cat.id}>{cat.emoji ? `${cat.emoji} ` : ''}{cat.name}</option>
                                    ))}
                                </select>
                                <Layers as={LayersIcon} className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-700 pointer-events-none" size={16} />
                            </div>
                            {!newProductData.product_id && (
                                <button
                                    type="button"
                                    onClick={() => setShowCreateCategoryModal(true)}
                                    className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-amber-500 hover:text-amber-400 transition-colors mt-1 ml-1 group"
                                >
                                    <Plus size={12} className="group-hover:rotate-90 transition-transform" />
                                    Create New Category
                                </button>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Sub-Category</label>
                            {(!hasSubCategory && !newProductData.sub_category) ? (
                                <button
                                    type="button"
                                    onClick={() => setHasSubCategory(true)}
                                    className="w-full h-[52px] border border-dashed border-white/10 rounded-2xl flex items-center justify-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest hover:border-amber-400/30 hover:text-amber-400 transition-all group"
                                >
                                    <Plus size={14} className="group-hover:rotate-90 transition-transform" /> Add Sub-Category
                                </button>
                            ) : (
                                <div className="relative group/sub">
                                    <input
                                        type="text"
                                        list="subcat-options"
                                        placeholder="Select or type (e.g. Wired Headphones)"
                                        value={newProductData.sub_category}
                                        onChange={(e) => setNewProductData(prev => ({ ...prev, sub_category: e.target.value }))}
                                        className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none pr-12"
                                    />
                                    {uniqueSubCategories.length > 0 && (
                                        <datalist id="subcat-options">
                                            {uniqueSubCategories.map((sub, idx) => (
                                                <option key={idx} value={sub} />
                                            ))}
                                        </datalist>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setNewProductData(prev => ({ ...prev, sub_category: '' }))
                                            setHasSubCategory(false)
                                        }}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-rose-400 opacity-0 group-hover/sub:opacity-100 transition-all"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between ml-1">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Global SKU Code {editingItemId && <span className="text-amber-500/80 normal-case tracking-normal">🔒 Locked</span>}</label>
                                {!editingItemId && (
                                    <button
                                        type="button"
                                        onClick={generateRandomSku}
                                        className="flex items-center gap-2 text-[9px] font-black text-amber-500 uppercase tracking-widest hover:text-amber-400 transition-colors"
                                    >
                                        <RefreshCw size={12} /> Auto-Generate
                                    </button>
                                )}
                            </div>
                            <input
                                type="text"
                                placeholder="e.g. ELEC-CHG-65W"
                                value={newProductData.sku}
                                onChange={(e) => setNewProductData(prev => ({ ...prev, sku: e.target.value.toUpperCase() }))}
                                readOnly={!!editingItemId}
                                disabled={!!editingItemId}
                                className={`w-full border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold transition-all uppercase outline-none font-mono ${editingItemId ? 'bg-slate-900/80 text-slate-400 cursor-not-allowed opacity-70' : 'bg-slate-950/50 focus:outline-none focus:border-amber-400/50'}`}
                            />
                            {editingItemId && (
                                <p className="text-[9px] font-bold text-amber-500/60 uppercase tracking-widest ml-1">SKU is locked after product creation to prevent data corruption. Contact admin to change.</p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between ml-1">
                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Universal Barcode / EAN <span className="text-slate-600 font-bold lowercase tracking-normal">(Optional)</span></label>
                                {newProductData.barcode && (
                                    <span className={`text-[9px] font-black ${newProductData.barcode.length === 13 ? 'text-emerald-500' : 'text-amber-500'} uppercase tracking-widest`}>
                                        {newProductData.barcode.length}/13 Digits
                                    </span>
                                )}
                            </div>
                            <div className="relative group/input">
                                <Maximize className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-700 group-focus-within/input:text-amber-500 transition-colors" size={18} />
                                <input
                                    type="text"
                                    placeholder="Scan or enter 13-digit barcode..."
                                    value={newProductData.barcode}
                                    onChange={(e) => setNewProductData(prev => ({ ...prev, barcode: e.target.value }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 pl-14 pr-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                                />
                            </div>
                        </div>

                        <div className="pt-4 border-t border-white/5">
                            <div className="flex items-center justify-between p-4 rounded-2xl bg-amber-400/5 border border-amber-400/10">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-xl bg-amber-400/20 text-amber-500">
                                        <Layers size={16} />
                                    </div>
                                    <div>
                                        <h4 className="text-[10px] font-black text-white uppercase tracking-widest">Enable Product Variants</h4>
                                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter mt-0.5">Support multiple sizes, colors, or models</p>
                                    </div>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={newProductData.has_variants}
                                        onChange={(e) => {
                                            const enabled = e.target.checked;
                                            setNewProductData(prev => ({
                                                ...prev,
                                                has_variants: enabled,
                                                variants: enabled && prev.variants.length === 0 ? [{ id: Date.now(), name: '', sku: '', price: newProductData.price, mrp: '', stock_quantity: 0, options: {} }] : prev.variants,
                                                variant_options: enabled && prev.variant_options.length === 0 ? [] : prev.variant_options
                                            }))
                                        }}
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