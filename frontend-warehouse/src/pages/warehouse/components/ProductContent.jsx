import {
    FileText,
    ShieldCheck,
    CheckCircle2,
    Clock,
    ArrowUpRight,
    ArrowDownRight,
    Package,
    Zap,
    Image as ImageIcon,
    Calendar,
    Target,
    Box,
    Check,
    X,
    ArrowRight,
} from 'lucide-react'
import { API_BASE_URL, resolveMediaUrl } from '../../../config'
import { useStore } from '../../../store/useStore'
import { apiFetch } from '../../../utils/apiFetch'
import { toast } from 'react-hot-toast'

export default function ProductContent({
    newProductData,
    setNewProductData,
}) {
    return (
        <>
            {/* SECTION 7: CONTENT */}
            <div className="warehouse-panel p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group">
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-purple-400/10 text-purple-400">
                        <FileText size={22} />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-white uppercase tracking-tight">Rich Content</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Detailed product information for customers</p>
                    </div>
                </div>

                <div className="space-y-4 sm:space-y-6">
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Overview</label>
                        <textarea
                            rows="5"
                            placeholder="Product overview and key selling points..."
                            value={newProductData.content?.overview || ''}
                            onChange={(e) => setNewProductData(prev => ({
                                ...prev,
                                content: { ...prev.content, overview: e.target.value }
                            }))}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-purple-400/50 focus:ring-4 focus:ring-purple-400/5 transition-all resize-none outline-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Highlights (one per line)</label>
                        <textarea
                            rows="5"
                            placeholder="Key feature 1&#10;Key feature 2&#10;Key feature 3..."
                            value={newProductData.content?.highlights?.join('\n') || ''}
                            onChange={(e) => setNewProductData(prev => ({
                                ...prev,
                                content: {
                                    ...prev.content,
                                    highlights: e.target.value.split('\n').map(s => s.trim()).filter(Boolean)
                                }
                            }))}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-purple-400/50 focus:ring-4 focus:ring-purple-400/5 transition-all resize-none outline-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Specifications (key: value per line)</label>
                        <textarea
                            rows="6"
                            placeholder="Weight: 200g&#10;Dimensions: 10x5x3cm&#10;Material: Premium Glass&#10;Warranty: 1 Year"
                            value={Object.entries(newProductData.content?.specifications || {}).map(([k, v]) => `${k}: ${v}`).join('\n')}
                            onChange={(e) => {
                                const specs = {};
                                e.target.value.split('\n').forEach(line => {
                                    const [key, ...rest] = line.split(':');
                                    if (key && rest.length) specs[key.trim()] = rest.join(':').trim();
                                });
                                setNewProductData(prev => ({
                                    ...prev,
                                    content: { ...prev.content, specifications: specs }
                                }))
                            }}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-purple-400/50 focus:ring-4 focus:ring-purple-400/5 transition-all resize-none outline-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Compatibility</label>
                        <textarea
                            rows="4"
                            placeholder="Compatible with iPhone 12+, Samsung Galaxy S21+, etc."
                            value={newProductData.content?.compatibility || ''}
                            onChange={(e) => setNewProductData(prev => ({
                                ...prev,
                                content: { ...prev.content, compatibility: e.target.value }
                            }))}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-purple-400/50 focus:ring-4 focus:ring-purple-400/5 transition-all resize-none outline-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Box Contents (one per line)</label>
                        <textarea
                            rows="4"
                            placeholder="1x Charger&#10;1x USB-C Cable&#10;1x User Manual&#10;1x Warranty Card"
                            value={newProductData.content?.box_contents?.join('\n') || ''}
                            onChange={(e) => setNewProductData(prev => ({
                                ...prev,
                                content: {
                                    ...prev.content,
                                    box_contents: e.target.value.split('\n').map(s => s.trim()).filter(Boolean)
                                }
                            }))}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-purple-400/50 focus:ring-4 focus:ring-purple-400/5 transition-all resize-none outline-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Warranty Info</label>
                        <textarea
                            rows="3"
                            placeholder="1 Year Manufacturer Warranty. Covers manufacturing defects..."
                            value={newProductData.content?.warranty_info || ''}
                            onChange={(e) => setNewProductData(prev => ({
                                ...prev,
                                content: { ...prev.content, warranty_info: e.target.value }
                            }))}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-purple-400/50 focus:ring-4 focus:ring-purple-400/5 transition-all resize-none outline-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Usage Instructions (one per line)</label>
                        <textarea
                            rows="4"
                            placeholder="1. Connect to power source&#10;2. Connect device via USB-C&#10;3. Charging begins automatically"
                            value={newProductData.content?.usage_instructions?.join('\n') || ''}
                            onChange={(e) => setNewProductData(prev => ({
                                ...prev,
                                content: {
                                    ...prev.content,
                                    usage_instructions: e.target.value.split('\n').map(s => s.trim()).filter(Boolean)
                                }
                            }))}
                            className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-purple-400/50 focus:ring-4 focus:ring-purple-400/5 transition-all resize-none outline-none"
                        />
                    </div>
                </div>
            </div>
        </>
    )
}