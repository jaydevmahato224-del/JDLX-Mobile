import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate, Link } from 'react-router-dom'
import { ChevronRight, Clock, MessageSquare, AlertCircle, CheckCircle2, History } from 'lucide-react'
import { apiFetch } from '../../utils/apiFetch'

function MyRequestsPage() {
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
                const res = await apiFetch('/my-requests');
                const data = await res.json();
                if (res.ok) {
                    setRequests(data.data || data);
                }
            } catch (err) {
                console.error("Failed to load requests", err);
            } finally {
                setLoading(false);
            }
        };

        fetchRequests();
    }, [user, navigate]);

    const getStatusStyles = (status) => {
        const s = status?.toLowerCase();
        if (s === 'pending') return 'bg-yellow-100 text-yellow-700 border-yellow-200';
        if (s === 'in progress') return 'bg-blue-100 text-blue-700 border-blue-200';
        if (s === 'resolved') return 'bg-green-100 text-green-700 border-green-200';
        return 'bg-[var(--color-surface-container)] text-[var(--color-on-surface-variant)] border-[var(--color-surface-high)]';
    };

    if (loading) {
        return (
            <div className="container-standard py-20 flex justify-center">
                <div className="flex flex-col items-center gap-3">
                    <History className="w-10 h-10 text-primary animate-spin" />
                    <p className="text-sm font-black uppercase tracking-widest text-gray-400">Loading your requests...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container-standard py-6 max-w-3xl">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-black tracking-tight">My Requests</h1>
                    <p className="text-[var(--color-on-surface-variant)] mt-1">Track the status of your reported issues.</p>
                </div>
                <Link to="/profile/complaint" className="btn-primary h-12 px-6">
                    New Request
                </Link>
            </div>

            {requests.length === 0 ? (
                <div className="glass-card p-12 text-center flex flex-col items-center">
                    <div className="w-16 h-16 bg-[var(--color-surface-low)] rounded-full flex items-center justify-center text-gray-300 mb-4">
                        <MessageSquare size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-[var(--color-on-surface)]">No requests found yet</h3>
                    <p className="text-gray-400 text-sm mt-2 max-w-xs">When you report an issue, it will appear here.</p>
                    <Link to="/profile/complaint" className="text-primary font-black uppercase tracking-widest text-[10px] mt-6 hover:underline">
                        Report an issue now
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
                                            {req.type}
                                        </span>
                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                            Order #{req.order_id}
                                        </span>
                                    </div>
                                    <h3 className="font-black text-[var(--color-on-surface)]">{req.issue_type}</h3>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${getStatusStyles(req.status)}`}>
                                    {req.status}
                                </span>
                            </div>

                            <p className="text-sm text-[var(--color-on-surface-variant)] line-clamp-2">
                                {req.description}
                            </p>

                            <div className="flex items-center gap-4 text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                                <div className="flex items-center gap-1">
                                    <Clock size={12} />
                                    {req.created_at}
                                </div>
                            </div>

                            {req.admin_reply && (
                                <div className="mt-2 p-4 bg-primary/5 rounded-2xl border border-primary/10">
                                    <div className="flex items-center gap-2 mb-1 text-primary">
                                        <CheckCircle2 size={14} />
                                        <span className="text-[10px] font-black uppercase tracking-widest">JDLX Team Response:</span>
                                    </div>
                                    <p className="text-sm text-[var(--color-on-surface-variant)] font-medium italic">
                                        "{req.admin_reply}"
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

export default MyRequestsPage
