import { Fragment } from 'react'
import {
    Warehouse,
    AlertCircle,
    CheckCircle2,
    XCircle,
    MapPin,
    Scale,
    Zap,
    Percent,
    ArrowRight,
} from 'lucide-react'
import { apiFetch } from '../../../utils/apiFetch'
import { toast } from 'react-hot-toast'

export default function ProductInventory({
    newProductData,
    setNewProductData,
    showLocationMapping,
    setShowLocationMapping,
}) {
    const locationMappingContent = (!showLocationMapping && !newProductData.rack_no && !newProductData.shelf_no && !newProductData.bin_id ? (
            <button
                type="button"
                onClick={() => setShowLocationMapping(true)}
                className="w-full py-8 border border-dashed border-white/10 rounded-3xl flex flex-col items-center justify-center gap-3 text-slate-500 hover:border-amber-400/30 hover:text-amber-400 transition-all group bg-slate-950/20"
            >
                <div className="p-3 rounded-2xl bg-white/50 backdrop-blur-sm">
                    <MapPin size={24} className="text-amber-500" />
                </div>
                <div className="text-center">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em]">Add Precision Location Mapping</span>
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">Define Rack, Shelf, and Bin Location</p>
                </div>
            </button>
        ) : (
            <div className="p-4 sm:p-6 bg-slate-950/50 rounded-3xl border border-white/5 space-y-4 sm:space-y-6 relative group/mapping">
                <button
                    type="button"
                    onClick={() => {
                        setNewProductData(prev => ({ ...prev, rack_no: '', shelf_no: '', bin_id: '', bin_location: '' }))
                        setShowLocationMapping(false)
                    }}
                    className="absolute top-4 right-4 text-slate-600 hover:text-rose-400 opacity-0 group-hover/mapping:opacity-100 transition-all"
                >
                    <X size={14} />
                </button>
                <div className="flex items-center gap-2">
                    <MapPin size={14} className="text-amber-500" />
                    <span className="text-amber-500/70 font-medium animate-pulse">Precision Location Mapping</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-2">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-600">Rack No</label>
                        <input
                            type="text" placeholder="R-01"
                            value={newProductData.rack_no}
                            onChange={(e) => setNewProductData(prev => ({ ...prev, rack_no: e.target.value.toUpperCase() }))}
                            className="w-full bg-slate-900/50 border border-white/5 rounded-xl py-3 px-4 text-xs text-white font-bold focus:outline-none focus:border-amber-400/30 transition-all outline-none"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-600">Shelf No</label>
                        <input
                            type="text" placeholder="S-04"
                            value={newProductData.shelf_no}
                            onChange={(e) => setNewProductData(prev => ({ ...prev, shelf_no: e.target.value.toUpperCase() }))}
                            className="w-full bg-slate-900/50 border border-white/5 rounded-xl py-3 px-4 text-xs text-white font-bold focus:outline-none focus:border-amber-400/30 transition-all outline-none"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-600">Bin ID</label>
                        <input
                            type="text" placeholder="B12"
                            value={newProductData.bin_id}
                            onChange={(e) => setNewProductData(prev => ({ ...prev, bin_id: e.target.value.toUpperCase() }))}
                            className="w-full bg-slate-900/50 border border-white/5 rounded-xl py-3 px-4 text-xs text-white font-bold focus:outline-none focus:border-amber-400/30 transition-all outline-none"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-600">Legacy Loc.</label>
                        <input
                            type="text" placeholder="A-01-04"
                            value={newProductData.bin_location}
                            onChange={(e) => setNewProductData(prev => ({ ...prev, bin_location: e.target.value.toUpperCase() }))}
                            className="w-full bg-slate-900/50 border border-white/5 rounded-xl py-3 px-4 text-xs text-white font-bold focus:outline-none focus:border-amber-400/30 transition-all outline-none text-slate-400"
                        />
                    </div>
                </div>
            )}
            {/* SECTION 3: INVENTORY DETAILS */}
            <div className="warehouse-panel p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-8 border-white/5 bg-slate-900/40 backdrop-blur-xl group">
                <div className="flex items-center gap-4">
                    <div className="p-3 rounded-2xl bg-emerald-400/10 text-emerald-400">
                        <Warehouse size={22} />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-white uppercase tracking-tight">Inventory Details</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Stock levels and warehouse location</p>
                    </div>
                </div>

                <div className="space-y-4 sm:space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Initial Stock Quantity</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    min="0"
                                    value={newProductData.stock_quantity}
                                    onChange={(e) => setNewProductData(prev => ({ ...prev, stock_quantity: parseInt(e.target.value) || 0 }))}
                                    className="flex-1 min-w-0 bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                                />
                                <select
                                    value={newProductData.unit}
                                    onChange={(e) => setNewProductData(prev => ({ ...prev, unit: e.target.value }))}
                                    className="w-24 bg-slate-900 border border-white/10 rounded-2xl py-4 px-2 text-[10px] font-black text-amber-500 uppercase tracking-widest focus:outline-none focus:border-amber-500 transition-all appearance-none text-center outline-none shrink-0"
                                >
                                    <option value="pcs">PCS</option>
                                    <option value="box">BOX</option>
                                    <option value="kg">KG</option>
                                    <option value="ltr">LITERS</option>
                                    <option value="set">SET</option>
                                </select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Low Stock Alert Threshold</label>
                            <div className="relative group/threshold">
                                <input
                                    type="number"
                                    min="1"
                                    value={newProductData.low_stock_threshold}
                                    onChange={(e) => setNewProductData(prev => ({ ...prev, low_stock_threshold: parseInt(e.target.value) || 2 }))}
                                    className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-rose-400/50 transition-all outline-none"
                                />
                                <span className="absolute right-6 top-1/2 -translate-y-1/2 text-[10px] font-black text-amber-500/40 uppercase tracking-widest pointer-events-none">
                                    {newProductData.unit}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Bin Location</label>
                            <input
                                type="text"
                                placeholder="e.g. A-01-04"
                                value={newProductData.bin_location}
                                onChange={(e) => setNewProductData(prev => ({ ...prev, bin_location: e.target.value.toUpperCase() }))}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Rack No</label>
                            <input
                                type="text"
                                placeholder="R-01"
                                value={newProductData.rack_no}
                                onChange={(e) => setNewProductData(prev => ({ ...prev, rack_no: e.target.value.toUpperCase() }))}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Shelf No</label>
                            <input
                                type="text"
                                placeholder="S-04"
                                value={newProductData.shelf_no}
                                onChange={(e) => setNewProductData(prev => ({ ...prev, shelf_no: e.target.value.toUpperCase() }))}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Bin ID</label>
                            <input
                                type="text"
                                placeholder="B12"
                                value={newProductData.bin_id}
                                onChange={(e) => setNewProductData(prev => ({ ...prev, bin_id: e.target.value.toUpperCase() }))}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Bin Location</label>
                            <input
                                type="text"
                                placeholder="e.g. A-01-04"
                                value={newProductData.bin_location}
                                onChange={(e) => setNewProductData(prev => ({ ...prev, bin_location: e.target.value.toUpperCase() }))}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Rack No</label>
                            <input
                                type="text"
                                placeholder="R-01"
                                value={newProductData.rack_no}
                                onChange={(e) => setNewProductData(prev => ({ ...prev, rack_no: e.target.value.toUpperCase() }))}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Shelf No</label>
                            <input
                                type="text"
                                placeholder="S-04"
                                value={newProductData.shelf_no}
                                onChange={(e) => setNewProductData(prev => ({ ...prev, shelf_no: e.target.value.toUpperCase() }))}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1">Bin ID</label>
                            <input
                                type="text"
                                placeholder="B12"
                                value={newProductData.bin_id}
                                onChange={(e) => setNewProductData(prev => ({ ...prev, bin_id: e.target.value.toUpperCase() }))}
                                className="w-full bg-slate-950/50 border border-white/10 rounded-2xl py-4 px-6 text-sm text-white font-bold focus:outline-none focus:border-amber-400/50 transition-all outline-none"
                            />
                        </div>
                    </div>

