import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate, Link } from 'react-router-dom'
import { 
    ChevronRight, 
    Clock, 
    ClipboardList, 
    AlertCircle, 
    CheckCircle2, 
    History,
    Package,
    XCircle,
    Info
} from 'lucide-react'

function MyReportsPage() {
    const token = useStore.getState().token;
    const user = useStore(state => state.user);
    const navigate = useNavigate();

    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) {
            navigate('/login');
            return;
        }

        const fetchReports = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/order-reports`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const data = await res.json();
                if (res.ok) {
                    setReports(data.data || data);
                }
            } catch (err) {
                console.error("Failed to load reports", err);
            } finally {
                setLoading(false);
            }
        };

        fetchReports();
    }, [user, navigate, token]);

    const getStatusStyles = (status) => {
        const s = status?.toLowerCase();
        if (s === 'submitted') return 'bg-blue-100 text-blue-700 border-blue-200';
        if (s === 'under review') return 'bg-amber-100 text-amber-700 border-amber-200';
        if (s === 'resolved') return 'bg-green-100 text-green-700 border-green-200';
        if (s === 'rejected') return 'bg-red-100 text-red-700 border-red-200';
        return 'bg-[var(--color-surface-container)] text-[var(--color-on-surface-variant)] border-[var(--color-surface-high)]';
    };

    if (loading) {
        return (
            <div className="container-standard py-20 flex justify-center">
                <div className="flex flex-col items-center gap-3">
                    <History className="w-10 h-10 text-primary animate-spin" />
                    <p className="text-sm font-black uppercase tracking-widest text-gray-400">Loading your reports...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container-standard py-6 max-w-3xl">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-black tracking-tight">Order Reports</h1>
                    <p className="text-[var(--color-on-surface-variant)] mt-1">Status of your reported order issues.</p>
                </div>
                <Link to="/profile/order-report" className="btn-primary h-12 px-6">
                    New Report
                </Link>
            </div>

            {reports.length === 0 ? (
                <div className="glass-card p-12 text-center flex flex-col items-center">
                    <div className="w-16 h-16 bg-[var(--color-surface-low)] rounded-full flex items-center justify-center text-gray-300 mb-4">
                        <ClipboardList size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-[var(--color-on-surface)]">No reports yet</h3>
                    <p className="text-gray-400 text-sm mt-2 max-w-xs">When you report an order issue, it will appear here.</p>
                    <Link to="/profile/order-report" className="btn-primary mt-6 px-8 h-12">
                        Report an issue
                    </Link>
                </div>
            ) : (
                <div className="space-y-4">
                    {reports.map(report => (
                        <div key={report.id} className="glass-card p-6 flex flex-col gap-4 border-l-4 border-l-primary shadow-sm hover:shadow-md transition-all">
                            <div className="flex justify-between items-start">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="px-2 py-0.5 bg-primary/10 text-primary rounded-md text-[9px] font-black uppercase tracking-widest border border-primary/20">
                                            {report.report_type}
                                        </span>
                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                            Order #{report.order_id}
                                        </span>
                                    </div>
                                    <h3 className="font-black text-[var(--color-on-surface)] flex items-center gap-2">
                                        <Package size={16} className="text-primary" />
                                        Reported on {new Date(report.order_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                    </h3>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${getStatusStyles(report.status)}`}>
                                    {report.status}
                                </span>
                            </div>

                            <p className="text-sm text-[var(--color-on-surface-variant)] line-clamp-3">
                                {report.description}
                            </p>

                            <div className="flex items-center gap-4 text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                                <div className="flex items-center gap-1">
                                    <Clock size={12} />
                                    Submitted: {new Date(report.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </div>
                            </div>

                            {report.resolution && (
                                <div className={`mt-2 p-4 rounded-2xl border ${report.status?.toLowerCase() === 'rejected' ? 'bg-red-50 border-red-100 text-red-700' : 'bg-green-50 border-green-100 text-green-700'}`}>
                                    <div className="flex items-center gap-2 mb-1">
                                        {report.status?.toLowerCase() === 'rejected' ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                                        <span className="text-[10px] font-black uppercase tracking-widest">Resolution:</span>
                                    </div>
                                    <p className="text-sm font-medium italic">
                                        "{report.resolution}"
                                    </p>
                                </div>
                            )}

                            {report.admin_notes && report.status?.toLowerCase() !== 'rejected' && (
                                <div className="flex items-start gap-2 text-[11px] text-[var(--color-on-surface-variant)] bg-[var(--color-surface-low)] p-3 rounded-xl border border-[var(--color-surface-high)]">
                                    <Info size={14} className="shrink-0 mt-0.5" />
                                    <p>{report.admin_notes}</p>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

export default MyReportsPage
