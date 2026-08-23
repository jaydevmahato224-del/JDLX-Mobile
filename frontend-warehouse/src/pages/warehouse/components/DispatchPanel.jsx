import { PackageCheck, ArrowRight } from 'lucide-react'

const DispatchPanel = ({ packedOrders, onDispatchAll }) => {
    return (
        <div className="group relative overflow-hidden rounded-[24px] border border-white/5 bg-[var(--bg-card)] backdrop-blur-[12px] p-4 sm:p-6 lg:p-8 transition-all duration-500 hover:bg-[var(--bg-card-hover)] flex flex-col sm:flex-row items-center justify-between gap-10 shadow-2xl">
            <div className="flex items-center gap-4 sm:gap-6 min-w-0">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)]/10 border border-[var(--accent)]/20 group-hover:scale-105 transition-transform duration-700 shadow-[0_0_30px_rgba(255,215,0,0.1)]">
                    <PackageCheck className="h-8 w-8 text-[var(--accent)]" />
                </div>
                <div className="min-w-0">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500 mb-2 flex items-center gap-2.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                        Ready for Release
                    </h4>
                    <div className="flex items-baseline gap-2.5">
                        <span className="text-4xl font-black text-[var(--text-primary)] leading-none tracking-tighter italic">{packedOrders || '0'}</span>
                        <span className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em] italic opacity-50">Units Manifested</span>
                    </div>
                </div>
            </div>
            
            <button 
                onClick={onDispatchAll}
                disabled={!packedOrders}
                className="h-[52px] px-10 rounded-xl bg-[var(--accent)] text-slate-950 text-[11px] font-black uppercase tracking-[0.2em] relative overflow-hidden group/btn hover:scale-[1.03] active:scale-95 disabled:opacity-30 disabled:grayscale transition-all shadow-[0_12px_40px_rgba(255,215,0,0.3)] shrink-0 flex items-center justify-center whitespace-nowrap min-w-[200px]"
            >
                <div className="absolute inset-0 bg-white/20 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-500" />
                <span className="relative z-10 flex items-center gap-2">
                    Dispatch Units <ArrowRight size={14} strokeWidth={3} />
                </span>
            </button>
        </div>
    )
}

export default DispatchPanel
