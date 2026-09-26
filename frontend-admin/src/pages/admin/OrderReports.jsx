import { useState, useEffect } from 'react'
import { ArrowLeft, Search, Flag, Clock, CheckCircle, XCircle, Send, Loader2, Eye, X, ShieldCheck, Package, RefreshCcw, Building2, AlertTriangle, ArrowUpCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { API_BASE_URL } from '../../config'
import { apiFetch } from '../../utils/apiFetch'

/**
 * Order Reports — admin fraud-review desk.
 *
 * Flow: customer "Report this order" -> report lands here (Submitted)
 *   -> admin reviews (Under Review)
 *   -> legit?  TRANSFER to the responsible warehouse (auto-resolved from the
 *      order's assignment) with a FORCED directive (refund / exchange /
 *      investigate) -> warehouse must record the directed action
 *   -> warehouse handling unsatisfactory? ESCALATE against the warehouse
 *      (formal warning, admin takes over)
 *   -> fraud/malicious? REJECT (closed here, never reaches a warehouse)
 * Admin can Resolve/Reject a transferred report as an override at any time.
 */

const STATUS_TONES = {
    'Submitted': 'bg-amber-100 text-amber-700 border-amber-200',
    'Under Review': 'bg-blue-100 text-blue-700 border-blue-200',
    'Transferred to Warehouse': 'bg-violet-100 text-violet-700 border-violet-200',
    'In Warehouse Review': 'bg-violet-100 text-violet-700 border-violet-200',
    'Action Taken': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'Escalated to Admin': 'bg-orange-100 text-orange-700 border-orange-200',
    'Resolved': 'bg-green-100 text-green-700 border-green-200',
    'Rejected': 'bg-red-100 text-red-600 border-red-200',
}

const DIRECTIVE_OPTIONS = [
    { value: 'refund', label: 'Force refund — warehouse must refund the customer' },
    { value: 'exchange', label: 'Force exchange — warehouse must arrange replacement' },
    { value: 'refund_or_exchange', label: 'Refund OR exchange — warehouse picks one' },
    { value: 'investigate', label: 'Investigate — record findings (no forced remedy)' },
]

const REPORT_TYPES = [
    'Item not delivered', 'Wrong item received', 'Missing item in package',
    'Damaged in transit', 'Duplicate charge', 'Other',
]

function OrderReports() {
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [typeFilter, setTypeFilter] = useState('all');
    const [selectedReport, setSelectedReport] = useState(null);
    const [transferNote, setTransferNote] = useState('');
    const [transferring, setTransferring] = useState(false);
    const [updateLoading, setUpdateLoading] = useState(false);
    const [resolutionText, setResolutionText] = useState('');
    const [directive, setDirective] = useState('');
    const [deadlineHours, setDeadlineHours] = useState('');
    const [harassment, setHarassment] = useState(false);
    const [escalating, setEscalating] = useState(false);
    const [escalationNote, setEscalationNote] = useState('');

    useEffect(() => {
        fetchReports();
    }, []);

    const fetchReports = async () => {
        setLoading(true);
        try {
            const res = await apiFetch('/admin/order-reports');
            const data = await res.json();
            if (res.ok) {
                setReports(data.data || data || []);
            } else {
                toast.error(data?.message || "Failed to load order reports");
            }
        } catch (error) {
            console.error("Failed to fetch order reports:", error);
            toast.error("Network error — please retry");
        } finally {
            setLoading(false);
        }
    };

    const handleTransfer = async () => {
        if (!selectedReport) return;
        setTransferring(true);
        try {
            const res = await apiFetch(`/admin/order-reports/${selectedReport.id}/transfer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    note: transferNote || null,
                    action_required: directive || null,
                    directive_deadline_hours: deadlineHours ? Number(deadlineHours) : null,
                    harassment_warning: harassment,
                })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                toast.success(`Transferred to ${data.data?.transferred_warehouse_name || 'warehouse'}${directive ? ` — directive: ${directive.replace('_', ' ')}` : ''}`);
                setSelectedReport(null);
                setTransferNote('');
                setDirective(''); setDeadlineHours(''); setHarassment(false);
                fetchReports();
            } else {
                toast.error(data.message || "Transfer failed");
            }
        } catch (error) {
            console.error("Transfer failed:", error);
            toast.error("Network error — please retry");
        } finally {
            setTransferring(false);
        }
    };

    const handleEscalate = async () => {
        if (!selectedReport || !escalationNote.trim()) return;
        setEscalating(true);
        try {
            const res = await apiFetch(`/admin/order-reports/${selectedReport.id}/escalate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note: escalationNote })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                toast.success("Report escalated — formal warning recorded against the warehouse");
                setSelectedReport(null);
                setEscalationNote('');
                fetchReports();
            } else {
                toast.error(data.message || "Escalation failed");
            }
        } catch (error) {
            console.error("Escalation failed:", error);
            toast.error("Network error — please retry");
        } finally {
            setEscalating(false);
        }
    };

    const handleClose = async (status) => {
        if (!selectedReport) return;
        setUpdateLoading(true);
        try {
            const res = await apiFetch(`/admin/order-reports/${selectedReport.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status,
                    resolution: resolutionText || null,
                })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                toast.success(status === 'Rejected' ? "Report rejected (fraud/malicious)" : "Report resolved");
                setSelectedReport(null);
                setResolutionText('');
                fetchReports();
            } else {
                toast.error(data.message || `Failed to ${status.toLowerCase()} report`);
            }
        } catch (error) {
            console.error("Update failed:", error);
            toast.error("Network error — please retry");
        } finally {
            setUpdateLoading(false);
        }
    };

    const filteredReports = reports.filter(r => {
        const q = searchTerm.toLowerCase();
        const matchesSearch = !q ||
            (r.customer_name || '').toLowerCase().includes(q) ||
            (r.order_number || '').toLowerCase().includes(q) ||
            String(r.order_id).includes(q) ||
            (r.report_type || '').toLowerCase().includes(q);
        const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
        const matchesType = typeFilter === 'all' || r.report_type === typeFilter;
        return matchesSearch && matchesStatus && matchesType;
    });

    const pendingCount = reports.filter(r => ['Submitted', 'Under Review'].includes(r.status)).length;
    const transferredCount = reports.filter(r => r.status === 'Transferred to Warehouse' || r.status === 'Action Taken').length;

    const getStatusColor = (status) => STATUS_TONES[status] || 'bg-gray-100 text-gray-700 border-gray-200';

    return (
        <div className="flex flex-col gap-6 p-4 md:p-8 max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link to="/admin" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <ArrowLeft className="w-6 h-6 text-gray-800" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-black text-gray-900 tracking-tight">Order Reports</h1>
                        <p className="text-xs text-gray-500 font-bold uppercase tracking-widest mt-0.5">
                            Fraud review desk → transfer to warehouse
                        </p>
                    </div>
                </div>
                <button onClick={fetchReports} className="p-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors" title="Refresh">
                    <RefreshCcw size={16} className={loading ? 'animate-spin text-gray-600' : 'text-gray-600'} />
                </button>
            </div>

            {/* Summary chips */}
            <div className="grid grid-cols-3 gap-4">
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">Needs Review</p>
                    <p className="text-2xl font-black text-amber-700 mt-1">{pendingCount}</p>
                </div>
                <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-violet-600">With Warehouse</p>
                    <p className="text-2xl font-black text-violet-700 mt-1">{transferredCount}</p>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total Reports</p>
                    <p className="text-2xl font-black text-slate-700 mt-1">{reports.length}</p>
                </div>
            </div>

            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <input
                        type="text"
                        placeholder="Search customer / order / type"
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary/20 transition-all"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="relative">
                    <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <select
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary/20 appearance-none"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                    >
                        <option value="all">All Statuses</option>
                        <option value="Submitted">Submitted</option>
                        <option value="Under Review">Under Review</option>
                        <option value="Transferred to Warehouse">Transferred to Warehouse</option>
                        <option value="Action Taken">Action Taken</option>
                        <option value="Resolved">Resolved</option>
                        <option value="Rejected">Rejected</option>
                    </select>
                </div>
                <div className="relative">
                    <Flag className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                    <select
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary/20 appearance-none"
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)}
                    >
                        <option value="all">All Report Types</option>
                        {REPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                <div className="flex items-center justify-end">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                        {filteredReports.length} Found
                    </p>
                </div>
            </div>

            {/* Table */}
            {loading ? (
                <div className="flex justify-center py-20">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
            ) : filteredReports.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-gray-100">
                    <Flag className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500 font-medium">No order reports found.</p>
                    <p className="text-xs text-gray-400 mt-1">Customer "Report this order" submissions land here.</p>
                </div>
            ) : (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm border-collapse">
                            <thead>
                                <tr className="bg-slate-50/50 border-b border-slate-200">
                                    <th className="px-6 py-4 font-black text-slate-500 uppercase tracking-widest text-[10px]">Customer</th>
                                    <th className="px-6 py-4 font-black text-slate-500 uppercase tracking-widest text-[10px]">Order</th>
                                    <th className="px-6 py-4 font-black text-slate-500 uppercase tracking-widest text-[10px]">Report Type</th>
                                    <th className="px-6 py-4 font-black text-slate-500 uppercase tracking-widest text-[10px]">Status</th>
                                    <th className="px-6 py-4 font-black text-slate-500 uppercase tracking-widest text-[10px]">Warehouse</th>
                                    <th className="px-6 py-4 font-black text-slate-500 uppercase tracking-widest text-[10px] text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredReports.map((r) => (
                                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                                        <td className="px-6 py-4">
                                            <p className="font-bold text-gray-800">{r.customer_name || `User #${r.user_id}`}</p>
                                            <p className="text-xs text-gray-400">{new Date(r.created_at).toLocaleDateString()}</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="font-black text-gray-800">#{r.order_number || r.order_id}</p>
                                            <p className="text-xs text-gray-400">₹{r.total_amount}</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="px-2 py-1 bg-slate-100 rounded-lg text-[11px] font-bold text-slate-600">
                                                {r.report_type}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${getStatusColor(r.status)}`}>
                                                {r.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            {r.transferred_warehouse_name ? (
                                                <span className="flex items-center gap-1 text-xs font-bold text-violet-600">
                                                    <Building2 size={13} /> {r.transferred_warehouse_name}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-gray-300">—</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button
                                                onClick={() => { setSelectedReport(r); setTransferNote(''); setResolutionText(''); }}
                                                className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-700 transition-colors"
                                            >
                                                <Eye size={14} /> Review
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Review drawer */}
            {selectedReport && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6" onClick={() => setSelectedReport(null)}>
                    <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        {/* Drawer header */}
                        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between rounded-t-3xl">
                            <h3 className="text-lg font-black text-gray-900">Report #{selectedReport.id}</h3>
                            <button onClick={() => setSelectedReport(null)} className="p-2 hover:bg-slate-100 rounded-full">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-6 space-y-5">
                            {/* Report facts */}
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div className="bg-slate-50 rounded-xl p-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Customer</p>
                                    <p className="font-bold text-gray-800">{selectedReport.customer_name || `User #${selectedReport.user_id}`}</p>
                                    <p className="text-xs text-gray-400">{selectedReport.customer_email || ''}</p>
                                </div>
                                <div className="bg-slate-50 rounded-xl p-3">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Order</p>
                                    <p className="font-bold text-gray-800">#{selectedReport.order_number || selectedReport.order_id}</p>
                                    <p className="text-xs text-gray-400">₹{selectedReport.total_amount} • {selectedReport.order_status}</p>
                                </div>
                            </div>

                            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                                <div className="flex items-center gap-2 mb-1">
                                    <Flag size={14} className="text-amber-600" />
                                    <p className="text-xs font-black uppercase tracking-widest text-amber-700">{selectedReport.report_type}</p>
                                </div>
                                <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedReport.description}</p>
                                {selectedReport.photo_path && (
                                    <a
                                        href={selectedReport.photo_path.startsWith('http') ? selectedReport.photo_path : `${API_BASE_URL.replace('/api', '')}${selectedReport.photo_path}`}
                                        target="_blank" rel="noreferrer"
                                        className="mt-2 inline-block text-xs font-black uppercase tracking-wider text-blue-600 underline"
                                    >View evidence photo</a>
                                )}
                            </div>

                            <div className="flex items-center justify-between text-xs text-gray-500">
                                <span className="flex items-center gap-1"><Clock size={12} /> {new Date(selectedReport.created_at).toLocaleString()}</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${getStatusColor(selectedReport.status)}`}>
                                    {selectedReport.status}
                                </span>
                            </div>

                            {selectedReport.transfer_note && (
                                <p className="text-xs text-gray-500 bg-slate-50 rounded-xl p-3">
                                    <b>Transfer note:</b> {selectedReport.transfer_note}
                                </p>
                            )}

                            {/* ── Actions by state ── */}
                            {!['Transferred to Warehouse', 'In Warehouse Review', 'Action Taken', 'Resolved', 'Rejected'].includes(selectedReport.status) && (
                                <div className="space-y-3 border-t border-slate-100 pt-4">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Fraud review decision</p>

                                    {/* Transfer block */}
                                    <div className="border border-violet-200 bg-violet-50/50 rounded-2xl p-4 space-y-2">
                                        <p className="text-sm font-bold text-violet-700 flex items-center gap-1.5">
                                            <ShieldCheck size={15} /> Looks legitimate — send to warehouse
                                        </p>
                                        <p className="text-[11px] text-gray-500">
                                            The fulfilling warehouse is resolved automatically from the order's assignment. It will take the processing action from its panel.
                                        </p>
                                        <input
                                            value={transferNote}
                                            onChange={e => setTransferNote(e.target.value)}
                                            placeholder="Transfer note for the warehouse (optional)"
                                            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500"
                                        />
                                        <div className="grid grid-cols-2 gap-2">
                                            <select
                                                value={directive}
                                                onChange={e => setDirective(e.target.value)}
                                                className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500"
                                            >
                                                <option value="">No forced directive</option>
                                                {DIRECTIVE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </select>
                                            <input
                                                type="number" min="1" max="720"
                                                value={deadlineHours}
                                                onChange={e => setDeadlineHours(e.target.value)}
                                                placeholder="Deadline (hours, optional)"
                                                className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500"
                                            />
                                        </div>
                                        <label className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={harassment}
                                                onChange={e => setHarassment(e.target.checked)}
                                                className="mt-0.5 accent-red-600"
                                            />
                                            <span className="text-[11px] text-red-700 leading-snug">
                                                <b>Issue formal harassment warning</b> — warehouse ko warning record hogi.
                                                Customer ko harassment na ho, warna warehouse ke against action liya jayega.
                                            </span>
                                        </label>
                                        <button
                                            onClick={handleTransfer}
                                            disabled={transferring}
                                            className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                                        >
                                            {transferring ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                            Transfer to Warehouse{directive ? ' + Directive' : ''}
                                        </button>
                                    </div>

                                    {/* Reject block */}
                                    <div className="border border-red-200 bg-red-50/50 rounded-2xl p-4 space-y-2">
                                        <p className="text-sm font-bold text-red-600 flex items-center gap-1.5">
                                            <XCircle size={15} /> Fraud / malicious / invalid
                                        </p>
                                        <textarea
                                            value={resolutionText}
                                            onChange={e => setResolutionText(e.target.value)}
                                            rows={2}
                                            placeholder="Rejection reason (visible in the customer's report history)"
                                            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-400"
                                        />
                                        <button
                                            onClick={() => handleClose('Rejected')}
                                            disabled={updateLoading}
                                            className="w-full py-2.5 rounded-xl bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                                        >
                                            <XCircle size={14} /> Reject Report
                                        </button>
                                    </div>

                                    {/* Mark under review */}
                                    <button
                                        onClick={() => handleClose('Under Review').then?.catch?.(() => {}) || (async () => {
                                            setUpdateLoading(true);
                                            try {
                                                const res = await apiFetch(`/admin/order-reports/${selectedReport.id}`, {
                                                    method: 'PATCH',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ status: 'Under Review' })
                                                });
                                                if (res.ok) { toast.success("Marked as Under Review"); setSelectedReport(null); fetchReports(); }
                                                else { const d = await res.json().catch(() => ({})); toast.error(d.message || "Failed"); }
                                            } finally { setUpdateLoading(false); }
                                        })()}
                                        disabled={updateLoading}
                                        className="w-full py-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        <Clock size={14} /> Mark Under Review
                                    </button>
                                </div>
                            )}

                            {/* Transferred: show override close */}
                            {['Transferred to Warehouse', 'In Warehouse Review'].includes(selectedReport.status) && (
                                <div className="space-y-3 border-t border-slate-100 pt-4">
                                    <div className="flex items-center gap-2 text-violet-600">
                                        <Package size={15} />
                                        <p className="text-sm font-bold">
                                            With {selectedReport.transferred_warehouse_name || 'warehouse'} for processing
                                        </p>
                                    </div>
                                    {selectedReport.action_required && (
                                        <p className="text-[11px] font-black uppercase tracking-wider text-violet-600 bg-violet-50 border border-violet-100 rounded-xl px-3 py-2">
                                            Directive: {selectedReport.action_required.replace(/_/g, ' ')}
                                        </p>
                                    )}
                                    {selectedReport.action_taken && (
                                        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-sm">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-0.5">Action taken by warehouse</p>
                                            <p className="font-bold text-emerald-700">{selectedReport.action_taken}</p>
                                        </div>
                                    )}
                                    <p className="text-[11px] text-gray-400">
                                        The warehouse owns the processing status. You may still close this report as an override.
                                    </p>
                                    <textarea
                                        value={resolutionText}
                                        onChange={e => setResolutionText(e.target.value)}
                                        rows={2}
                                        placeholder="Resolution note (optional)"
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            onClick={() => handleClose('Resolved')}
                                            disabled={updateLoading}
                                            className="py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                                        >
                                            <CheckCircle size={14} /> Resolve (override)
                                        </button>
                                        <button
                                            onClick={() => handleClose('Rejected')}
                                            disabled={updateLoading}
                                            className="py-2.5 rounded-xl bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                                        >
                                            <XCircle size={14} /> Reject (override)
                                        </button>
                                    </div>

                                    {/* Escalate against warehouse */}
                                    <div className="border border-orange-200 bg-orange-50/50 rounded-2xl p-3 space-y-2">
                                        <p className="text-sm font-bold text-orange-700 flex items-center gap-1.5">
                                            <ArrowUpCircle size={15} /> Unsatisfactory handling? Escalate against warehouse
                                        </p>
                                        <textarea
                                            value={escalationNote}
                                            onChange={e => setEscalationNote(e.target.value)}
                                            rows={2}
                                            placeholder="Escalation note — why the warehouse's handling is unacceptable (formal warning recorded)"
                                            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-400"
                                        />
                                        <button
                                            onClick={handleEscalate}
                                            disabled={escalating || !escalationNote.trim()}
                                            className="w-full py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                                        >
                                            {escalating ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
                                            Escalate + Formal Warning
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Escalated state */}
                            {selectedReport.status === 'Escalated to Admin' && (
                                <div className="border border-orange-200 bg-orange-50 rounded-xl p-3 space-y-2">
                                    <p className="text-sm font-black text-orange-700 flex items-center gap-1.5">
                                        <AlertTriangle size={15} /> Escalated to Admin — admin owns this report now
                                    </p>
                                    {selectedReport.escalation_note && (
                                        <p className="text-xs text-orange-800"><b>Escalation note:</b> {selectedReport.escalation_note}</p>
                                    )}
                                    {selectedReport.action_taken && (
                                        <p className="text-xs text-gray-600"><b>Warehouse had recorded:</b> {selectedReport.action_taken}</p>
                                    )}
                                    <textarea
                                        value={resolutionText}
                                        onChange={e => setResolutionText(e.target.value)}
                                        rows={2}
                                        placeholder="Final resolution (customer-visible)"
                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-300"
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            onClick={() => handleClose('Resolved')}
                                            disabled={updateLoading}
                                            className="py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                                        >
                                            <CheckCircle size={14} /> Resolve
                                        </button>
                                        <button
                                            onClick={() => handleClose('Rejected')}
                                            disabled={updateLoading}
                                            className="py-2.5 rounded-xl bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                                        >
                                            <XCircle size={14} /> Reject
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Closed states */}
                            {['Action Taken', 'Resolved', 'Rejected'].includes(selectedReport.status) && selectedReport.status !== 'Escalated to Admin' && (
                                <div className="border-t border-slate-100 pt-4 space-y-2">
                                    {selectedReport.action_taken && (
                                        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-sm">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-0.5">Warehouse action</p>
                                            <p className="font-bold text-emerald-700">{selectedReport.action_taken}</p>
                                            {selectedReport.action_notes && <p className="text-xs text-gray-500 mt-1">{selectedReport.action_notes}</p>}
                                        </div>
                                    )}
                                    {selectedReport.resolution && (
                                        <p className="text-xs text-gray-600 bg-slate-50 rounded-xl p-3"><b>Resolution:</b> {selectedReport.resolution}</p>
                                    )}
                                    {selectedReport.admin_notes && (
                                        <p className="text-xs text-gray-600 bg-slate-50 rounded-xl p-3"><b>Admin notes:</b> {selectedReport.admin_notes}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default OrderReports;
