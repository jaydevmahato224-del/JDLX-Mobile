import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, AlertCircle, Info, X, AlertTriangle } from 'lucide-react'
import { useAlertStore } from '../store/useAlertStore'

const GlobalAlert = () => {
    const alerts = useAlertStore((state) => state.alerts)
    const hideAlert = useAlertStore((state) => state.hideAlert)

    return (
        <div className="fixed top-24 right-6 z-[9999] flex flex-col gap-3 pointer-events-none">
            <AnimatePresence>
                {alerts.map((alert) => (
                    <motion.div
                        key={alert.id}
                        initial={{ opacity: 0, x: 50, scale: 0.9 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 20, scale: 0.95 }}
                        className="pointer-events-auto"
                    >
                        <AlertItem alert={alert} onClose={() => hideAlert(alert.id)} />
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    )
}

const AlertItem = ({ alert, onClose }) => {
    const icons = {
        success: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
        error: <AlertCircle className="w-5 h-5 text-rose-500" />,
        warning: <AlertTriangle className="w-5 h-5 text-amber-500" />,
        info: <Info className="w-5 h-5 text-indigo-500" />
    }

    const backgrounds = {
        success: 'bg-emerald-50/90 border-emerald-200/50',
        error: 'bg-rose-50/90 border-rose-200/50',
        warning: 'bg-amber-50/90 border-amber-200/50',
        info: 'bg-indigo-50/90 border-indigo-200/50'
    }

    return (
        <div className={`
            w-[calc(100vw-3rem)] min-w-0 max-w-[450px] sm:w-auto sm:min-w-[320px] p-4 rounded-2xl border backdrop-blur-xl shadow-2xl
            flex items-start gap-4 ${backgrounds[alert.type]}
        `}>
            <div className="mt-0.5">{icons[alert.type]}</div>
            <div className="flex-1">
                <p className="text-sm font-bold text-slate-900 leading-tight">
                    {alert.message}
                </p>
                {alert.duration === null && (
                    <p className="text-[10px] text-slate-400 mt-1 uppercase font-black tracking-widest italic">
                        Please refresh or retry
                    </p>
                )}
            </div>
            <button 
                onClick={onClose}
                className="p-1 hover:bg-slate-200/50 rounded-lg transition-colors text-slate-400 hover:text-slate-600"
            >
                <X size={16} />
            </button>
        </div>
    )
}

export default GlobalAlert
