import { useEffect, useMemo, useState, useRef } from 'react'
import {
    AlertTriangle,
    CheckCircle2,
    Clock3,
    Eye,
    FileText,
    Image as ImageIcon,
    Mail,
    MapPin,
    Phone,
    RefreshCcw,
    Search,
    Warehouse,
    XCircle,
    Send,
    X,
    DollarSign,
    Users,
    Package,
    ShieldAlert,
    ShieldOff,
    UserX,
    UserCheck,
    Trash2,
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ReferenceLine,
    BarChart,
    Bar,
    Cell
} from 'recharts'

const STATUS_FILTERS = ['all', 'pending', 'approved', 'suspended', 'banned', 'rejected']

function formatDateTime(value) {
    if (!value) {
        return 'Not available'
    }

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return value
    }

    return date.toLocaleString()
}

function formatStatus(status) {
    return String(status || 'pending').replace(/_/g, ' ')
}

function statusClasses(status) {
    switch (status) {
        case 'approved':
            return 'bg-emerald-100 text-emerald-700 border-emerald-200'
        case 'rejected':
            return 'bg-rose-100 text-rose-700 border-rose-200'
        case 'suspended':
            return 'bg-amber-100 text-amber-700 border-amber-200'
        case 'banned':
            return 'bg-slate-100 text-slate-700 border-slate-200'
        default:
            return 'bg-blue-100 text-blue-700 border-blue-200'
    }
}

function operationsStatusClasses(status) {
    switch (status) {
        case 'open':
            return 'bg-emerald-500 text-white border-emerald-600'
        case 'closed':
            return 'bg-rose-500 text-white border-rose-600'
        default:
            return 'bg-slate-400 text-white border-slate-500'
    }
}


function assetUrl(path) {
    if (!path) {
        return null
    }

    if (/^https?:\/\//i.test(path)) {
        return path
    }

    const backendOrigin = API_BASE_URL.replace(/\/api\/?$/, '')
    return `${backendOrigin}${path}`
}

