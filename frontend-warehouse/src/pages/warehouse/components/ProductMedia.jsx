import {
    Image as ImageIcon,
    Plus,
    X,
    Camera,
    Upload,
    ArrowUpCircle,
    ArrowDownCircle,
    Eye,
    Trash2,
    CheckCircle2,
    FileText,
    ArrowUpDown,
} from 'lucide-react'
import { API_BASE_URL, resolveMediaUrl } from '../../../config'
import { useStore } from '../../../store/useStore'
import { apiFetch } from '../../../utils/apiFetch'
import { toast } from 'react-hot-toast'

export default function ProductMedia({
    newProductData,
    setNewProductData,
    handleImageUpload,
    isWarehouseImageUploading,
    fileInputRef,
}) {
    return (
        <>
            {/* SECTION 7: MEDIA */}
            <div className="warehouse-panel p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group">
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-purple-400/10 text-purple-400">
                        <ImageIcon size={22} />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-white uppercase tracking-tight">Product Media</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Images and media gallery</p>
                    </div>
                </div>

                <div className="space-y-4 sm:space-y-6">
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Product Images ({newProductData.images.length}/10) <span className="text-amber-500 ml-2">*Min 3 Required</span></label>
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
                                className={`flex items-center gap-2 text-[9px] font-black text-amber-500 uppercase tracking-widest transition-colors disabled:opacity-50 ${isWarehouseImageUploading ? 'bg-[#F5A623] text-white shadow-md' : 'bg-[var(--color-surface-low)] text-slate-400 hover:bg-slate-50 hover:text-white transition-all'}`}
                            >
                                {isWarehouseImageUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                                {isWarehouseImageUploading ? 'Uploading...' : 'Add Image(s)'}
                            </button>
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