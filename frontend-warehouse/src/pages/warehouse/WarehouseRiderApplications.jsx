import { useState, useEffect, useCallback } from 'react'
import {
    Truck,
    User,
    Calendar,
    CheckCircle,
    XCircle,
    Clock,
    Loader2,
    AlertCircle,
    ArrowLeft,
    Building2,
    Search,
    Filter
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate, Link } from 'react-router-dom'
import { apiClient } from '../../utils/apiClient'
import { useAlertStore } from '../../store/useAlertStore'

const WarehouseRiderApplications = () => {
    const navigate = useNavigate()
    const { warehouseToken, warehouseLogout } = useStore()
    const [applications, setApplications] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [processingId, setProcessingId] = useState(null)
    const [searchTerm, setSearchTerm] = useState('')

    const fetchApplications = useCallback(async () => {
        if (!warehouseToken) return
        setLoading(true)
        try {
            const res = await fetch(`${API_BASE_URL}/warehouse/delivery-applications`, {
                headers: { 'Authorization': `Bearer ${warehouseToken}` }
            })
            if (res.status === 401 || res.status === 403) {
                warehouseLogout()
                navigate('/warehouse/login')
                return
            }
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to fetch applications')
            setApplications(data)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [warehouseToken, warehouseLogout, navigate])

    useEffect(() => {
        fetchApplications()
    }, [fetchApplications])

    const handleApproval = async (appId, approvalStatus) => {
        setProcessingId(appId)
        try {
            const res = await fetch(`${API_BASE_URL}/warehouse/delivery/approve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${warehouseToken}`
                },
                body: JSON.stringify({
                    application_id: appId,
                    status: approvalStatus // 'approved_by_store' or 'rejected'
                })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Action failed')

            // Refresh list
            fetchApplications()
        } catch (e) {
            alert(e.message)
        } finally {
            setProcessingId(null)
        }
    }

    const filteredApps = applications.filter(app =>
        app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.partner_id.toLowerCase().includes(searchTerm.toLowerCase())
    )

    if (loading) return (
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
            <Loader2 className="w-10 h-10 text-teal-500 animate-spin" />
            <p className="text-slate-400 font-medium italic animate-pulse">Fetching Rider Requests...</p>
        </div>
    )

    return (
            <div>
                <Link 
                    to="/warehouse/manage-riders" 
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-all text-xs font-bold mb-4 group"
                >
                    <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-1" />
                    Back to Management
                </Link>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-black text-white flex items-center gap-3">
                            <Truck className="w-8 h-8 text-teal-500" />
                            Rider Onboarding
                        </h2>
                    <p className="text-slate-400 text-sm mt-1">Review and recommend delivery partners for your store.</p>
                </div>

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                        type="text"
                        placeholder="Search riders..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded-xl py-2 pl-10 pr-4 text-sm text-slate-200 outline-none focus:border-teal-500/50 transition-all w-full md:w-64"
                    />
                </div>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-center gap-3 text-red-400 text-sm">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 gap-4">
                {filteredApps.length === 0 ? (
                    <div className="bg-slate-900/50 border border-slate-800/50 border-dashed rounded-3xl p-12 text-center">
                        <div className="w-20 h-20 bg-slate-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Clock className="w-10 h-10 text-slate-600" />
                        </div>
                        <h3 className="text-slate-300 font-bold text-lg">No Pending Requests</h3>
                        <p className="text-slate-500 text-sm mt-2 max-w-xs mx-auto">New rider applications for your store will appear here for initial approval.</p>
                    </div>
                ) : (
                    filteredApps.map((app) => (
                        <div key={app.id} className="bg-slate-900/80 border border-slate-800 p-6 rounded-3xl hover:border-slate-700 transition-all group">
                            <div className="flex flex-col md:flex-row justify-between gap-6">
                                <div className="flex gap-4">
                                    <div className="w-14 h-14 bg-teal-500/10 border border-teal-500/20 rounded-2xl flex items-center justify-center text-teal-500 shrink-0">
                                        <User className="w-8 h-8" />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h4 className="text-lg font-bold text-white">{app.name}</h4>
                                            <span className="text-[10px] font-black bg-teal-500/10 text-teal-400 border border-teal-500/20 px-2 py-0.5 rounded-full uppercase tracking-widest">{app.partner_id}</span>
                                        </div>
                                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                                            <p className="text-sm text-slate-400 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Applied {new Date(app.created_at).toLocaleDateString()}</p>
                                            <p className="text-sm text-slate-400 flex items-center gap-1.5 capitalize"><Truck className="w-3.5 h-3.5" /> {app.vehicle_type}</p>
                                        </div>
                                        <p className="text-sm text-slate-500 mt-2 italic">"{app.address}, {app.pincode}"</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => handleApproval(app.id, 'rejected')}
                                        disabled={!!processingId}
                                        className="bg-red-500/10 hover:bg-red-500/20 text-red-500 text-sm font-bold px-5 py-2.5 rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                                    >
                                        <XCircle className="w-4 h-4" />
                                        Reject
                                    </button>
                                    <button
                                        onClick={() => handleApproval(app.id, 'approved_by_store')}
                                        disabled={!!processingId}
                                        className="bg-teal-500 hover:bg-teal-600 text-slate-950 text-sm font-black px-6 py-2.5 rounded-xl transition-all shadow-lg shadow-teal-500/20 disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {processingId === app.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                        Recommend to Admin
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}

export default WarehouseRiderApplications
