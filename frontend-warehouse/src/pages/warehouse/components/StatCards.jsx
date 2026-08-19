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

// eslint-disable-next-line no-unused-vars -- Icon is used below as <Icon /> (JSX element)
const StatCard = ({ icon: Icon, label, value, accentClass }) => (
    <article className="flex-1 min-w-[140px] warehouse-subtle-card p-3 sm:p-4">
        <div className="flex items-center gap-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${accentClass}`}>
                <Icon size={16} />
            </div>
            <div className="min-w-0">
                <p className="wh-ui-label text-[9px] sm:text-[10px]">{label}</p>
                <p className="text-xl sm:text-2xl font-black tracking-tighter text-white leading-none mt-1">
                    {value || 0}
                </p>
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
        <div className="flex gap-3 overflow-x-auto pb-1">
            {CARDS.map((card) => (
                <StatCard key={card.key} {...card} value={values[card.key]} />
            ))}
        </div>
    )
}

export default StatCards
