import { CheckCircle2, ShieldCheck, TrendingUp, Truck } from 'lucide-react'

const ScoreCards = ({ acceptanceRate = 0, ordersAccepted = 0, completedDispatches = 0 }) => {
    const safeRate = Math.max(0, Math.min(Number(acceptanceRate) || 0, 100))

    return (
        <section className="card-glass p-4 sm:p-6 lg:p-8">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="wh-ui-label">
                        Performance
                    </p>
                    <h2 className="mt-2 wh-ui-h2 text-white mb-0">
                        Operational scorecard
                    </h2>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10 text-amber-300">
                    <TrendingUp size={20} />
                </div>
            </div>

            <div className="mt-6 warehouse-subtle-card p-5">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="wh-ui-label">
                            Acceptance rate
                        </p>
                        <p className="mt-2 text-3xl font-black tracking-tighter text-white mb-0">{safeRate}%</p>
                    </div>
                    <div className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-300">
                        Live
                    </div>
                </div>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-900/70">
                    <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-500 transition-all duration-700"
                        style={{ width: `${safeRate}%` }}
                    />
                </div>
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <div className="warehouse-subtle-card p-5">
                    <div className="flex items-center gap-2 text-slate-500">
                        <CheckCircle2 size={14} />
                        <span className="wh-ui-label">Accepted</span>
                    </div>
                    <p className="mt-2 text-2xl font-black tracking-tighter text-white mb-0">{ordersAccepted}</p>
                </div>
                <div className="warehouse-subtle-card p-5">
                    <div className="flex items-center gap-2 text-slate-500">
                        <Truck size={14} />
                        <span className="wh-ui-label">Dispatched</span>
                    </div>
                    <p className="mt-2 text-2xl font-black tracking-tighter text-white mb-0">{completedDispatches}</p>
                </div>
            </div>

            <div className="mt-7 flex items-center justify-between rounded-[24px] border border-emerald-400/14 bg-emerald-400/8 px-5 py-4">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                        <ShieldCheck size={18} />
                    </div>
                    <p className="text-sm font-medium text-white">Compliance</p>
                </div>
                <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-sm font-medium text-emerald-300">
                    Optimal
                </span>
            </div>
        </section>
    )
}

export default ScoreCards
