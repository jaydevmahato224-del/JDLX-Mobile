import { Truck, FileText, UserCheck, CreditCard, ChevronRight, LayoutGrid } from 'lucide-react'
import { Link } from 'react-router-dom'
// eslint-disable-next-line no-unused-vars -- motion is used below as motion.div (JSX member expression)
import { motion } from 'framer-motion'

const ManageRiders = () => {
    const sections = [
        {
            title: 'Rider Onboarding',
            description: 'Review and recommend new delivery partner applications for your store.',
            icon: FileText,
            path: '/warehouse/rider-requests',
            color: 'from-amber-400 to-orange-500',
            status: 'Action Required',
            isActive: true
        },
        {
            title: 'Active Riders',
            description: 'View and manage rider performance, shifts, and active status.',
            icon: UserCheck,
            path: '#',
            color: 'from-blue-400 to-indigo-500',
            status: 'Coming Soon',
            isActive: false
        },
        {
            title: 'Payouts & Earnings',
            description: 'Track rider earnings, incentives, and store payout records.',
            icon: CreditCard,
            path: '#',
            color: 'from-emerald-400 to-teal-500',
            status: 'Coming Soon',
            isActive: false
        }
    ]

    return (
        <div className="space-y-5 sm:space-y-8 animate-in fade-in duration-500">
            <div>
                <h2 className="text-3xl font-black text-white flex items-center gap-3 tracking-tight">
                    <LayoutGrid className="w-8 h-8 text-amber-500" />
                    Manage Riders
                </h2>
                <p className="text-slate-400 mt-2 text-sm max-w-2xl font-medium leading-relaxed">
                    Centrally control your delivery operations. Manage incoming rider requests, monitor active personnel, and track store-level logistics.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {sections.map((section, idx) => (
                    <motion.div
                        key={idx}
                        whileHover={section.isActive ? { y: -8, scale: 1.02 } : {}}
                        transition={{ type: "spring", stiffness: 300 }}
                    >
                        {section.isActive ? (
                            <Link to={section.path}>
                                <SectionCard section={section} />
                            </Link>
                        ) : (
                            <SectionCard section={section} />
                        )}
                    </motion.div>
                ))}
            </div>
        </div>
    )
}

const SectionCard = ({ section }) => (
    <div className={`
        relative h-full bg-[#0f172a]/40 border border-white/5 p-4 sm:p-6 lg:p-8 rounded-[2rem]
        backdrop-blur-xl group transition-all duration-500 cursor-pointer overflow-hidden
        ${section.isActive ? 'hover:border-amber-500/20 hover:bg-white/[0.03]' : 'opacity-60 grayscale cursor-not-allowed'}
    `}>
        {/* Background Gradient Glow */}
        <div className={`absolute -right-12 -top-12 w-48 h-48 bg-gradient-to-br ${section.color} opacity-[0.03] blur-3xl group-hover:opacity-[0.08] transition-opacity`} />
        
        <div className="flex flex-col h-full gap-4 sm:gap-6 relative z-10">
            <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${section.color} p-[1px]`}>
                <div className="w-full h-full bg-slate-900 rounded-[15px] flex items-center justify-center">
                    <section.icon className="w-7 h-7 text-white" />
                </div>
            </div>

            <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xl font-black text-white tracking-tight">{section.title}</h3>
                    {section.isActive && <ChevronRight className="text-slate-600 group-hover:text-amber-500 transition-colors" size={20} />}
                </div>
                <p className="text-slate-400 text-sm font-medium leading-relaxed italic">{section.description}</p>
            </div>

            <div className="flex items-center gap-2">
                <span className={`text-[10px] font-black uppercase tracking-[0.2em] px-3 py-1 rounded-full border ${
                    section.isActive ? 'bg-amber-400/10 text-amber-500 border-amber-400/20' : 'bg-slate-800 text-slate-500 border-white/5'
                }`}>
                    {section.status}
                </span>
            </div>
        </div>
    </div>
)

export default ManageRiders
