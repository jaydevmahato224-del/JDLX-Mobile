import { AlertTriangle, CheckCircle2 } from 'lucide-react'

const InventoryAlerts = ({ lowStockCount }) => {
    const hasAlerts = lowStockCount > 0

    return (
        <section className="warehouse-panel p-8">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <p className="wh-ui-label">
                        Inventory Health
                    </p>
                    <h2 className="mt-2 wh-ui-h2 text-white mb-0">
                        {hasAlerts ? 'Low stock attention needed' : 'Stock levels are healthy'}
                    </h2>
                </div>
                <div
                    className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${
                        hasAlerts
                            ? 'border-rose-400/20 bg-rose-400/10 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.1)]'
                            : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                    }`}
                >
                    {hasAlerts ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}
                </div>
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center">
                <div className="warehouse-subtle-card p-5">
                    <p className="wh-ui-label">
                        Alert count
                    </p>
                    <p className="mt-2 text-4xl font-black text-white mb-0 tracking-tighter">{lowStockCount || 0}</p>
                </div>
                <div className="warehouse-subtle-card p-6">
                    <p className={`text-sm font-bold tracking-tight ${hasAlerts ? 'text-rose-300' : 'text-emerald-300'}`}>
                        {hasAlerts ? 'Attention required - check inventory nodes' : 'No active alerts in this zone'}
                    </p>
                </div>
            </div>
        </section>
    )
}

export default InventoryAlerts