function AdminWarehouseApplications() {
    const storeAdminToken = useStore((state) => state.adminToken)
    const storeToken = useStore((state) => state.token)
    const adminToken = storeAdminToken || storeToken
    const adminUser = useStore((state) => state.adminUser)
    const [applications, setApplications] = useState([])
    const [loading, setLoading] = useState(true)
    const [selectedId, setSelectedId] = useState(null)
    const [statusFilter, setStatusFilter] = useState('all')
    const [query, setQuery] = useState('')
    const [reviewNotes, setReviewNotes] = useState('')
    const [actionLoading, setActionLoading] = useState('')
    const [banner, setBanner] = useState({ type: '', text: '' })
    
    // Email Modal State
    const [showEmailModal, setShowEmailModal] = useState(false)
    const [emailSubject, setEmailSubject] = useState('')
    const [emailMessage, setEmailMessage] = useState('')
    const [sendingEmail, setSendingEmail] = useState(false)

    // Analytics Stats State
    const [stats, setStats] = useState(null)
    const [statsLoading, setStatsLoading] = useState(false)
    const [performance, setPerformance] = useState(null)
    const [perfLoading, setPerfLoading] = useState(false)

    // Note Popover State
    const [activeNote, setActiveNote] = useState(null)
    const noteRef = useRef(null)

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (noteRef.current && !noteRef.current.contains(event.target)) {
                setActiveNote(null)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const fetchApplications = async () => {
        if (!adminToken) {
            return
        }

        setLoading(true)
        try {
            const response = await fetch(`${API_BASE_URL}/admin/warehouse/applications`, {
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            })
            const data = await response.json()
            if (!response.ok) {
                throw new Error(data.error || 'Failed to load warehouse applications.')
            }
            setApplications(Array.isArray(data) ? data : (data.applications || []))
        } catch (error) {
            console.error(error)
            setBanner({ type: 'error', text: error.message || 'Failed to load warehouse applications.' })
            setApplications([])
        } finally {
            setLoading(false)
        }
    }

    /* eslint-disable react-hooks/exhaustive-deps -- intentional: fetch on mount only */
    useEffect(() => {
        fetchApplications()
    }, [adminToken])

    const fetchStats = async (appId) => {
        if (!adminToken || !appId) return
        setStatsLoading(true)
        try {
            const response = await fetch(`${API_BASE_URL}/admin/warehouse/applications/${appId}/stats`, {
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            })
            const data = await response.json()
            if (response.ok) {
                setStats(data)
            }
        } catch (error) {
            console.error('Failed to fetch stats:', error)
        } finally {
            setStatsLoading(false)
        }
    }

    const fetchPerformance = async (appId) => {
        if (!adminToken || !appId) return
        setPerfLoading(true)
        try {
            const response = await fetch(`${API_BASE_URL}/admin/warehouse-performance/${appId}`, {
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                },
            })
            const data = await response.json()
            if (response.ok) {
                setPerformance(data)
            }
        } catch (error) {
            console.error('Failed to fetch performance:', error)
        } finally {
            setPerfLoading(false)
        }
    }

    /* eslint-disable react-hooks/exhaustive-deps -- intentional: fetch on mount only */
    useEffect(() => {
        if (selectedId) {
            fetchStats(selectedId)
            fetchPerformance(selectedId)
        } else {
            setStats(null)
            setPerformance(null)
        }
    }, [selectedId, adminToken])

    const filteredApplications = useMemo(() => {
        return applications.filter((application) => {
            const matchesStatus = statusFilter === 'all' || application.verification_status === statusFilter
            const haystack = [
                application.warehouse_name,
                application.owner_name,
                application.email,
                application.address,
                application.pincode,
            ]
                .join(' ')
                .toLowerCase()
            const matchesQuery = !query.trim() || haystack.includes(query.trim().toLowerCase())
            return matchesStatus && matchesQuery
        })
    }, [applications, query, statusFilter])

    useEffect(() => {
        if (!filteredApplications.length) {
            setSelectedId(null)
            setReviewNotes('')
            return
        }

        const currentSelected = filteredApplications.find((application) => application.id === selectedId)
        if (!currentSelected && filteredApplications.length > 0) {
            setSelectedId(filteredApplications[0].id)
            setReviewNotes(filteredApplications[0].admin_notes || '')
        }
    }, [filteredApplications, selectedId])

    const selectedApplication = filteredApplications.find((application) => application.id === selectedId) || null

    /* eslint-disable react-hooks/exhaustive-deps -- intentional: fetch on mount only */
    useEffect(() => {
        if (!selectedApplication) {
            return
        }

        setReviewNotes(selectedApplication.admin_notes || '')
    }, [selectedApplication?.id])

    const pendingCount = applications.filter((app) => app.verification_status === 'pending').length
    const approvedCount = applications.filter((app) => app.verification_status === 'approved').length
    const suspendedCount = applications.filter((app) => app.verification_status === 'suspended').length
    const bannedCount = applications.filter((app) => app.verification_status === 'banned').length
    const rejectedCount = applications.filter((app) => app.verification_status === 'rejected').length

    const handleReview = async (action) => {
        if (!selectedApplication) {
            return
        }

        setActionLoading(action)
        try {
            const response = await fetch(`${API_BASE_URL}/admin/warehouse/applications/${selectedApplication.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${adminToken}`,
                },
                body: JSON.stringify({
                    action,
                    notes: reviewNotes,
                }),
            })
            const data = await response.json()
            if (!response.ok) {
                throw new Error(data.error || `Failed to ${action} warehouse application.`)
            }

            setBanner({ type: 'success', text: data.message || `Warehouse application ${action}d successfully.` })
            await fetchApplications()
        } catch (error) {
            console.error(error)
            setBanner({ type: 'error', text: error.message || `Failed to ${action} warehouse application.` })
        } finally {
            setActionLoading('')
        }
    }

    const handleSendEmail = async (e) => {
        e.preventDefault()
        if (!selectedApplication || !emailSubject || !emailMessage) return

        setSendingEmail(true)
        setBanner({ type: '', text: '' })

        try {
            const response = await fetch(`${API_BASE_URL}/admin/warehouse/applications/${selectedApplication.id}/send-email`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${adminToken}`,
                },
                body: JSON.stringify({
                    subject: emailSubject,
                    message: emailMessage
                }),
            })

            const data = await response.json()
            if (!response.ok) throw new Error(data.error || 'Failed to send email.')

            setBanner({ type: 'success', text: 'Email sent successfully to applicant.' })
            setShowEmailModal(false)
            setEmailSubject('')
            setEmailMessage('')
        } catch (error) {
            setBanner({ type: 'error', text: error.message })
        } finally {
            setSendingEmail(false)
        }
    }

    return (
        <div className="py-6 flex flex-col gap-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-primary">Warehouse Onboarding</p>
                    <h1 className="mt-2 text-3xl font-black text-gray-900 tracking-tight">Warehouse Applications</h1>
                    <p className="mt-2 text-sm text-gray-500">
                        Review, approve or reject warehouse partner requests without leaving the admin panel.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={fetchApplications}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-slate-800"
                >
                    <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Refresh applications
                </button>
            </div>

            {banner.text ? (
                <div
                    className={`rounded-2xl px-4 py-3 text-sm font-semibold ${
                        banner.type === 'error'
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-emerald-100 text-emerald-700'
                    }`}
                >
                    {banner.text}
                </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <div className="glass-card p-5">
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-gray-400">Pending</p>
                    <h2 className="mt-3 text-3xl font-black text-amber-600">{pendingCount}</h2>
                    <p className="mt-2 text-xs text-gray-500">Waiting for review</p>
                </div>
                <div className="glass-card p-5 border-l-4 border-l-emerald-500">
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-gray-400">Approved</p>
                    <h2 className="mt-3 text-3xl font-black text-emerald-600">{approvedCount}</h2>
                    <p className="mt-2 text-xs text-gray-500">Active partners</p>
                </div>
                <div className="glass-card p-5 border-l-4 border-l-amber-500">
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-gray-400">Suspended</p>
                    <h2 className="mt-3 text-3xl font-black text-amber-500">{suspendedCount}</h2>
                    <p className="mt-2 text-xs text-gray-500">Temp disabled</p>
                </div>
                <div className="glass-card p-5 border-l-4 border-l-slate-800">
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-gray-400">Banned</p>
                    <h2 className="mt-3 text-3xl font-black text-slate-800">{bannedCount}</h2>
                    <p className="mt-2 text-xs text-gray-500">Blocked accounts</p>
                </div>
                <div className="glass-card p-5 border-l-4 border-l-rose-500">
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-gray-400">Rejected</p>
                    <h2 className="mt-3 text-3xl font-black text-rose-600">{rejectedCount}</h2>
                    <p className="mt-2 text-xs text-gray-500">Declined requests</p>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                <section className="glass-card p-5 flex flex-col gap-4">
                    <div className="flex flex-col gap-3 md:flex-row">
                        <label className="relative flex-1">
                            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                            <input
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Search by warehouse, owner or email"
                                className="w-full rounded-2xl border border-gray-200 bg-white pl-11 pr-4 py-3 text-sm font-medium text-gray-700 outline-none transition focus:border-primary/40"
                            />
                        </label>
                        <select
                            value={statusFilter}
                            onChange={(event) => setStatusFilter(event.target.value)}
                            className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 outline-none transition focus:border-primary/40"
                        >
                            {STATUS_FILTERS.map((filter) => (
                                <option key={filter} value={filter}>
                                    {filter === 'all' ? 'All statuses' : formatStatus(filter)}
                                </option>
                            ))}
                        </select>
                    </div>

                    {loading ? (
                        <div className="flex min-h-[320px] items-center justify-center">
                            <RefreshCcw className="w-6 h-6 animate-spin text-primary" />
                        </div>
                    ) : filteredApplications.length === 0 ? (
                        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-gray-200 bg-white/60 text-center">
                            <Warehouse className="w-10 h-10 text-gray-300" />
                            <p className="mt-4 text-sm font-semibold text-gray-600">No warehouse applications match the current filter.</p>
                        </div>
                    ) : (
                        <div className="space-y-3 pr-1">
                            {filteredApplications.map((application) => {
                                const isSelected = application.id === selectedId
                                return (
                                    <button
                                        key={application.id}
                                        type="button"
                                        onClick={() => setSelectedId(application.id)}
                                        className={`w-full rounded-3xl border px-4 py-4 text-left transition-all ${
                                            isSelected
                                                ? 'border-primary bg-primary/5 shadow-md'
                                                : 'border-gray-200 bg-white hover:border-primary/30'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-lg font-black text-gray-900">{application.warehouse_name}</p>
                                                <p className="mt-1 text-sm font-medium text-gray-500">{application.owner_name}</p>
                                            </div>
                                            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${statusClasses(application.verification_status)}`}>
                                                {formatStatus(application.verification_status)}
                                            </span>
                                            {application.verification_status === 'approved' && application.operations_status && (
                                                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${operationsStatusClasses(application.operations_status)}`}>
                                                    {application.operations_status}
                                                </span>
                                            )}
                                        </div>

                                        <div className="mt-4 flex flex-col gap-2 text-sm text-gray-600">
                                            <p className="flex items-center gap-2">
                                                <Mail className="w-4 h-4 text-gray-400" />
                                                {application.email}
                                            </p>
                                            <p className="flex items-center gap-2">
                                                <Phone className="w-4 h-4 text-gray-400" />
                                                {application.phone || 'Phone not provided'}
                                            </p>
                                            <p className="flex items-center gap-2">
                                                <Clock3 className="w-4 h-4 text-gray-400" />
                                                Submitted {formatDateTime(application.created_at)}
                                            </p>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </section>

                <section className="glass-card p-5">
                    {!selectedApplication ? (
                        <div className="flex min-h-[520px] flex-col items-center justify-center text-center">
                            <Eye className="w-10 h-10 text-gray-300" />
                            <p className="mt-4 text-lg font-bold text-gray-700">Select an application</p>
                            <p className="mt-2 max-w-sm text-sm text-gray-500">
                                Pick a warehouse request from the left column to review its details and take action.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                    <div className="flex flex-wrap items-center gap-3">
                                        <h2 className="text-2xl font-black text-gray-900">{selectedApplication.warehouse_name}</h2>
                                        <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${statusClasses(selectedApplication.verification_status)}`}>
                                            {formatStatus(selectedApplication.verification_status)}
                                        </span>
                                        {selectedApplication.verification_status === 'approved' && selectedApplication.operations_status && (
                                            <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] shadow-sm flex items-center gap-1.5 ${operationsStatusClasses(selectedApplication.operations_status)}`}>
                                                <div className={`w-1.5 h-1.5 rounded-full bg-white ${selectedApplication.operations_status === 'open' ? 'animate-pulse' : ''}`} />
                                                Store {selectedApplication.operations_status.toUpperCase()}
                                            </span>
                                        )}
                                    </div>

                                    {selectedApplication.store_code && (
                                        <p className="mt-1 text-sm font-bold text-gray-700">
                                            Store ID: <span className="font-black text-primary">{selectedApplication.store_code}</span>
                                        </p>
                                    )}
                                    <p className="mt-2 text-sm text-gray-500">
                                        Reviewed by {selectedApplication.approved_by_name || 'Not assigned'} • Last updated {formatDateTime(selectedApplication.updated_at)}
                                    </p>
                                </div>

                                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-right">
                                    <p className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">Type</p>
                                    <p className="mt-1 text-sm font-bold text-gray-800">{formatStatus(selectedApplication.warehouse_type)}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div className="rounded-3xl border border-gray-200 bg-white p-4">
                                    <p className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">Owner</p>
                                    <p className="mt-3 text-lg font-bold text-gray-900">{selectedApplication.owner_name}</p>
                                    <div className="mt-4 space-y-2 text-sm text-gray-600">
                                        {selectedApplication.partner_id && (
                                            <p className="flex items-center gap-2 mb-2 font-bold text-gray-800">
                                                <UserCheck className="w-4 h-4 text-primary" />
                                                Partner ID: {selectedApplication.partner_id}
                                            </p>
                                        )}
                                        <p className="flex items-center gap-2">
                                            <Mail className="w-4 h-4 text-gray-400" />
                                            {selectedApplication.email}
                                        </p>
                                        <p className="flex items-center gap-2">
                                            <Phone className="w-4 h-4 text-gray-400" />
                                            {selectedApplication.phone || 'Phone not provided'}
                                        </p>
                                    </div>
                                </div>

                                <div className="rounded-3xl border border-gray-200 bg-white p-4">
                                    <p className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">Facility</p>
                                    <p className="mt-3 text-lg font-bold text-gray-900">{selectedApplication.pincode || 'Pincode unavailable'}</p>
                                    <div className="mt-4 space-y-2 text-sm text-gray-600">
                                        <p className="flex items-center gap-2">
                                            <Warehouse className="w-4 h-4 text-gray-400" />
                                            Capacity {selectedApplication.warehouse_capacity || 0}
                                        </p>
                                        <p className="flex items-start gap-2">
                                            <MapPin className="mt-0.5 w-4 h-4 text-gray-400" />
                                            <span>{selectedApplication.address || 'Address not provided'}</span>
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Real-time Analytics Section */}
                            {stats && (
                                <div className="rounded-3xl border border-gray-200 bg-white p-4 transition-all animate-in fade-in slide-in-from-bottom-2">
                                    <div className="flex items-center justify-between mb-4">
                                        <p className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">Warehouse Performance</p>
                                        {statsLoading && <RefreshCcw className="w-3 h-3 text-primary animate-spin" />}
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                                        <div className="rounded-2xl bg-emerald-50 p-3 border border-emerald-100/50">
                                            <div className="flex items-center gap-2 mb-1">
                                                <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                                                <p className="text-[9px] font-black uppercase tracking-[0.12em] text-emerald-700/70">Daily Sale</p>
                                            </div>
                                            <p className="text-base font-black text-emerald-700">₹{stats.daily_sales}</p>
                                        </div>
                                        
                                        <div className="rounded-2xl bg-blue-50 p-3 border border-blue-100/50">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Users className="w-3.5 h-3.5 text-blue-600" />
                                                <p className="text-[9px] font-black uppercase tracking-[0.12em] text-blue-700/70">Riders</p>
                                            </div>
                                            <p className="text-base font-black text-blue-700">{stats.assigned_riders}</p>
                                        </div>

                                        <div className="rounded-2xl bg-indigo-50 p-3 border border-indigo-100/50">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Package className="w-3.5 h-3.5 text-indigo-600" />
                                                <p className="text-[9px] font-black uppercase tracking-[0.12em] text-indigo-700/70">In-Process</p>
                                            </div>
                                            <p className="text-base font-black text-indigo-700">{stats.active_orders}</p>
                                        </div>

                                        <div className="rounded-2xl bg-slate-50 p-3 border border-slate-200/50">
                                            <div className="flex items-center gap-2 mb-1">
                                                <CheckCircle2 className="w-3.5 h-3.5 text-slate-600" />
                                                <p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-700/70">Delivered</p>
                                            </div>
                                            <p className="text-base font-black text-slate-700">{stats.total_delivered}</p>
                                        </div>

                                        <div className="rounded-2xl bg-rose-50 p-3 border border-rose-100/50">
                                            <div className="flex items-center gap-2 mb-1">
                                                <XCircle className="w-3.5 h-3.5 text-rose-600" />
                                                <p className="text-[9px] font-black uppercase tracking-[0.12em] text-rose-700/70">Cancelled</p>
                                            </div>
                                            <p className="text-base font-black text-rose-700">{stats.total_cancelled}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Performance Charts Section */}
                            {performance && (
                                <div className="space-y-4 transition-all animate-in fade-in slide-in-from-bottom-2">
                                    <div className="rounded-3xl border border-gray-200 bg-white p-6">
                                        <div className="flex items-center justify-between mb-6">
                                            <div>
                                                <p className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">Historical Performance</p>
                                                {performance.is_demo && (
                                                    <p className="mt-1 text-[10px] font-bold text-amber-500 flex items-center gap-1">
                                                        <AlertTriangle className="w-3 h-3" />
                                                        Showing simulated data for preview
                                                    </p>
                                                )}
                                            </div>
                                            {perfLoading && <RefreshCcw className="w-3 h-3 text-primary animate-spin" />}
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                            {/* Sales Diagram */}
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="text-sm font-black text-gray-900 flex items-center gap-2">
                                                       <DollarSign className="w-4 h-4 text-emerald-500" />
                                                       Daily Sales Trend
                                                    </h4>
                                                    <div className="flex gap-4 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                                                       <span>Avg: ₹{performance.stats.sales.avg}</span>
                                                       <span className="text-emerald-600">Max: ₹{performance.stats.sales.max}</span>
                                                    </div>
                                                </div>
                                                <div className="h-48 w-full">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <AreaChart data={performance.history}>
                                                            <defs>
                                                                <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                                                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                                                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                                                </linearGradient>
                                                            </defs>
                                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                            <XAxis 
                                                                dataKey="date" 
                                                                axisLine={false} 
                                                                tickLine={false} 
                                                                tick={{fontSize: 9, fontWeight: 700, fill: '#64748b'}}
                                                                tickFormatter={(str) => {
                                                                    const d = new Date(str);
                                                                    return d.getDate() + "/" + (d.getMonth() + 1);
                                                                }}
                                                            />
                                                            <YAxis hide />
                                                            <Tooltip 
                                                                contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px', fontWeight: 700}}
                                                                formatter={(val) => [`₹${val}`, 'Sales']}
                                                            />
                                                            <ReferenceLine y={performance.stats.sales.avg} stroke="#10b981" strokeDasharray="3 3" label={{ position: 'right', value: 'AVG', fill: '#10b981', fontSize: 8, fontWeight: 900 }} />
                                                            <Area type="monotone" dataKey="daily_revenue" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
                                                        </AreaChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            </div>

                                            {/* Orders Diagram */}
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="text-sm font-black text-gray-900 flex items-center gap-2">
                                                       <Package className="w-4 h-4 text-indigo-500" />
                                                       Orders Volume
                                                    </h4>
                                                    <div className="flex gap-4 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                                                       <span>Avg: {performance.stats.orders.avg}</span>
                                                       <span className="text-indigo-600">Max: {performance.stats.orders.max}</span>
                                                    </div>
                                                </div>
                                                <div className="h-48 w-full">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <BarChart data={performance.history}>
                                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                            <XAxis 
                                                                dataKey="date" 
                                                                axisLine={false} 
                                                                tickLine={false} 
                                                                tick={{fontSize: 9, fontWeight: 700, fill: '#64748b'}}
                                                                tickFormatter={(str) => {
                                                                    const d = new Date(str);
                                                                    return d.getDate() + "/" + (d.getMonth() + 1);
                                                                }}
                                                            />
                                                            <YAxis hide />
                                                            <Tooltip 
                                                                contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px', fontWeight: 700}}
                                                                formatter={(val) => [val, 'Orders']}
                                                            />
                                                            <ReferenceLine y={performance.stats.orders.avg} stroke="#6366f1" strokeDasharray="3 3" label={{ position: 'right', value: 'AVG', fill: '#6366f1', fontSize: 8, fontWeight: 900 }} />
                                                            <Bar dataKey="daily_orders" radius={[4, 4, 0, 0]}>
                                                                {performance.history.map((entry, index) => (
                                                                    <Cell 
                                                                        key={`cell-${index}`} 
                                                                        fill={entry.daily_orders >= performance.stats.orders.avg ? '#6366f1' : '#e2e8f0'} 
                                                                    />
                                                                ))}
                                                            </Bar>
                                                        </BarChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="rounded-3xl border border-gray-200 bg-white p-4">
                                <p className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">Application trail</p>
                                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3 relative">
                                    <div className="rounded-2xl bg-slate-50 p-4">
                                        <p className="text-xs font-black uppercase tracking-[0.16em] text-gray-400">Created</p>
                                        <p className="mt-2 text-sm font-bold text-gray-800">{formatDateTime(selectedApplication.created_at)}</p>
                                    </div>
                                    
                                    <div 
                                        onClick={() => selectedApplication.approved_at && setActiveNote({ title: 'Approval Notes', content: selectedApplication.admin_notes || 'No notes provided during approval.' })}
                                        className={`rounded-2xl p-4 transition-all duration-300 relative ${selectedApplication.approved_at ? 'bg-emerald-50 cursor-pointer hover:bg-emerald-100 border border-emerald-100' : 'bg-slate-50 opacity-50'}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <p className={`text-xs font-black uppercase tracking-[0.16em] ${selectedApplication.approved_at ? 'text-emerald-600' : 'text-gray-400'}`}>Approved at</p>
                                            {selectedApplication.approved_at && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                                        </div>
                                        <p className={`mt-2 text-sm font-bold ${selectedApplication.approved_at ? 'text-emerald-900' : 'text-gray-400'}`}>
                                            {formatDateTime(selectedApplication.approved_at)}
                                        </p>
                                    </div>

                                    <div 
                                        onClick={() => selectedApplication.rejected_at && setActiveNote({ title: 'Rejection Reason', content: selectedApplication.admin_notes || 'No reason provided.' })}
                                        className={`rounded-2xl p-4 transition-all duration-300 relative ${selectedApplication.rejected_at ? 'bg-rose-50 cursor-pointer hover:bg-rose-100 border border-rose-100' : 'bg-slate-50 opacity-50'}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <p className={`text-xs font-black uppercase tracking-[0.16em] ${selectedApplication.rejected_at ? 'text-rose-600' : 'text-gray-400'}`}>Rejected at</p>
                                            {selectedApplication.rejected_at && <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />}
                                        </div>
                                        <p className={`mt-2 text-sm font-bold ${selectedApplication.rejected_at ? 'text-rose-900' : 'text-gray-400'}`}>
                                            {formatDateTime(selectedApplication.rejected_at)}
                                        </p>
                                    </div>

                                    {/* Mini Popover */}
                                    {activeNote && (
                                        <div 
                                            ref={noteRef}
                                            className="absolute top-full left-0 right-0 z-50 mt-2 p-5 bg-white/90 backdrop-blur-xl border border-gray-200 shadow-2xl rounded-3xl animate-in fade-in slide-in-from-top-2"
                                        >
                                            <div className="flex items-center justify-between mb-3">
                                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">{activeNote.title}</p>
                                                <button onClick={(e) => { e.stopPropagation(); setActiveNote(null); }} className="p-1 hover:bg-gray-100 rounded-full transition-colors">
                                                    <X className="w-3 h-3 text-gray-400" />
                                                </button>
                                            </div>
                                            <p className="text-sm font-medium text-gray-700 leading-relaxed italic">
                                                "{activeNote.content}"
                                            </p>
                                            <div className="mt-4 flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                                                    <Users className="w-3 h-3 text-primary" />
                                                </div>
                                                <p className="text-[10px] font-bold text-gray-500">
                                                    Decision by {selectedApplication.approved_by_name || 'Admin'}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                <div className="rounded-3xl border border-gray-200 bg-white p-4">
                                    <div className="flex items-center gap-2">
                                        <FileText className="w-5 h-5 text-primary" />
                                        <p className="text-sm font-black uppercase tracking-[0.18em] text-gray-500">Documents</p>
                                    </div>
                                    <div className="mt-4 space-y-3">
                                        {selectedApplication.document_upload ? (
                                            <a
                                                href={assetUrl(selectedApplication.document_upload)}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                                            >
                                                <Eye className="w-4 h-4" />
                                                Open uploaded document
                                            </a>
                                        ) : (
                                            <p className="text-sm text-gray-500">No document uploaded with this request.</p>
                                        )}
                                    </div>
                                </div>

                                <div className="rounded-3xl border border-gray-200 bg-white p-4">
                                    <div className="flex items-center gap-2">
                                        <ImageIcon className="w-5 h-5 text-primary" />
                                        <p className="text-sm font-black uppercase tracking-[0.18em] text-gray-500">Warehouse photos</p>
                                    </div>
                                    <div className="mt-4 grid grid-cols-2 gap-3">
                                        {Array.isArray(selectedApplication.warehouse_photos) && selectedApplication.warehouse_photos.length ? (
                                            selectedApplication.warehouse_photos.map((photo) => (
                                                <a
                                                    key={photo}
                                                    href={assetUrl(photo)}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="overflow-hidden rounded-2xl border border-gray-200 bg-slate-50"
                                                >
                                                    <img src={assetUrl(photo)} alt="Warehouse" className="h-28 w-full object-cover" />
                                                </a>
                                            ))
                                        ) : (
                                            <p className="col-span-2 text-sm text-gray-500">No warehouse photos uploaded.</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {selectedApplication.verification_status === 'pending' ? (
                                <div className="rounded-3xl border border-gray-200 bg-white p-4">
                                    <label className="block text-xs font-black uppercase tracking-[0.18em] text-gray-400">
                                        Admin notes
                                    </label>
                                    <textarea
                                        rows={5}
                                        value={reviewNotes}
                                        onChange={(event) => setReviewNotes(event.target.value)}
                                        placeholder="Add approval or rejection notes that the applicant can see later."
                                        className="mt-3 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 outline-none transition focus:border-primary/40"
                                    />
                                </div>
                            ) : selectedApplication.admin_notes ? (
                                <div className="rounded-3xl border border-primary/20 bg-primary/5 p-4 text-left">
                                    <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">Notes from decision</p>
                                    <p className="mt-2 text-sm font-medium text-gray-600 leading-relaxed italic">
                                        "{selectedApplication.admin_notes}"
                                    </p>
                                </div>
                            ) : null}

                            <div className="flex flex-wrap gap-3">
                                 {selectedApplication.verification_status === 'pending' && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => handleReview('approve')}
                                            disabled={actionLoading === 'approve'}
                                            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <CheckCircle2 className="w-4 h-4" />
                                            {actionLoading === 'approve' ? 'Approving...' : 'Approve application'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleReview('reject')}
                                            disabled={actionLoading === 'reject'}
                                            className="inline-flex items-center gap-2 rounded-2xl bg-rose-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <XCircle className="w-4 h-4" />
                                            {actionLoading === 'reject' ? 'Rejecting...' : 'Reject application'}
                                        </button>
                                    </>
                                )}

                                {['approved', 'suspended', 'banned'].includes(selectedApplication.verification_status) && (
                                    <div className="flex flex-wrap gap-2">
                                        {selectedApplication.verification_status === 'approved' && (
                                            <button
                                                type="button"
                                                onClick={() => handleReview('suspend')}
                                                disabled={actionLoading === 'suspend'}
                                                className="inline-flex items-center gap-2 rounded-2xl bg-amber-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-600 disabled:opacity-60"
                                            >
                                                <ShieldAlert className="w-4 h-4" />
                                                {actionLoading === 'suspend' ? 'Suspending...' : 'Suspend Warehouse'}
                                            </button>
                                        )}
                                        
                                        {(selectedApplication.verification_status === 'suspended' || selectedApplication.verification_status === 'banned') && (
                                            <button
                                                type="button"
                                                onClick={() => handleReview('unban')}
                                                disabled={actionLoading === 'unban'}
                                                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-600 disabled:opacity-60"
                                            >
                                                <UserCheck className="w-4 h-4" />
                                                {actionLoading === 'unban' ? 'Restoring...' : 'Unban / Activate'}
                                            </button>
                                        )}

                                        {selectedApplication.verification_status !== 'banned' && (
                                            <button
                                                type="button"
                                                onClick={() => handleReview('ban')}
                                                disabled={actionLoading === 'ban'}
                                                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
                                            >
                                                <UserX className="w-4 h-4" />
                                                {actionLoading === 'ban' ? 'Banning...' : 'Ban Partner'}
                                            </button>
                                        )}

                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (window.confirm('Are you sure you want to PERMANENTLY remove this warehouse? This action cannot be undone.')) {
                                                    handleReview('remove')
                                                }
                                            }}
                                            disabled={actionLoading === 'remove'}
                                            className="inline-flex items-center gap-2 rounded-2xl border-2 border-rose-100 bg-white px-5 py-3 text-sm font-bold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-60"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                            {actionLoading === 'remove' ? 'Removing...' : 'Remove Record'}
                                        </button>
                                    </div>
                                )}
                                
                                <button
                                    type="button"
                                    onClick={() => setShowEmailModal(true)}
                                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-slate-800"
                                >
                                    <Send className="w-4 h-4" />
                                    Send Manual Email
                                </button>
                            </div>

                            <div className="rounded-3xl border border-dashed border-primary/30 bg-primary/5 p-4 text-sm text-gray-600">
                                Requests are reviewed by <span className="font-bold text-gray-900">{adminUser?.name || 'the admin team'}</span>. Approval immediately unlocks warehouse login for the matching Google account.
                            </div>
                        </div>
                    )}
                </section>
            </div>
            {/* Send Email Modal */}
            {showEmailModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
                    <div className="w-full max-w-lg overflow-hidden rounded-[2.5rem] bg-white shadow-2xl animate-in fade-in zoom-in duration-300">
                        <div className="relative border-b border-gray-100 bg-slate-50/50 px-8 py-6">
                            <h3 className="text-xl font-black text-gray-900">Send Message to Owner</h3>
                            <p className="mt-1 text-sm font-medium text-gray-500">
                                This will send a direct email to <span className="text-primary font-bold">{selectedApplication.email}</span>
                            </p>
                            <button 
                                onClick={() => setShowEmailModal(false)}
                                className="absolute right-6 top-6 rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSendEmail} className="p-8 space-y-5">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Subject Line</label>
                                <input
                                    required
                                    value={emailSubject}
                                    onChange={(e) => setEmailSubject(e.target.value)}
                                    placeholder="e.g., Regarding your warehouse application"
                                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4 text-sm font-semibold text-gray-700 outline-none transition-all focus:border-primary/50 focus:bg-white focus:ring-4 focus:ring-primary/5"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Message Body</label>
                                <textarea
                                    required
                                    rows={6}
                                    value={emailMessage}
                                    onChange={(e) => setEmailMessage(e.target.value)}
                                    placeholder="Write your message here..."
                                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4 text-sm font-medium text-gray-700 outline-none transition-all focus:border-primary/50 focus:bg-white focus:ring-4 focus:ring-primary/5 resize-none"
                                />
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowEmailModal(false)}
                                    className="flex-1 rounded-2xl border border-gray-200 py-4 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={sendingEmail}
                                    className="flex-[2] flex items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-sm font-bold text-white transition-all hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-slate-200"
                                >
                                    {sendingEmail ? (
                                        <>
                                            <RefreshCcw className="w-4 h-4 animate-spin" />
                                            Sending...
                                        </>
                                    ) : (
                                        <>
                                            <Send className="w-4 h-4" />
                                            Send Email Now
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

export default AdminWarehouseApplications
