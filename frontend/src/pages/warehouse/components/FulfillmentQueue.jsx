import { Package, PackageCheck } from 'lucide-react'

const FulfillmentQueue = ({ recentOrders }) => {
    return (
        <div className="glass-card flex flex-col h-full p-6 relative overflow-hidden group">
            <div className="flex items-end justify-between mb-6 shrink-0">
                <div>
                    <div className="flex items-center gap-2.5 mb-2.5">
                        <div className="h-1 w-5 bg-[var(--accent)]/60 rounded-full" />
                        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-[var(--text-muted)]">Logistics Pipeline</p>
                    </div>
                    <h3 className="text-2xl font-black tracking-tighter text-[var(--text-primary)] uppercase">
                        Fulfillment <span className="text-[var(--accent)] drop-shadow-[0_0_15px_rgba(234,179,8,0.25)]">Queue</span>
                    </h3>
                </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                {recentOrders.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-[var(--border-subtle)] bg-white/[0.02] rounded-[20px] text-center group/empty transition-all duration-500 hover:bg-white/[0.04]">
                        <div className="h-20 w-20 rounded-[24px] bg-[var(--bg-page)] flex items-center justify-center mb-4 border border-[var(--border-subtle)] shadow-2xl group-hover/empty:border-[var(--accent)]/30 group-hover/empty:scale-110 transition-all duration-700">
                            <Package className="h-10 w-10 text-[var(--text-muted)] group-hover/empty:text-[var(--accent)] transition-all" />
                        </div>
                        <p className="text-[11px] font-black uppercase tracking-[0.4em] text-[var(--text-muted)] leading-none italic">Terminal Idle</p>
                        <p className="text-[10px] font-bold uppercase tracking-[0.05em] text-[var(--text-muted)]/50 mt-5 px-12 leading-relaxed max-w-xs">Awaiting upstream pipeline activity to initialize loading</p>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-4 pb-4">
                        {recentOrders.map((order) => (
                            <div key={order.id} className="group/item rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-page)]/20 p-5 transition-all duration-500 hover:bg-[var(--bg-card-hover)] hover:translate-x-1">
                                <div className="flex items-center justify-between gap-5">
                                    <div className="flex items-center gap-5 min-w-0 flex-1">
                                        <div className="h-12 w-12 shrink-0 flex items-center justify-center rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] group-hover/item:border-[var(--accent)]/20 transition-all duration-500">
                                            <PackageCheck size={20} className="text-[var(--text-muted)] group-hover/item:text-[var(--accent)] transition-all" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[11px] font-black text-[var(--text-primary)] uppercase tracking-wider truncate mb-1.5">#{order.order_id}</p>
                                            <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase truncate group-hover/item:text-slate-400 transition-colors">{order.product_names}</p>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-base font-black text-[var(--text-primary)] leading-none mb-2.5 tracking-tighter">₹{order.total_amount}</p>
                                        <span className={`text-[9px] font-black uppercase tracking-[0.2em] px-3 py-1.5 rounded-lg border ${order.assignment_status === 'dispatched' ? 'text-[var(--status-success)] bg-[var(--status-success)]/10 border-[var(--status-success)]/30' : 'text-[var(--text-muted)] bg-slate-800/30 border-[var(--border-subtle)]'}`}>
                                            {order.assignment_status}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default FulfillmentQueue
