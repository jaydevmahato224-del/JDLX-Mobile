import { useState, useEffect } from 'react'
import { 
    CheckCircle2, XCircle, Search, Clock, 
    Filter, MoreHorizontal, User, Truck, 
    Mail, Phone, MapPin, Calendar, 
    AlertCircle, FileText, ChevronRight,
    Building2, RefreshCw, UserPlus, X
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { Link } from 'react-router-dom'

function AdminDeliveryApplications() {
    const [applications, setApplications] = useState([])
    const [loading, setLoading] = useState(true)
    const [, setError] = useState(null)
    const [filter, setFilter] = useState('pending_admin')
    const [searchTerm, setSearchTerm] = useState('')
    const [selectedApp, setSelectedApp] = useState(null)
    const [actionLoading, setActionLoading] = useState(false)
    const [adminNotes, setAdminNotes] = useState('')
    const [showAddForm, setShowAddForm] = useState(false);
    const [addFormData, setAddFormData] = useState({ name: '', phone: '', vehicle_type: 'bike', address: '', pincode: '' });

    const handleAddPartner = async (e) => {
        e.preventDefault();
        setActionLoading(true);
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/delivery-partner`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(addFormData)
            });
            if (!res.ok) throw new Error('Failed to create partner');
            setShowAddForm(false);
            setAddFormData({ name: '', phone: '', vehicle_type: 'bike', address: '', pincode: '' });
            fetchApplications();
        } catch (err) {
            console.error(err);
            alert(err.message);
        } finally {
            setActionLoading(false);
        }
    };

    const fetchApplications = async () => {
        setLoading(true)
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token')
            const response = await fetch(`${API_BASE_URL}/admin/delivery/applications?status=${filter}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (!response.ok) throw new Error('Failed to fetch applications')
            const data = await response.json()
            setApplications(data)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchApplications()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fetch on mount only
    }, [filter])

    const handleAction = async (appId, status) => {
        setActionLoading(true)
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token')
            const response = await fetch(`${API_BASE_URL}/admin/delivery/approve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    application_id: appId,
                    status: status,
                    admin_notes: adminNotes
                })
            })
            if (!response.ok) throw new Error('Action failed')
            
            // Success
            setSelectedApp(null)
            setAdminNotes('')
            fetchApplications()
        } catch (err) {
            alert(err.message)
        } finally {
            setActionLoading(false)
        }
    }

    const filteredApps = applications.filter(app => {
        const term = searchTerm.toLowerCase();
        return (
            (app.name || "").toLowerCase().includes(term) ||
            (app.email || "").toLowerCase().includes(term) ||
            (app.partner_id || "").toLowerCase().includes(term)
        );
    })

    return (
        <div className="p-6 max-w-[1600px] mx-auto min-h-screen bg-[#f8fafc]">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <div className="p-2 bg-slate-900 rounded-xl text-white shadow-xl shadow-slate-200">
                            <Truck size={28} />
                        </div>
                        Delivery Management Hub
                    </h1>
                    <p className="text-slate-500 mt-1 font-medium italic">Manage your active fleet and review incoming rider applications</p>
                </div>
                
                <div className="flex items-center gap-4">
                    <button 
                        onClick={() => setShowAddForm(true)}
                        className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-900 transition-all shadow-xl shadow-indigo-100 active:scale-95"
                    >
                        <UserPlus size={18} /> Add Partner
                    </button>
                    <div className="flex items-center gap-2 bg-white p-1 rounded-2xl shadow-sm border border-slate-200">
                    {[
                        { id: 'pending_admin', label: 'Requests' },
                        { id: 'pending_store', label: 'In Store' },
                        { id: 'approved', label: 'Active' },
                        { id: 'rejected', label: 'Denied' }
                    ].map(s => (
                        <button
                            key={s.id}
                            onClick={() => setFilter(s.id)}
                            className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${
                                filter === s.id 
                                ? 'bg-slate-900 text-white shadow-lg' 
                                : 'text-slate-500 hover:bg-slate-50'
                            }`}
                        >
                            {s.label}
                        </button>
                    ))}
                    </div>
                </div>
            </div>

            {/* Stats Bar */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-5">
                    <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
                        <Clock size={28} />
                    </div>
                    <div>
                        <p className="text-slate-500 text-sm font-bold uppercase tracking-wider">Awaiting Admin</p>
                        <h3 className="text-2xl font-black text-slate-900">{applications.filter(a => a.verification_status === 'pending_admin').length} Partners</h3>
                    </div>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-5">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                        <CheckCircle2 size={28} />
                    </div>
                    <div>
                        <p className="text-slate-500 text-sm font-bold uppercase tracking-wider">Approved Today</p>
                        <h3 className="text-2xl font-black text-slate-900">{applications.filter(a => a.verification_status === 'approved').length} Active</h3>
                    </div>
                </div>
                <div className="bg-indigo-600 p-6 rounded-3xl shadow-xl shadow-indigo-100 flex items-center gap-5 text-white">
                    <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center">
                        <User size={28} />
                    </div>
                    <div>
                        <p className="text-white/70 text-sm font-bold uppercase tracking-wider">Total Network</p>
                        <h3 className="text-2xl font-black">2.4k Riders</h3>
                    </div>
                </div>
            </div>

            {/* List Section */}
            <div className="bg-white rounded-[32px] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="relative group flex-1 max-w-md">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 group-focus-within:text-indigo-600 transition-colors" />
                        <input 
                            type="text" 
                            placeholder="Search by name, email or ID..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 bg-slate-50 border-none rounded-2xl text-slate-900 font-medium focus:ring-2 focus:ring-indigo-600/20 transition-all outline-none"
                        />
                    </div>
                    <button onClick={fetchApplications} className="p-3 bg-slate-50 text-slate-500 rounded-xl hover:bg-slate-100 transition-all border border-slate-200">
                        <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-slate-50/50 text-slate-500 text-xs font-black uppercase tracking-widest border-b border-slate-100">
                                <th className="px-8 py-5 text-left">Partner Details</th>
                                <th className="px-8 py-5 text-left">Dark Store</th>
                                <th className="px-8 py-5 text-left">Vehicle Type</th>
                                <th className="px-8 py-5 text-left">Pincode</th>
                                <th className="px-8 py-5 text-left">Submitted At</th>
                                <th className="px-8 py-5 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {loading ? (
                                <tr>
                                    <td colSpan="5" className="px-8 py-12 text-center text-slate-400 font-medium">Loading applications...</td>
                                </tr>
                            ) : filteredApps.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="px-8 py-12 text-center">
                                        <div className="flex flex-col items-center gap-3">
                                            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-300">
                                                <Filter size={32} />
                                            </div>
                                            <p className="text-slate-500 font-bold">No applications found matching your criteria</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredApps.map(app => (
                                    <tr key={app.id} className="hover:bg-slate-50/80 transition-colors group">
                                        <td className="px-8 py-6">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-lg uppercase">
                                                    {app.name ? app.name.charAt(0) : '?'}
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">{app.name}</h4>
                                                    <p className="text-sm text-slate-500 font-medium">{app.email}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-8 py-6 text-sm font-bold text-slate-700">
                                            <div className="flex items-center gap-2">
                                                <Building2 size={16} className="text-indigo-500" />
                                                {app.store_name || 'Generic'}
                                            </div>
                                        </td>
                                        <td className="px-8 py-6">
                                            <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-black uppercase tracking-wider border border-slate-200">
                                                {app.vehicle_type}
                                            </span>
                                        </td>
                                        <td className="px-8 py-6">
                                            <div className="flex items-center gap-2 text-slate-600 font-bold">
                                                <MapPin size={14} className="text-slate-400" />
                                                {app.pincode}
                                            </div>
                                        </td>
                                        <td className="px-8 py-6">
                                            <div className="flex items-center gap-2 text-slate-500 text-sm font-medium">
                                                <Calendar size={14} />
                                                {new Date(app.created_at).toLocaleDateString()}
                                            </div>
                                        </td>
                                        <td className="px-8 py-6">
                                            <div className="flex justify-end gap-2">
                                                <button 
                                                    onClick={() => setSelectedApp(app)}
                                                    className="p-2.5 bg-white text-slate-600 rounded-xl border border-slate-200 hover:border-indigo-400 hover:text-indigo-600 transition-all shadow-sm"
                                                >
                                                    <FileText size={18} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Details & Action Modal */}
            {selectedApp && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-2xl rounded-[40px] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-8 duration-500 border border-white/20">
                        {/* Modal Header */}
                        <div className="bg-slate-900 p-10 text-white relative">
                            <button onClick={() => setSelectedApp(null)} className="absolute top-8 right-8 p-2 bg-white/10 hover:bg-white/20 rounded-full transition-all">
                                <XCircle size={24} />
                            </button>
                            <div className="flex items-center gap-6">
                                <div className="w-20 h-20 bg-indigo-500 rounded-[32px] flex items-center justify-center border-4 border-white/10 shadow-2xl">
                                    <User size={36} />
                                </div>
                                <div>
                                    <h2 className="text-3xl font-black tracking-tight">{selectedApp.name || 'Unknown Partner'}</h2>
                                    <div className="flex items-center gap-4 mt-2">
                                        <span className="px-3 py-1 bg-white/10 rounded-lg text-xs font-black uppercase tracking-widest border border-white/10 italic">
                                            {selectedApp.partner_id || 'NO-ID'}
                                        </span>
                                        <div className="flex items-center gap-2 text-indigo-300">
                                            <Truck size={14} />
                                            <span className="text-xs font-bold uppercase tracking-widest">{selectedApp.vehicle_type}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Modal Body */}
                        <div className="p-10">
                            <div className="grid grid-cols-2 gap-8 mb-10">
                                <div className="flex items-start gap-4 p-5 bg-slate-50 rounded-3xl border border-slate-100">
                                    <div className="p-3 bg-white rounded-2xl shadow-sm text-slate-400"><Mail size={20} /></div>
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Email Terminal</p>
                                        <p className="text-slate-900 font-bold">{selectedApp.email}</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-4 p-5 bg-slate-50 rounded-3xl border border-slate-100">
                                    <div className="p-3 bg-white rounded-2xl shadow-sm text-slate-400"><Phone size={20} /></div>
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Call Connection</p>
                                        <p className="text-slate-900 font-bold">{selectedApp.phone || 'Not Provided'}</p>
                                    </div>
                                </div>
                                <div className="col-span-2 flex items-start gap-4 p-5 bg-slate-50 rounded-3xl border border-slate-100">
                                    <div className="p-3 bg-white rounded-2xl shadow-sm text-slate-400"><MapPin size={20} /></div>
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Onboarding Territory</p>
                                        <p className="text-slate-900 font-bold leading-relaxed">{selectedApp.address}, {selectedApp.pincode}</p>
                                    </div>
                                </div>
                            </div>

                            {selectedApp.verification_status === 'pending_admin' && (
                                <div className="space-y-6 animate-in fade-in slide-in-from-top-4 duration-700 delay-300">
                                    <div>
                                        <label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-3 block px-1">Admin Resolution Notes</label>
                                        <textarea 
                                            value={adminNotes}
                                            onChange={(e) => setAdminNotes(e.target.value)}
                                            placeholder="Specify reasons for approval or rejection (visible to partner)..."
                                            className="w-full bg-slate-50 border border-slate-200 rounded-[24px] p-6 text-slate-900 font-medium focus:ring-4 focus:ring-indigo-600/5 transition-all outline-none min-h-[120px] shadow-inner"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <button 
                                            onClick={() => handleAction(selectedApp.id, 'rejected')}
                                            disabled={actionLoading}
                                            className="py-5 bg-white border-2 border-rose-100 text-rose-600 rounded-[28px] font-black uppercase tracking-widest text-xs hover:bg-rose-50 hover:border-rose-200 transition-all active:scale-95 flex items-center justify-center gap-3"
                                        >
                                            <XCircle size={18} /> Reject Partner
                                        </button>
                                        <button 
                                            onClick={() => handleAction(selectedApp.id, 'approved')}
                                            disabled={actionLoading}
                                            className="py-5 bg-slate-900 text-white rounded-[28px] font-black uppercase tracking-widest text-xs hover:bg-indigo-600 transition-all shadow-xl shadow-indigo-200 active:scale-95 flex items-center justify-center gap-3"
                                        >
                                            <CheckCircle2 size={18} /> Approve & Onboard
                                        </button>
                                    </div>
                                </div>
                            )}

                            {selectedApp.verification_status !== 'pending_admin' && (
                                <div className={`p-6 rounded-[28px] flex items-center gap-4 ${
                                    selectedApp.verification_status === 'approved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'
                                }`}>
                                    {selectedApp.verification_status === 'approved' ? <CheckCircle2 size={24}/> : <XCircle size={24}/>}
                                    <div>
                                        <p className="font-black uppercase tracking-widest text-[10px] mb-0.5">Application {selectedApp.verification_status}</p>
                                        <p className="text-sm font-bold opacity-80">{selectedApp.admin_notes || 'No notes provided by admin.'}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* Add Partner Modal */}
            {showAddForm && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-xl rounded-[40px] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-8 duration-500 border border-white/20">
                        <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-white/10 rounded-2xl"><UserPlus size={24} /></div>
                                <h2 className="text-2xl font-black tracking-tight">Manual Onboarding</h2>
                            </div>
                            <button onClick={() => setShowAddForm(false)} className="p-2 hover:bg-white/10 rounded-full transition-all">
                                <X size={24} />
                            </button>
                        </div>
                        <form onSubmit={handleAddPartner} className="p-8 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block px-1">Full Name</label>
                                    <input required value={addFormData.name} onChange={(e) => setAddFormData({...addFormData, name: e.target.value})} type="text" placeholder="e.g. Rahul Kumar" className="w-full bg-slate-50 border-none rounded-2xl p-4 text-slate-900 font-bold focus:ring-2 focus:ring-indigo-600/20" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block px-1">Phone Number</label>
                                    <input required value={addFormData.phone} onChange={(e) => setAddFormData({...addFormData, phone: e.target.value})} type="tel" placeholder="+91 XXXX..." className="w-full bg-slate-50 border-none rounded-2xl p-4 text-slate-900 font-bold focus:ring-2 focus:ring-indigo-600/20" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block px-1">Vehicle</label>
                                    <select value={addFormData.vehicle_type} onChange={(e) => setAddFormData({...addFormData, vehicle_type: e.target.value})} className="w-full bg-slate-50 border-none rounded-2xl p-4 text-slate-900 font-bold focus:ring-2 focus:ring-indigo-600/20">
                                        <option value="bike">Bike</option>
                                        <option value="scooter">Scooter</option>
                                        <option value="cycle">Cycle</option>
                                    </select>
                                </div>
                                <div className="col-span-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 block px-1">Delivery Address/Hub</label>
                                    <input required value={addFormData.address} onChange={(e) => setAddFormData({...addFormData, address: e.target.value})} type="text" placeholder="Hub location or partial address" className="w-full bg-slate-50 border-none rounded-2xl p-4 text-slate-900 font-bold focus:ring-2 focus:ring-indigo-600/20" />
                                </div>
                            </div>
                            <button type="submit" disabled={actionLoading} className="w-full py-5 bg-slate-900 text-white rounded-[28px] font-black uppercase tracking-widest text-sm hover:bg-indigo-600 transition-all shadow-xl shadow-indigo-100 active:scale-95 flex items-center justify-center gap-3">
                                {actionLoading ? <RefreshCw className="animate-spin" /> : 'Confirm & Register Partner'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

export default AdminDeliveryApplications
