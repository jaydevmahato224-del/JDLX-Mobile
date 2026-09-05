import {
    FileText,
    Zap,
    Barcode,
    Layers,
    Store,
    Tag,
    Plus,
    X,
    RefreshCw,
    Image as ImageIcon,
    Upload,
    Loader2,
} from 'lucide-react'
import { API_BASE_URL, resolveMediaUrl } from '../../../config'
import { useStore } from '../../../store/useStore'
import { apiFetch } from '../../../utils/apiFetch'

export default function ProductBasicInfo({
    newProductData,
    setNewProductData,
    handleImageUpload,
    isWarehouseImageUploading,
    fileInputRef,
    editingItemId,
    setShowCreateCategoryModal,
    categories,
    brands,
    setShowCreateBrandModal,
    hasSubCategory,
    setHasSubCategory,
    uniqueSubCategories,
    generateRandomSku,
}) {
    return (
        <>
            {/* SECTION 1: BASIC INFORMATION */}
            <div className="warehouse-panel p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-1">
                    <div className="w-20 h-20 bg-amber-400/5 blur-3xl rounded-full" />
                </div>

                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-amber-400/10 text-amber-500">
                        <FileText size={22} />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-white uppercase tracking-tight">Basic Information</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Foundational product details</p>
                    </div>
                </div>

                <div className="space-y-4 sm:space-y-6">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between ml-1">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Product Name</label>
                            {newProductData.product_id && (
                                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-500 text-[9px] font-black uppercase tracking-tighter border border-amber-400/20">
                                    <Zap size={8} /> Catalog Linked
                                                </span>
                                            )}
                                        </div>
                                        <input
                                            required
                                            type="text"
                                            placeholder="e.g. Ultra Fast Charger 65W"
                                            value={newProductData.name}
                                            onChange={(e) => setNewProductData(prev => ({ ...prev, name: e.target.value }))}
                                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Description / Spec Sheet</label>
                                        <textarea
                                            rows="4"
                                            placeholder="Detailed specifications, features, and model info..."
                                            value={newProductData.description}
                                            onChange={(e) => setNewProductData(prev => ({ ...prev, description: e.target.value }))}
                                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all resize-none outline-none"
                                            />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Material Type</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. Premium Glass, Silicone"
                                                value={newProductData.material_type}
                                                onChange={(e) => setNewProductData(prev => ({ ...prev, material_type: e.target.value }))}
                                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Product Color</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. Midnight Blue, Jet Black, Rose Gold"
                                                value={newProductData.color}
                                                onChange={(e) => setNewProductData(prev => ({ ...prev, color: e.target.value }))}
                                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 flex items-center justify-between">
                                            <span>Return Policy <span className="text-amber-500">*Mandatory</span></span>
                                            <span className="text-[9px] text-slate-500 normal-case font-bold italic">Enter each point in a new line</span>
                                        </label>
                                        <textarea
                                            required
                                            rows="3"
                                            placeholder="1. 7 Days Replacement&#10;2. Original packaging required"
                                            value={newProductData.return_policy}
                                            onChange={(e) => setNewProductData(prev => ({ ...prev, return_policy: e.target.value }))}
                                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none resize-none"
                                            />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">How to Use Instructions</label>
                                        <textarea
                                            rows="3"
                                            placeholder="Step-by-step usage instructions for customers..."
                                            value={newProductData.usage_instructions}
                                            onChange={(e) => setNewProductData(prev => ({ ...prev, usage_instructions: e.target.value }))}
                                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 focus:ring-4 focus:ring-amber-400/5 transition-all outline-none resize-none"
                                            />
                                        </div>

                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between ml-1">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Product Images ({newProductData.images.length}/10) <span className="text-amber-500 ml-2">*Min 3 Required</span></label>
                                                <div className="flex items-center gap-4">
                                                    <input
                                                        type="file"
                                                        hidden
                                                        multiple
                                                        ref={fileInputRef}
                                                        accept="image/*"
                                                        onChange={handleImageUpload}
                                                    />
                                                    <button
                                                        type="button"
                                                        disabled={isWarehouseImageUploading || newProductData.images.length >= 10}
                                                        onClick={() => fileInputRef.current?.click()}
                                                        className="flex items-center gap-2 text-[9px] font-black text-amber-500 uppercase tracking-widest hover:text-amber-400 transition-colors disabled:opacity-50"
                                                    >
                                                        {isWarehouseImageUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                                                        {isWarehouseImageUploading ? 'Uploading...' : 'Add Image(s)'}
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                                {newProductData.images.map((imgUrl, idx) => {
                                                    const src = resolveMediaUrl(imgUrl);
                                                    return (
                                                        <div key={idx} className="relative aspect-square rounded-2xl bg-slate-950 border border-white/10 flex items-center justify-center overflow-hidden group shadow-inner">
                                                            <img src={src} alt={`Preview ${idx + 1}`} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                                                            <button
                                                                type="button"
                                                                onClick={() => setNewProductData(prev => ({ ...prev, images: prev.images.filter((_, i) => i !== idx) }))}
                                                                className="absolute top-2 right-2 bg-slate-950/80 text-rose-400 p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-all hover:bg-rose-500 hover:text-white"
                                                            >
                                                                <X size={12} />
                                                            </button>
                                                        </div>
                                                    )
                                                })}
                                                {newProductData.images.length < 10 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => fileInputRef.current?.click()}
                                                        className="aspect-square rounded-2xl border border-dashed border-white/10 flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-amber-400 hover:border-amber-400/30 transition-all bg-white/[0.02]"
                                                    >
                                                        <Plus size={24} />
                                                        <span className="text-[10px] font-bold uppercase tracking-widest">Add Image</span>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
        )
    }