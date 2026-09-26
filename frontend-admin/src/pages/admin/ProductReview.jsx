import { useState, useEffect } from 'react'
import { ArrowLeft, Search, PackageCheck, PackageX, Clock, Loader2, Eye, X, Package, ImageIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { API_BASE_URL } from '../../config'
import { apiFetch } from '../../utils/apiFetch'

/**
 * Product Review — catalog approval desk.
 *
 * Flow: warehouse adds a product in its panel -> it lands here as PENDING
 * (invisible on the storefront) -> admin reviews listing content (images,
 * price, description, brand) -> Approve = product goes public on the store,
 * Reject = stays hidden with a reason (warehouse is notified to fix it).
 * Admin-created products skip this desk (approved by default).
 */

const STATUS_TONES = {
    pending: 'bg-amber-100 text-amber-700 border-amber-200',
    approved: 'bg-green-100 text-green-700 border-green-200',
    rejected: 'bg-red-100 text-red-600 border-red-200',
}

function ProductReview() {
    const [items, setItems] = useState([])
    const [pendingCount, setPendingCount] = useState(0)
    const [loading, setLoading] = useState(true)
    const [statusFilter, setStatusFilter] = useState('pending')
    const [searchTerm, setSearchTerm] = useState('')
    const [selected, setSelected] = useState(null)
    const [rejectNote, setRejectNote] = useState('')
    const [busy, setBusy] = useState(false)

    useEffect(() => { fetchItems(); }, [statusFilter])

    const fetchItems = async () => {
        setLoading(true)
        try {
            const res = await apiFetch(`/admin/product-approvals?status=${statusFilter}`)
            const data = await res.json().catch(() => ({}))
            if (res.ok) {
                setItems(data.data?.items || [])
                setPendingCount(data.data?.pending || 0)
            } else {
                toast.error(data.message || 'Failed to load product approvals')
            }
        } catch {
            toast.error('Network error — please retry')
        } finally {
            setLoading(false)
        }
    }

    const imageUrl = (img) => {
        if (!img) return null
        try {
            const arr = typeof img === 'string' ? JSON.parse(img) : img
            const first = Array.isArray(arr) ? arr[0] : arr
            if (!first) return null
            return String(first).startsWith('http') ? first : `${API_BASE_URL.replace('/api', '')}${first}`
        } catch { return null }
    }

    const decide = async (action) => {
        if (!selected) return
        if (action === 'reject' && !rejectNote.trim()) {
            toast.error('Rejection note required — warehouse ko reason batana zaroori he')
            return
        }
        setBusy(true)
        try {
            const res = await apiFetch(`/admin/products/${selected.id}/${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note: rejectNote.trim() || null })
            })
            const data = await res.json().catch(() => ({}))
            if (res.ok) {
                toast.success(action === 'approve'
                    ? `"${selected.name}" approved — ab storefront pe live he`
                    : `"${selected.name}" rejected — warehouse notified`)
                setSelected(null)
                setRejectNote('')
                fetchItems()
            } else {
                toast.error(data.message || `Failed to ${action} product`)
            }
        } catch {
            toast.error('Network error — please retry')
        } finally {
            setBusy(false)
        }
    }

    const filtered = items.filter(p => {
        const q = searchTerm.toLowerCase()
        return !q || (p.name || '').toLowerCase().includes(q) || (p.submitted_by_warehouse || '').toLowerCase().includes(q)
    })

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <Link to="/admin/dashboard" className="p-2 rounded-full hover:bg-slate-200 transition-colors"><ArrowLeft size={18} /></Link>
                        <div>
                            <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
                                <PackageCheck size={20} className="text-emerald-600" /> Product Review
                            </h1>
                            <p className="text-xs text-gray-500">Warehouse submissions go live only after your approval</p>
                        </div>
                    </div>
                    {pendingCount > 0 && (
                        <span className="px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 text-xs font-black uppercase tracking-wider border border-amber-200">
                            {pendingCount} pending
                        </span>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {['pending', 'approved', 'rejected', 'all'].map(s => (
                        <button key={s} onClick={() => setStatusFilter(s)}
                            className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wider border transition-colors ${statusFilter === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
                            {s}
                        </button>
                    ))}
                    <div className="relative ml-auto">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search name / warehouse…"
                            className="pl-8 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-400 w-56" />
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-24"><Loader2 size={28} className="animate-spin text-emerald-500" /></div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
                        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400"><Package size={28} /></div>
                        <h3 className="text-lg font-black text-slate-700">Nothing here</h3>
                        <p className="text-xs text-gray-400 max-w-xs">
                            {statusFilter === 'pending' ? 'Koi warehouse submission pending nahi he.' : 'No products in this state.'}
                        </p>
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {filtered.map(p => {
                            const img = imageUrl(p.images)
                            return (
                                <button key={p.id} onClick={() => setSelected(p)}
                                    className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-4 text-left hover:shadow-md transition-shadow">
                                    <div className="w-14 h-14 rounded-xl bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
                                        {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={20} className="text-slate-300" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-sm font-black text-slate-900 truncate">{p.name}</p>
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${STATUS_TONES[p.approval_status] || 'bg-slate-100 text-slate-500 border-slate-200'}`}>{p.approval_status}</span>
                                            {p.variant_count > 0 && <span className="text-[10px] font-bold text-slate-400">{p.variant_count} variants</span>}
                                        </div>
                                        <p className="text-xs text-gray-500 truncate">{p.category_name || p.category || 'Uncategorised'} • {p.submitted_by_warehouse || '—'}</p>
                                        <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-400 font-bold">
                                            <span className="text-slate-700">₹{p.price}</span>
                                            {p.mrp > p.price && <span className="line-through">₹{p.mrp}</span>}
                                            {p.approval_requested_at && <span>Submitted: {String(p.approval_requested_at).slice(0, 10)}</span>}
                                        </div>
                                    </div>
                                    <Eye size={16} className="text-slate-300" />
                                </button>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Detail modal */}
            {selected && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setSelected(null)}>
                    <div className="bg-white rounded-3xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-black text-slate-900">{selected.name}</h2>
                                <p className="text-xs text-gray-500">{selected.category_name || selected.category} • from {selected.submitted_by_warehouse || 'warehouse'}</p>
                            </div>
                            <button onClick={() => setSelected(null)} className="p-1.5 rounded-full hover:bg-slate-100"><X size={16} /></button>
                        </div>

                        {imageUrl(selected.images) && (
                            <img src={imageUrl(selected.images)} alt="" className="w-full h-44 object-cover rounded-2xl border border-slate-100" />
                        )}

                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="bg-slate-50 rounded-xl p-2"><p className="text-[10px] font-black uppercase text-slate-400">Price</p><p className="text-sm font-black text-slate-900">₹{selected.price}</p></div>
                            <div className="bg-slate-50 rounded-xl p-2"><p className="text-[10px] font-black uppercase text-slate-400">MRP</p><p className="text-sm font-black text-slate-900">₹{selected.mrp || '—'}</p></div>
                            <div className="bg-slate-50 rounded-xl p-2"><p className="text-[10px] font-black uppercase text-slate-400">Stock</p><p className="text-sm font-black text-slate-900">{selected.stock ?? '—'}</p></div>
                        </div>

                        {selected.description && (
                            <div className="bg-slate-50 rounded-xl p-3 max-h-32 overflow-y-auto">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Description</p>
                                <p className="text-xs text-gray-700 line-clamp-6">{selected.description}</p>
                            </div>
                        )}

                        {selected.brand && <p className="text-xs text-gray-500"><b>Brand:</b> {selected.brand}</p>}
                        {selected.approval_note && (
                            <p className={`text-xs rounded-xl p-3 ${selected.approval_status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-gray-600'}`}>
                                <b>Previous decision note:</b> {selected.approval_note}
                            </p>
                        )}

                        {selected.approval_status !== 'approved' && (
                            <div className="space-y-2 border-t border-slate-100 pt-3">
                                <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={2}
                                    placeholder="Note (required on reject — warehouse ko reason dikhega)"
                                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                                <div className="grid grid-cols-2 gap-2">
                                    <button onClick={() => decide('approve')} disabled={busy}
                                        className="py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50">
                                        {busy ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />} Approve & Publish
                                    </button>
                                    <button onClick={() => decide('reject')} disabled={busy || selected.approval_status === 'rejected'}
                                        className="py-2.5 rounded-xl bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50">
                                        <PackageX size={14} /> Reject
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default ProductReview
