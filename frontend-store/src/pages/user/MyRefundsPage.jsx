import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate, Link } from 'react-router-dom'
import { 
    ChevronRight, 
    Clock, 
    History,
    RotateCcw,
    CheckCircle2,
    XCircle,
    Info,
    Coins,
    Package,
    ArrowRight
} from 'lucide-react'
import { apiFetch } from '../../utils/apiFetch'

function MyRefundsPage() {
    const user = useStore(state => state.user);
    const navigate = useNavigate();

    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) {
            navigate('/login');
            return;
        }

        const fetchRequests = async () => {
            try {
                const res = await apiFetch('/refund-requests');
                const data = await res.json();
                if (res.ok) {
                    setRequests(data.data || data);
                }
            } catch (err) {
                console.error("Failed to load refund requests", err);
            } finally {
                setLoading(false);
            }
        };

        fetchRequests();
    }, [user, navigate]);

    const getStatusStyles = (status) => {
        const s = status?.toLowerCase();
        if (s === 'pending') return 'bg-blue-100 text-blue-700 border-blue-200';
        if (s === 'approved') return 'bg-green-100 text-green-700 border-green-200';
        if (s === 'rejected') return 'bg-red-100 text-red-700 border-red-200';
        if (s === 'processing') return 'bg-amber-100 text-amber-700 border-amber-200';
        if (s === 'completed') return 'bg-[var(--color-surface-container)] text-[var(--color-on-surface-variant)] border-[var(--color-surface-high)]';
        return 'bg-[var(--color-surface-low)] text-[var(--color-on-surface-variant)] border-[var(--color-surface-high)]';
    };

    if (loading) {
        return (
            <div className="container-standard py-20 flex justify-center">
                <div className="flex flex-col items-center gap-3">
                    <History className="w-10 h-10 text-primary animate-spin" />
                    <p className="text-sm font-black uppercase tracking-widest text-gray-400">Fetching Refund History...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container-standard py-6 max-w-3xl">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-black tracking-tight">My Refunds</h1>
                    <p className="text-[var(--color-on-surface-variant)] mt-1">Track the status of your return and refund requests.</p>
                </div>
                <Link to="/profile/refund-request" className="btn-primary h-12 px-6">
                    New Refund
                </Link>
            </div>

            {requests.length === 0 ? (
                <div className="glass-card p-12 text-center flex flex-col items-center">
                    <div className="w-16 h-16 bg-[var(--color-surface-low)] rounded-full flex items-center justify-center text-gray-300 mb-4">
                        <RotateCcw size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-[var(--color-on-surface)]">No refund requests yet</h3>
                    <p className="text-gray-400 text-sm mt-2 max-w-xs">When you submit a refund or exchange request, it will appear here.</p>
                    <Link to="/profile/refund-request" className="btn-primary mt-6 px-8 h-12">
                        Submit refund request
                    </Link>
                </div>
            ) : (
                <div className="space-y-4">
                    {requests.map(req => (
                        <div key={req.id} className="glass-card p-6 flex flex-col gap-4 border-l-4 border-l-primary shadow-sm hover:shadow-md transition-all">
                            <div className="flex justify-between items-start">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="px-2 py-0.5 bg-primary/10 text-primary rounded-md text-[9px] font-black uppercase tracking-widest border border-primary/20">
                                            {req.request_type}
                                        </span>
                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                            Order #{req.order_id}
                                        </span>
                                    </div>
                                    <h3 className="font-black text-[var(--color-on-surface)] flex items-center gap-2">
                                        <Package size={16} className="text-primary" />
                                        {req.reason}
                                    </h3>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border flex items-center gap-1 ${getStatusStyles(req.status)}`}>
                                        {req.status === 'Completed' && <CheckCircle2 size={10} />}
                                        {req.status}
                                    </span>
                                    {req.refund_amount > 0 && (
                                        <span className="text-xs font-black text-primary flex items-center gap-1">
                                            <Coins size={12} /> ₹{req.refund_amount}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <p className="text-sm text-[var(--color-on-surface-variant)] line-clamp-3">
                                {req.description}
                            </p>

                            <div className="flex items-center justify-between text-[10px] text-gray-400 font-bold uppercase tracking-widest border-t border-gray-50 pt-4">
                                <div className="flex items-center gap-1">
                                    <Clock size={12} />
                                    Requested: {new Date(req.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </div>
                                <div className="flex items-center gap-1 text-gray-400">
                                    Order Date: {new Date(req.order_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                </div>
                            </div>

                            {req.resolution && (
                                <div className={`mt-2 p-4 rounded-2xl border ${req.status?.toLowerCase() === 'rejected' ? 'bg-red-50 border-red-100 text-red-700' : 'bg-primary/5 border-primary/10 text-primary'}`}>
                                    <div className="flex items-center gap-2 mb-1">
                                        {req.status?.toLowerCase() === 'rejected' ? <XCircle size={14} /> : <Info size={14} />}
                                        <span className="text-[10px] font-black uppercase tracking-widest">Resolution:</span>
                                    </div>
                                    <p className="text-sm font-medium italic">
                                        "{req.resolution}"
                                    </p>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

export default MyRefundsPage
