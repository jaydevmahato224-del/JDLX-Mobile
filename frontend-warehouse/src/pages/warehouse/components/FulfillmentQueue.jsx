import { Box, Check, Package, PackageCheck, Play } from 'lucide-react'

const getStatusStyles = (status) => {
    switch (status) {
        case 'dispatched':
            return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
        case 'packed':
            return 'border-sky-400/20 bg-sky-400/10 text-sky-300'
        case 'packing':
            return 'border-amber-400/20 bg-amber-400/10 text-amber-300'
        case 'accepted':
            return 'border-violet-400/20 bg-violet-400/10 text-violet-300'
        case 'assigned':
            return 'border-white/10 bg-white/[0.04] text-slate-300'
        default:
            return 'border-white/10 bg-white/[0.04] text-slate-400'
    }
}

const getActionButtonClass = (tone) => {
    switch (tone) {
        case 'accept':
            return 'border-violet-400/20 bg-violet-400/10 text-violet-200 hover:bg-violet-400/18'
        case 'pack':
            return 'border-amber-400/20 bg-amber-400/10 text-amber-200 hover:bg-amber-400/18'
        case 'ready':
            return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/18'
        default:
            return 'border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]'
    }
}

const FulfillmentQueue = ({ recentOrders = [], onUpdateStatus, updatingOrderId = null }) => {
    const renderActions = (order) => {
        const { id, assignment_status: status } = order
        const isUpdating = updatingOrderId === id

        if (status === 'assigned') {
            return (
                <button
                    onClick={() => onUpdateStatus(id, 'accepted')}
                    disabled={isUpdating}
                    className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${getActionButtonClass('accept')}`}
                >
                    <Play size={15} />
                    {isUpdating ? 'Saving...' : 'Accept'}
                </button>
            )
        }

        if (status === 'accepted') {
            return (
                <button
                    onClick={() => onUpdateStatus(id, 'packing')}
                    disabled={isUpdating}
                    className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${getActionButtonClass('pack')}`}
                >
                    <Box size={15} />
                    {isUpdating ? 'Saving...' : 'Start packing'}
                </button>
            )
        }

        if (status === 'packing') {
            return (
                <button
                    onClick={() => onUpdateStatus(id, 'packed')}
                    disabled={isUpdating}
                    className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${getActionButtonClass('ready')}`}
                >
                    <Check size={15} />
                    {isUpdating ? 'Saving...' : 'Mark packed'}
                </button>
            )
        }

        return null
    }

    return (
        <section className="warehouse-panel flex min-h-[700px] flex-col p-8">
            <div className="flex flex-col gap-6 border-b border-white/5 pb-8 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p className="wh-ui-label">
                        Fulfillment Queue
                    </p>
                    <h2 className="mt-2 wh-ui-h1 text-white mb-0">
                        Active warehouse tasks
                    </h2>
                </div>
                <div className="warehouse-subtle-card p-5 min-w-[160px] border-amber-400/20 bg-amber-400/5">
                    <p className="wh-ui-label text-amber-500/80">
                        Visible items
                    </p>
                    <p className="mt-1 text-3xl font-black text-white mb-0 tracking-tighter">{recentOrders.length}</p>
                </div>
            </div>

            <div className="mt-10 flex-1 min-h-0">
                {recentOrders.length === 0 ? (
                    <div className="flex h-full min-h-[500px] flex-col items-center justify-center rounded-[32px] border border-dashed border-white/10 bg-white/[0.02] px-10 text-center">
                        <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-white/10 bg-white/5 text-slate-500">
                            <Package size={34} />
                        </div>
                        <h3 className="mt-8 text-2xl font-bold tracking-tight text-white">
                            No active queue items
                        </h3>
                    </div>
                ) : (
                    <div className="flex flex-col gap-6 pr-1">
                        {recentOrders.map((order) => (
                            <article
                                key={order.id}
                                className="warehouse-subtle-card p-6 transition-all hover:translate-x-1"
                            >
                                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                                    <div className="flex min-w-0 gap-4">
                                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] border border-white/10 bg-white/[0.03] text-amber-300">
                                            <PackageCheck size={22} />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-3">
                                                <h3 className="text-xl font-bold tracking-tight text-white">
                                                    Order #{order.order_id}
                                                </h3>
                                                <span
                                                    className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${getStatusStyles(order.assignment_status)}`}
                                                >
                                                    {order.assignment_status}
                                                </span>
                                                {order.delivery_type && (
                                                    <span
                                                        className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                                                            order.delivery_type === 'quick' 
                                                            ? 'border-amber-400/20 bg-amber-400/10 text-amber-400' 
                                                            : 'border-blue-400/20 bg-blue-400/10 text-blue-400'
                                                        }`}
                                                    >
                                                        {order.delivery_type}
                                                    </span>
                                                )}
                                            </div>

                                            {order.product_names || order.products ? (
                                                <p className="mt-2 text-sm leading-6 text-slate-400">
                                                    {order.product_names || order.products}
                                                </p>
                                            ) : null}
                                        </div>
                                    </div>

                                    <div className="grid gap-4 sm:grid-cols-[140px_auto] sm:items-center">
                                        <div>
                                            <p className="wh-ui-label">
                                                Order value
                                            </p>
                                            <p className="mt-2 text-2xl font-black text-white tracking-tighter">
                                                Rs {order.total_amount}
                                            </p>
                                        </div>
                                        <div className="flex justify-start sm:justify-end">{renderActions(order)}</div>
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </div>
        </section>
    )
}

export default FulfillmentQueue
