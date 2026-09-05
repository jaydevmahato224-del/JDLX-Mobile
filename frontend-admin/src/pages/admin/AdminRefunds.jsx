import { useState, useEffect } from 'react'
import { ArrowLeft, RefreshCcw, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { apiFetch } from '../../utils/apiFetch'

function AdminRefunds() {
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);

const fetchRequests = async () => {
        setLoading(true);
        try {
            const res = await apiFetch('/admin/refund-requests');
            const data = await res.json();
            if (res.ok) setRequests(data);
        } catch (error) {
            console.error("Failed to fetch refund requests:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fetch on mount only
    }, []);

    const handleAction = async (requestId, status) => {
        try {
            const res = await apiFetch(`/admin/refund/${requestId}`, {
                method: 'PATCH',
                body: JSON.stringify({ status })
            });
            if (res.ok) fetchRequests();
        } catch (error) {
            console.error(`Failed to ${status} refund:`, error);
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'PENDING': return 'bg-yellow-100 text-yellow-700';
            case 'APPROVED': return 'bg-blue-100 text-blue-700';
            case 'PROCESSED': return 'bg-green-100 text-green-700';
            case 'REJECTED': return 'bg-red-100 text-red-700';
            default: return 'bg-gray-100 text-gray-700';
        }
    };

    return (
        <div className="flex flex-col gap-6 p-4 md:p-8 max-w-5xl mx-auto">
            <div className="flex items-center gap-4">
                <Link to="/admin" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                    <ArrowLeft className="w-6 h-6 text-gray-800" />
                </Link>
                <h1 className="text-3xl font-black text-gray-900 tracking-tight">Refund Management</h1>
            </div>

            {loading ? (
                <div className="flex justify-center py-20 animate-pulse">
                    <RefreshCcw className="w-8 h-8 text-primary animate-spin" />
                </div>
            ) : requests.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-gray-100">
                    <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500 font-medium">No refund requests found.</p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {requests.map((req) => (
                        <div key={req.id} className="glass-card p-6 flex flex-col md:flex-row justify-between gap-6 border-l-4 border-l-primary/50">
                            <div className="flex-1 space-y-2">
                                <div className="flex items-center gap-3">
                                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider ${getStatusColor(req.status)}`}>
                                        {req.status}
                                    </span>
                                    <span className="text-xs text-gray-400 font-medium flex items-center gap-1">
                                        <Clock size={12} /> {new Date(req.created_at).toLocaleDateString()}
                                    </span>
                                </div>
                                <h3 className="text-lg font-bold text-gray-800">Order #{req.order_id}</h3>
                                <div className="flex items-center gap-4 text-sm">
                                    <p className="text-gray-600">Customer: <span className="font-bold text-gray-800">{req.user_name}</span></p>
                                    <p className="text-gray-600">Amount: <span className="font-bold text-primary">₹{req.total_amount}</span></p>
                                </div>
                                <div className="bg-gray-50 p-3 rounded-xl">
                                    <p className="text-xs text-gray-500 font-bold uppercase mb-1">Reason:</p>
                                    <p className="text-sm text-gray-700 italic">"{req.reason}"</p>
                                </div>
                            </div>

                            <div className="flex md:flex-col justify-end gap-2 shrink-0">
                                {req.status === 'PENDING' && (
                                    <>
                                        <button
                                            onClick={() => handleAction(req.id, 'APPROVED')}
                                            className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-xl text-sm font-bold hover:bg-blue-600 transition-colors"
                                        >
                                            <CheckCircle size={16} /> Approve
                                        </button>
                                        <button
                                            onClick={() => handleAction(req.id, 'REJECTED')}
                                            className="flex items-center justify-center gap-2 px-4 py-2 bg-red-100 text-red-600 rounded-xl text-sm font-bold hover:bg-red-200 transition-colors"
                                        >
                                            <XCircle size={16} /> Reject
                                        </button>
                                    </>
                                )}
                                {req.status === 'APPROVED' && (
                                    <button
                                        onClick={() => handleAction(req.id, 'PROCESSED')}
                                        className="flex items-center justify-center gap-2 px-4 py-2 bg-green-500 text-white rounded-xl text-sm font-bold hover:bg-green-600 transition-colors"
                                    >
                                        <RefreshCcw size={16} /> Mark Processed
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default AdminRefunds;
