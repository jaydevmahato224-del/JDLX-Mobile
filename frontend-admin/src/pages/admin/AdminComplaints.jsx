import { useState, useEffect } from 'react'
import { ArrowLeft, Search, Filter, Eye, X, MessageSquare, Clock, Calendar, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { API_BASE_URL } from '../../config'
import toast from 'react-hot-toast'

function AdminComplaints() {
    const [complaints, setComplaints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedComplaint, setSelectedComplaint] = useState(null);
    const [updateLoading, setUpdateLoading] = useState(false);
    const [replyText, setReplyText] = useState('');
    const [statusToUpdate, setStatusToUpdate] = useState('');

    useEffect(() => {
        fetchComplaints();
    }, []);

    const fetchComplaints = () => {
        setLoading(true);
        const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
        if (!token) return;

        fetch(`${API_BASE_URL}/admin/complaints`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
            .then(res => res.json())
            .then(res => {
                if (res.success) {
                    setComplaints(res.data || []);
                }
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    };

    const handleUpdateComplaint = async () => {
        if (!selectedComplaint) return;
        setUpdateLoading(true);
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/complaints/${selectedComplaint.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    status: statusToUpdate,
                    admin_reply: replyText
                })
            });
            const data = await res.json();
            if (res.ok) {
                toast.success("Complaint updated successfully!");
                fetchComplaints();
                setSelectedComplaint(null);
            } else {
                toast.error(data.message || "Failed to update complaint");
            }
        } catch {
            toast.error("Network error");
        } finally {
            setUpdateLoading(false);
        }
    };

    const filteredComplaints = complaints.filter(c => {
        const matchesSearch = 
            c.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.order_id?.toString().includes(searchTerm) ||
            c.issue_type?.toLowerCase().includes(searchTerm.toLowerCase());
        
        const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
        
        return matchesSearch && matchesStatus;
    });

    const getStatusColor = (status) => {
        switch (status) {
            case 'Resolved': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
            case 'In Progress': return 'bg-blue-100 text-blue-700 border-blue-200';
            case 'Closed': return 'bg-slate-100 text-slate-700 border-slate-200';
            default: return 'bg-amber-100 text-amber-700 border-amber-200';
        }
    };

    if (loading && complaints.length === 0) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
                <p className="text-gray-500 font-medium">Loading complaints...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black tracking-tight text-slate-900">Complaints Management</h1>
                    <p className="text-sm text-slate-500">View and resolve customer reported issues.</p>
                </div>
            </div>

            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input
                        type="text"
                        placeholder="Search by name, order ID..."
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary/20 transition-all"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="relative">
                    <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <select
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary/20 transition-all appearance-none"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                    >
                        <option value="all">All Statuses</option>
                        <option value="Pending">Pending</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Resolved">Resolved</option>
                        <option value="Closed">Closed</option>
                    </select>
                </div>
                <div className="flex items-center justify-end">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                        {filteredComplaints.length} Complaints Found
                    </p>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50 border-b border-slate-200">
                                <th className="px-6 py-4 font-black text-slate-500 uppercase tracking-widest text-[10px]">Customer</th>
                                <th className="px-6 py-4 font-black text-slate-500 uppercase tracking-widest text-[10px]">Order ID</th>
                                <th className="px-6 py-4 font-black text-slate-500 uppercase tracking-widest text-[10px]">Issue Type</th>
                                <th className="px-6 py-4 font-black text-slate-500 uppercase tracking-widest text-[10px]">Status</th>
                                <th className="px-6 py-4 font-black text-slate-500 uppercase tracking-widest text-[10px]">Date</th>
                                <th className="px-6 py-4 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredComplaints.map((c) => (
                                <tr 
                                    key={c.id} 
                                    className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                                    onClick={() => {
                                        setSelectedComplaint(c);
                                        setReplyText(c.admin_reply || '');
                                        setStatusToUpdate(c.status);
                                    }}
                                >
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-slate-900">{c.user_name}</span>
                                            <span className="text-xs text-slate-400">{c.user_email}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 font-black text-primary">#{c.order_id}</td>
                                    <td className="px-6 py-4 font-medium text-slate-600">{c.issue_type}</td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${getStatusColor(c.status)}`}>
                                            {c.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-slate-500 text-xs font-medium">
                                        {new Date(c.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button className="p-2 bg-slate-100 text-slate-400 rounded-lg group-hover:bg-primary group-hover:text-white transition-all">
                                            <Eye size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {filteredComplaints.length === 0 && (
                    <div className="py-20 flex flex-col items-center justify-center text-center px-4">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-200 mb-4">
                            <MessageSquare size={32} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">No complaints found</h3>
                        <p className="text-slate-500 text-sm max-w-xs mt-1">Try adjusting your filters or search terms.</p>
                    </div>
                )}
            </div>

            {/* Detail Modal */}
            {selectedComplaint && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
                        {/* Modal Header */}
                        <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <div>
                                <h3 className="text-xl font-black tracking-tight text-slate-900">Complaint Detail</h3>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Order #{selectedComplaint.order_id}</p>
                            </div>
                            <button 
                                onClick={() => setSelectedComplaint(null)}
                                className="p-2 hover:bg-white rounded-full text-slate-400 hover:text-slate-900 transition-all border border-transparent hover:border-slate-200"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Customer</p>
                                    <p className="font-bold text-slate-900">{selectedComplaint.user_name}</p>
                                    <p className="text-xs text-slate-500">{selectedComplaint.user_email}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Submitted On</p>
                                    <p className="font-bold text-slate-900 flex items-center gap-2">
                                        <Calendar size={14} className="text-primary" />
                                        {new Date(selectedComplaint.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                </div>
                            </div>

                            <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="px-2.5 py-0.5 bg-primary/10 text-primary rounded-md text-[9px] font-black uppercase tracking-widest border border-primary/20">
                                        {selectedComplaint.issue_type}
                                    </span>
                                </div>
                                <p className="text-sm text-slate-700 leading-relaxed italic">
                                    "{selectedComplaint.description}"
                                </p>
                            </div>

                            {selectedComplaint.photo_path && (
                                <div className="space-y-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                                        <Eye size={12} /> Evidence Photo
                                    </p>
                                    <a 
                                        href={selectedComplaint.photo_path.startsWith('http') ? selectedComplaint.photo_path : `${API_BASE_URL.replace('/api', '')}${selectedComplaint.photo_path}`} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="block relative group overflow-hidden rounded-2xl border border-slate-200 shadow-sm"
                                    >
                                        <img 
                                            src={selectedComplaint.photo_path.startsWith('http') ? selectedComplaint.photo_path : `${API_BASE_URL.replace('/api', '')}${selectedComplaint.photo_path}`} 
                                            alt="Evidence" 
                                            className="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-700"
                                        />
                                        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <span className="bg-white text-slate-900 px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest">View Full Size</span>
                                        </div>
                                    </a>
                                </div>
                            )}

                            {/* Resolution Form */}
                            <div className="space-y-6 pt-4 border-t border-slate-100">
                                <div className="space-y-3">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Update Status</label>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        {['Pending', 'In Progress', 'Resolved', 'Closed'].map((s) => (
                                            <button
                                                key={s}
                                                type="button"
                                                onClick={() => setStatusToUpdate(s)}
                                                className={`h-12 rounded-xl text-xs font-black transition-all border ${statusToUpdate === s ? 'bg-primary text-white border-primary shadow-lg shadow-primary/20' : 'bg-white text-slate-500 border-slate-200 hover:border-primary/50'}`}
                                            >
                                                {s}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Admin Response</label>
                                    <textarea
                                        className="w-full min-h-[120px] rounded-2xl bg-slate-50 p-5 text-sm font-bold text-slate-900 border-2 border-transparent focus:border-primary/20 focus:bg-white transition-all outline-none resize-none"
                                        placeholder="Type your response to the customer..."
                                        value={replyText}
                                        onChange={(e) => setReplyText(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="px-8 py-6 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
                            <button 
                                onClick={() => setSelectedComplaint(null)}
                                className="px-6 h-12 rounded-xl text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={handleUpdateComplaint}
                                disabled={updateLoading}
                                className="btn-primary h-12 px-8 min-w-[160px]"
                            >
                                {updateLoading ? <Loader2 size={18} className="animate-spin" /> : (
                                    <span className="flex items-center gap-2">
                                        <CheckCircle size={16} /> Update & Notify
                                    </span>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default AdminComplaints
