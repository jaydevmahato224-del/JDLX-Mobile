import { CloudRain, MapPin, ShieldCheck, Zap } from 'lucide-react'

const TerminalStatus = ({ operationsStatus, weatherStatus, pincode }) => {
    const isOpen = operationsStatus === 'open'

    return (
        <section className="warehouse-panel p-8">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="ui-label">
                        Terminal Status
                    </p>
                    <h2 className="mt-2 ui-h2 text-white mb-0">
                        {isOpen ? 'Active and online' : 'Terminal offline'}
                    </h2>
                </div>
                <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${
                        isOpen
                            ? 'border-amber-400/20 bg-amber-400/10 text-amber-300 shadow-[0_0_20px_rgba(240,185,11,0.1)]'
                            : 'border-rose-400/20 bg-rose-400/10 text-rose-300'
                    }`}
                >
                    <Zap size={20} />
                </div>
            </div>

            <div className="mt-7 flex items-center gap-3 warehouse-subtle-card px-5 py-4">
                <span className={`h-2.5 w-2.5 rounded-full ${isOpen ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]' : 'bg-rose-400'}`} />
                <span className="text-sm font-bold capitalize text-white tracking-tight">{operationsStatus} mode</span>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="warehouse-subtle-card p-5">
                    <div className="flex items-center gap-2 text-slate-500">
                        <CloudRain size={14} />
                        <span className="ui-label">Weather</span>
                    </div>
                    <p className="mt-2 text-base font-black capitalize text-white mb-0 tracking-tight">
                        {weatherStatus || 'Clear'}
                    </p>
                </div>
                <div className="warehouse-subtle-card p-5">
                    <div className="flex items-center gap-2 text-slate-500">
                        <MapPin size={14} />
                        <span className="ui-label">Location</span>
                    </div>
                    <p className="mt-2 text-base font-black text-white mb-0 tracking-tight">{pincode || 'N/A'}</p>
                </div>
            </div>

            <div className="mt-7 flex items-center gap-4 rounded-3xl border border-emerald-400/14 bg-emerald-400/8 px-6 py-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                    <ShieldCheck size={18} />
                </div>
                <p className="text-sm font-bold text-white tracking-tight">System safeguards active</p>
            </div>
        </section>
    )
}

export default TerminalStatus
