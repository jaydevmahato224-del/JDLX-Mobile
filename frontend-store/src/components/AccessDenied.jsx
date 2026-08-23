import { ShieldAlert, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

function AccessDenied() {
    const navigate = useNavigate();

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 bg-[var(--color-surface-card)] rounded-3xl border border-red-100 shadow-sm relative overflow-hidden">
            <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-red-500/5 blur-[100px] rounded-full pointer-events-none"></div>

            <div className="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center mb-6 text-red-500 shadow-inner">
                <ShieldAlert className="w-10 h-10" />
            </div>

            <h1 className="text-3xl font-bold text-[var(--color-on-surface)] mb-2 tracking-tight">Access Denied</h1>
            <p className="text-[var(--color-on-surface-variant)] max-w-md mb-8">
                You don't have the necessary role permissions to view this page. If you believe this is an error, please contact your system administrator.
            </p>

            <button
                onClick={() => navigate('/admin/dashboard')}
                className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-colors shadow-lg shadow-slate-900/20"
            >
                <ArrowLeft className="w-4 h-4" />
                Return to Dashboard
            </button>
        </div>
    )
}

export default AccessDenied
