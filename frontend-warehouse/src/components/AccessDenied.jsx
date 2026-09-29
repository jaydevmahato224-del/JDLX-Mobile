import { ShieldAlert, ArrowLeft, ReceiptText } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'

/**
 * Access Denied — shown by WarehouseRoute when the logged-in user's role is
 * not in the route's whitelist.
 *
 * The "Return to Dashboard" button used to send EVERYONE to
 * /warehouse/dashboard — including billing/staff agents, who have no
 * dashboard permission. They'd land on this exact screen again: an
 * access-denied loop with no exit. Now the destination is role-aware:
 *   - billing/staff agents → Counter Billing (POS) — the only screen they
 *     have access to (mirrors the post-login redirect in WarehouseLogin)
 *   - everyone else → /warehouse/dashboard as before
 */
function AccessDenied() {
    const navigate = useNavigate();
    const user = useStore((state) => state.warehouseUser);

    const rawRole = (user?.role || user?.role_name || '').toLowerCase();
    // Mirror WarehouseRoute/WarehouseLayout normalization: any role_name
    // containing "billing"/"staff" (e.g. "Billing Agent") is a POS-only user.
    const isPosOnlyUser = rawRole.includes('billing') || rawRole.includes('staff');
    const fallbackPath = isPosOnlyUser ? '/warehouse/billing' : '/warehouse/dashboard';
    const fallbackLabel = isPosOnlyUser ? 'Return to Counter Billing (POS)' : 'Return to Dashboard';

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 bg-white rounded-3xl border border-red-100 shadow-sm relative overflow-hidden">
            <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-red-500/5 blur-[100px] rounded-full pointer-events-none"></div>

            <div className="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center mb-6 text-red-500 shadow-inner">
                <ShieldAlert className="w-10 h-10" />
            </div>

            <h1 className="text-3xl font-bold text-slate-900 mb-2 tracking-tight">Access Denied</h1>
            <p className="text-slate-500 max-w-md mb-8">
                You don't have the necessary role permissions to view this page. If you believe this is an error, please contact your system administrator.
            </p>

            <button
                onClick={() => navigate(fallbackPath)}
                className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-colors shadow-lg shadow-slate-900/20"
            >
                {isPosOnlyUser ? <ReceiptText className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
                {fallbackLabel}
            </button>
        </div>
    )
}

export default AccessDenied