const locationMappingContent = (!showLocationMapping && !newProductData.rack_no && !newProductData.shelf_no && !newProductData.bin_id ? (
            <button
                type="button"
                onClick={() => setShowLocationMapping(true)}
                className="w-full py-8 border border-dashed border-white/10 rounded-3xl flex flex-col items-center justify-center gap-3 text-slate-500 hover:border-amber-400/30 hover:text-amber-400 transition-all group bg-slate-950/20"
            >
                <div className="p-3 rounded-2xl bg-white/50 backdrop-blur-sm">
                    <MapPin size={24} className="text-amber-500" />
                </div>
                <div className="text-center">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em]">Add Precision Location Mapping</span>
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">Define Rack, Shelf, and Bin Location</p>
                </div>
            </button>
        ) : (
            <div className="p-4 sm:p-6 bg-slate-950/50 rounded-3xl border border-white/5 space-y-4 sm:space-y-6 relative group/mapping">
                <button
                    type="button"
                    onClick={() => {
                        setNewProductData(prev => ({ ...prev, rack_no: '', shelf_no: '', bin_id: '', bin_location: '' }))
                        setShowLocationMapping(false)
                    }}
                    className="absolute top-4 right-4 text-slate-600 hover:text-rose-400 opacity-0 group-hover/mapping:opacity-100 transition-all"
                >
                    <X size={14} />
                </button>
                <div className="flex items-center gap-2">
                    <MapPin size={14} className="text-amber-500" />
                    <span className="text-amber-500/70 font-medium animate-pulse">Precision Location Mapping</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-2">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-600">Rack No</label>
                        <input
                            type="text" placeholder="R-01"
                            value={newProductData.rack_no}
                            onChange={(e) => setNewProductData(prev => ({ ...prev, rack_no: e.target.value.toUpperCase() }))}
                            className="w-full bg-slate-900/50 border border-white/5 rounded-xl py-3 px-4 text-xs text-white font-bold focus:outline-none focus:border-amber-400/30 transition-all outline-none"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-600">Shelf No</label>
                        <input
                            type="text" placeholder="S-04"
                            value={newProductData.shelf_no}
                            onChange={(e) => setNewProductData(prev => ({ ...prev, shelf_no: e.target.value.toUpperCase() }))}
                            className="w-full bg-slate-900/50 border border-white/5 rounded-xl py-3 px-4 text-xs text-white font-bold focus:outline-none focus:border-amber-400/30 transition-all outline-none"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-600">Bin ID</label>
                        <input
                            type="text" placeholder="B12"
                            value={newProductData.bin_id}
                            onChange={(e) => setNewProductData(prev => ({ ...prev, bin_id: e.target.value.toUpperCase() }))}
                            className="w-full bg-slate-900/50 border border-white/5 rounded-xl py-3 px-4 text-xs text-white font-bold focus:outline-none focus:border-amber-400/30 transition-all outline-none"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-600">Legacy Loc.</label>
                        <input
                            type="text" placeholder="A-01-04"
                            value={newProductData.bin_location}
                            onChange={(e) => setNewProductData(prev => ({ ...prev, bin_location: e.target.value.toUpperCase() }))}
                            className="w-full bg-slate-900/50 border border-white/5 rounded-xl py-3 px-4 text-xs text-white font-bold focus:outline-none focus:border-amber-400/30 transition-all outline-none text-slate-400"
                        />
                    </div>
                </div>
            )}                    </div>
                </div>
            </div>
        </>
    )
}
