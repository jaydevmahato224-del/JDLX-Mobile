import { CloudRain, MapPin, ShieldCheck, Zap, AlertTriangle, X as CloseIcon, Check } from 'lucide-react'
import { useState } from 'react'

const TerminalStatus = ({ operationsStatus, weatherStatus, pincode, onToggleStatus, updatingStatus, quickModeEnabled, onToggleQuickMode }) => {
    const [showConfirm, setShowConfirm] = useState(false)
    const isOpen = operationsStatus === 'open'

    const handleConfirm = () => {
        onToggleStatus(isOpen ? 'closed' : 'open')
        setShowConfirm(false)
    }

    return (
        <section className="warehouse-panel p-8 relative overflow-hidden">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="wh-ui-label">
                        Terminal Status
                    </p>
                    <h2 className="mt-2 wh-ui-h2 text-white mb-0">
                        {isOpen ? 'Active and online' : 'Terminal offline'}
                    </h2>
                </div>
                <button
                    onClick={() => setShowConfirm(true)}
                    disabled={updatingStatus || showConfirm}
                    title={isOpen ? "Close Store" : "Open Store"}
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border transition-all ${
                        isOpen
                            ? 'border-amber-400/20 bg-amber-400/10 text-amber-300 shadow-[0_0_20px_rgba(240,185,11,0.1)] hover:bg-amber-400/20 hover:scale-105'
                            : 'border-rose-400/20 bg-rose-400/10 text-rose-300 hover:bg-rose-400/20 hover:scale-105'
                    } ${updatingStatus ? 'opacity-50 cursor-not-allowed scale-100' : ''}`}
                >
                    <Zap size={20} className={updatingStatus ? 'animate-pulse' : ''} />
                </button>
            </div>

            {/* Confirmation Overlay */}
            {showConfirm && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0f172a]/95 backdrop-blur-md transition-all duration-300 animate-in fade-in zoom-in-95">
                    <div className="px-6 text-center">
                        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-400/10 text-amber-400 ring-4 ring-amber-400/5">
                            <AlertTriangle size={24} />
                        </div>
                        <h3 className="text-lg font-black text-white uppercase tracking-tight">Confirm Action</h3>
                        <p className="mt-2 text-sm font-medium text-slate-400 leading-relaxed">
                            Are you sure you want to {isOpen ? 'CLOSE' : 'OPEN'} the store terminal?
                        </p>
                        <div className="mt-6 flex items-center justify-center gap-3">
                            <button
                                onClick={() => setShowConfirm(false)}
                                className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-xs font-black uppercase tracking-widest text-slate-400 hover:bg-white/10 hover:text-white transition-all"
                            >
                                <CloseIcon size={14} />
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirm}
                                className={`flex h-10 items-center gap-2 rounded-xl px-5 text-xs font-black uppercase tracking-widest text-[#0f172a] shadow-lg transition-all hover:scale-105 active:scale-95 ${
                                    isOpen ? 'bg-rose-400 hover:bg-rose-500' : 'bg-emerald-400 hover:bg-emerald-500'
                                }`}
                            >
                                <Check size={14} />
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="mt-8 flex flex-col gap-4">
                {/* Operations Mode Status */}
                <div className="flex items-center justify-between warehouse-subtle-card px-6 py-5 hover:bg-white/[0.02] transition-colors group">
                    <div className="flex items-center gap-4">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-2xl border transition-all ${
                            isOpen ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-400' : 'border-rose-400/20 bg-rose-400/10 text-rose-400'
                        }`}>
                            <Zap size={18} className={isOpen ? "fill-emerald-400/20" : ""} />
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Operations</p>
                            <p className="text-sm font-bold text-white tracking-tight">{isOpen ? 'Online & Active' : 'Offline'}</p>
                        </div>
                    </div>
                    <span className={`h-2.5 w-2.5 rounded-full ${isOpen ? 'bg-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.5)]' : 'bg-rose-400 shadow-[0_0_15px_rgba(251,113,133,0.5)]'} animate-pulse`} />
                </div>

                {/* Quick Mode Toggle - Only visible when terminal is online */}
                {isOpen && (
                    <div className="flex items-center justify-between warehouse-subtle-card px-6 py-5 hover:bg-white/[0.02] transition-colors animate-in fade-in slide-in-from-top-4 duration-500">
                        <div className="flex items-center gap-4">
                            <div className={`flex h-10 w-10 items-center justify-center rounded-2xl border transition-all ${
                                quickModeEnabled ? 'border-amber-400/20 bg-amber-400/10 text-amber-400' : 'border-slate-700/50 bg-slate-800/30 text-slate-500'
                            }`}>
                                <Zap size={18} className={quickModeEnabled ? "fill-amber-400/20" : ""} />
                            </div>
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Hyperlocal</p>
                                <p className="text-sm font-bold text-white tracking-tight">Quick Mode</p>
                            </div>
                        </div>
                        
                        <button
                            onClick={() => onToggleQuickMode(!quickModeEnabled)}
                            disabled={updatingStatus}
                            className={`group relative inline-flex h-6 w-12 shrink-0 cursor-pointer items-center rounded-full transition-all duration-300 focus:outline-none ${
                                quickModeEnabled ? 'bg-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.3)]' : 'bg-slate-700'
                            } ${updatingStatus ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-all duration-300 ease-spring ${
                                    quickModeEnabled ? 'translate-x-7' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>
                )}
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="warehouse-subtle-card p-5">
                    <div className="flex items-center gap-2 text-slate-500">
                        <CloudRain size={14} />
                        <span className="wh-ui-label">Weather</span>
                    </div>
                    <p className="mt-2 text-base font-black capitalize text-white mb-0 tracking-tight">
                        {weatherStatus || 'Clear'}
                    </p>
                </div>
                <div className="warehouse-subtle-card p-5">
                    <div className="flex items-center gap-2 text-slate-500">
                        <MapPin size={14} />
                        <span className="wh-ui-label">Location</span>
                    </div>
                    <p className="mt-2 text-base font-black text-white mb-0 tracking-tight">{pincode || 'N/A'}</p>
                </div>
            </div>

            <div className="mt-6 flex items-center gap-4 warehouse-subtle-card px-6 py-4 border-emerald-400/10">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                    <ShieldCheck size={16} />
                </div>
                <p className="text-xs font-bold text-slate-300 tracking-tight">System safeguards active</p>
            </div>
        </section>
    )
}

export default TerminalStatus
