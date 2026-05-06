import { CheckCircle2, Clock, Package, Truck } from 'lucide-react'

const CARDS = [
    {
        icon: Truck,
        key: 'totalOrdersAssigned',
        label: 'Assigned queue',
        accentClass: 'text-amber-300 border-amber-400/20 bg-amber-400/10',
    },
    {
        icon: Clock,
        key: 'pendingOrders',
        label: 'Pending action',
        accentClass: 'text-sky-300 border-sky-400/20 bg-sky-400/10',
    },
    {
        icon: Package,
        key: 'packedOrders',
        label: 'Packed units',
        accentClass: 'text-emerald-300 border-emerald-400/20 bg-emerald-400/10',
    },
    {
        icon: CheckCircle2,
        key: 'dispatchedOrders',
        label: 'Dispatched',
        accentClass: 'text-violet-300 border-violet-400/20 bg-violet-400/10',
    },
]

const StatCard = ({ icon: Icon, label, value, accentClass }) => (
    <article className="warehouse-subtle-card p-6">
        <div className="flex items-start justify-between gap-4">
            <div>
                <p className="wh-ui-label">{label}</p>
                <p className="mt-4 text-4xl font-black tracking-tighter text-white md:text-5xl">
                    {value || 0}
                </p>
            </div>
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${accentClass}`}>
                <Icon size={20} />
            </div>
        </div>
    </article>
)

const StatCards = ({ totalOrdersAssigned, pendingOrders, packedOrders, dispatchedOrders }) => {
    const values = {
        totalOrdersAssigned,
        pendingOrders,
        packedOrders,
        dispatchedOrders,
    }

    return (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
            {CARDS.map((card) => (
                <StatCard key={card.key} {...card} value={values[card.key]} />
            ))}
        </div>
    )
}

export default StatCards
