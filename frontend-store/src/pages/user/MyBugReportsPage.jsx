import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate, Link } from 'react-router-dom'
import { 
    ChevronRight, 
    Clock, 
    Bug, 
    AlertCircle, 
    History,
    Terminal,
    Layout,
    ArrowLeft
} from 'lucide-react'

function MyBugReportsPage() {
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
                const res = await fetch(`${API_BASE_URL}/my-bug-reports`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const data = await res.json();
                if (res.ok) {
                    setReports(data.data || data);
                }
            } catch (err) {
                console.error("Failed to load bug reports", err);
            } finally {
                setLoading(false);
            }
        };

        fetchReports();
    }, [user, navigate, token]);

    const getStatusStyles = (status) => {
        const s = status?.toLowerCase();
        switch(s) {
            case 'new': return 'bg-blue-100 text-blue-700 border-blue-200';
            case 'investigating': return 'bg-amber-100 text-amber-700 border-amber-200';
            case 'fixed': return 'bg-green-100 text-green-700 border-green-200';
            case 'closed': return 'bg-gray-100 text-gray-700 border-gray-200';
            case 'duplicate': return 'bg-gray-100 text-gray-500 border-gray-200 line-through';
            default: return 'bg-gray-50 text-gray-600 border-gray-100';
        }
    };

    const getSeverityStyles = (severity) => {
        const s = severity?.toLowerCase();
        switch(s) {
            case 'critical': return 'text-red-600 bg-red-50 border-red-100';
            case 'high': return 'text-orange-600 bg-orange-50 border-orange-100';
            case 'medium': return 'text-yellow-700 bg-yellow-50 border-yellow-100';
            case 'low': return 'text-green-600 bg-green-50 border-green-100';
            default: return 'text-gray-600 bg-gray-50 border-gray-100';
        }
    };

    if (loading) {
        return (
            <div className="container-standard py-20 flex justify-center">
                <div className="flex flex-col items-center gap-3">
                    <History className="w-10 h-10 text-primary animate-spin" />
                    <p className="text-sm font-black uppercase tracking-widest text-gray-400">Fetching bug history...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container-standard py-6 max-w-3xl">
            <div className="flex items-center gap-4 mb-8">
                <Link to="/profile" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                    <ArrowLeft size={24} />
                </Link>
                <div>
                    <h1 className="text-3xl font-black tracking-tight">Bug Reports</h1>
                    <p className="text-gray-500 mt-1 text-sm">Status of the issues you have reported.</p>
                </div>
            </div>

            {reports.length === 0 ? (
                <div className="glass-card p-12 text-center flex flex-col items-center border-2 border-dashed border-gray-100">
                    <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center text-gray-300 mb-6">
                        <Bug size={40} />
                    </div>
                    <h3 className="text-2xl font-black text-gray-800">No bug reports yet</h3>
                    <p className="text-gray-400 text-sm mt-2 max-w-xs font-medium">When you report a system bug, it will appear here.</p>
                    <Link to="/profile/bug-report" className="btn-primary mt-8 px-10 h-14">
                        Report a bug <ChevronRight size={18} className="ml-1" />
                    </Link>
                </div>
            ) : (
                <div className="space-y-4 pb-20">
                    {reports.map(report => (
                        <div key={report.id} className="glass-card p-6 flex flex-col gap-5 border-l-4 border-l-primary group hover:shadow-xl transition-all">
                            <div className="flex justify-between items-start gap-4">
                                <div className="space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border ${getSeverityStyles(report.severity)}`}>
                                            {report.severity}
                                        </span>
                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1 bg-gray-50 px-2 py-0.5 rounded-md border border-gray-100">
                                            <Layout size={10} /> {report.page_location}
                                        </span>
                                    </div>
                                    <h3 className="text-lg font-black text-gray-800 flex items-center gap-2">
                                        <Bug size={18} className="text-primary group-hover:rotate-12 transition-transform" />
                                        Bug #{report.id}
                                    </h3>
                                </div>
                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border shadow-sm ${getStatusStyles(report.status)}`}>
                                    {report.status}
                                </span>
                            </div>

                            <p className="text-sm text-gray-600 leading-relaxed font-medium">
                                {report.description}
                            </p>

                            <div className="flex items-center gap-4 text-[10px] text-gray-400 font-bold uppercase tracking-widest pt-2 border-t border-gray-50">
                                <div className="flex items-center gap-1.5">
                                    <Clock size={12} className="text-gray-300" />
                                    Submitted: {new Date(report.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </div>
                            </div>

                            {report.developer_notes && (
                                <div className="mt-2 p-5 rounded-3xl bg-slate-900 text-slate-300 border-t-4 border-t-primary shadow-inner">
                                    <div className="flex items-center gap-2 mb-3 text-primary">
                                        <Terminal size={14} />
                                        <span className="text-[10px] font-black uppercase tracking-[0.15em]">Developer note:</span>
                                    </div>
                                    <p className="text-sm font-bold font-mono bg-white/5 p-3 rounded-xl leading-relaxed">
                                        {report.developer_notes}
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

export default MyBugReportsPage
