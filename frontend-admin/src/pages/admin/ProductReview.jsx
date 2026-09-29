import { useState, useEffect } from 'react'
import { ArrowLeft, Search, PackageCheck, PackageX, Loader2, Eye, X, Package, ImageIcon, Hash, Truck, Layers, FileText, Tag, MapPin } from 'lucide-react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { API_BASE_URL } from '../../config'
import { apiFetch } from '../../utils/apiFetch'

/**
 * Product Review — catalog approval desk.
 *
 * Flow: warehouse adds a product in its panel -> it lands here as PENDING
 * (invisible on the storefront) -> admin reviews the FULL submission (images,
 * pricing, SKU/inventory, fulfillment, physical specs, variants, SEO copy)
 * -> Approve = product goes public on the store, Reject = stays hidden with a
 * reason (warehouse is notified to fix it). Admin-created products skip this
 * desk (approved by default).
 */

const STATUS_TONES = {
    pending: 'bg-amber-100 text-amber-700 border-amber-200',
    approved: 'bg-green-100 text-green-700 border-green-200',
    rejected: 'bg-red-100 text-red-600 border-red-200',
}

// The warehouse panel saves descriptions with simple HTML (<strong>, <br>,
// <ul>/<li>). Render tags literally and this reads like broken markup, so use
// the same conversion the storefront's ProductDetails page uses.
function htmlToText(value) {
    if (!value || typeof value !== 'string') return ''
    return value
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(ul|ol)>/gi, '\n')
        .replace(/<li\s*\/?>/gi, '• ')
        .replace(/<\/(strong|b|em|i|p|div|span)>/gi, '')
        .replace(/<(strong|b|em|i|p|div|span)[^>]*>/gi, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

// Small labelled row — hidden entirely when the value is empty, so the modal
// never shows "None"/"undefined" placeholders for fields the merchant skipped.
function DetailRow({ label, value }) {
    if (value === null || value === undefined || value === '' || value === 'None') return null
    return (
        <div className="flex items-start justify-between gap-3 py-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 shrink-0">{label}</span>
            <span className="text-xs font-bold text-slate-800 text-right break-words">{String(value)}</span>
        </div>
    )
}

function Section({ title, icon: Icon, children }) {
    return (
        <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 mb-1.5">
                {Icon && <Icon size={11} />} {title}
            </p>
            {children}
        </div>
    )
}

function FlagChip({ children }) {
    return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border bg-white border-slate-200 text-slate-600">
            {children}
        </span>
    )
}

function ProductReview() {
    const [items, setItems] = useState([])
    const [pendingCount, setPendingCount] = useState(0)
    const [loading, setLoading] = useState(true)
    const [statusFilter, setStatusFilter] = useState('pending')
    const [searchTerm, setSearchTerm] = useState('')
    const [selected, setSelected] = useState(null)
    const [modalImg, setModalImg] = useState(0)
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

    const resolveImage = (img) => {
        if (!img) return null
        return String(img).startsWith('http') ? img : `${API_BASE_URL.replace('/api', '')}${img}`
    }

    // Legacy helper for list rows — first image of the JSON images column.
    const imageUrl = (img) => {
        if (!img) return null
        try {
            const arr = typeof img === 'string' ? JSON.parse(img) : img
            const first = Array.isArray(arr) ? arr[0] : arr
            return resolveImage(first)
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

    const openDetail = (p) => { setSelected(p); setModalImg(0) }

    // Modal-scoped derived values (safe when inventory/discovery rows are absent)
    const inv = selected?.inventory || null
    const gallery = (selected?.images_list || [])
        .map(resolveImage)
        .filter(Boolean)
    const mainImage = gallery[modalImg] || gallery[0] || null
    const sku = inv?.sku || selected?.global_sku_code || selected?.barcode || null
    const descriptionText = htmlToText(selected?.description)
    const discovery = selected?.discovery || null

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
                                <button key={p.id} onClick={() => openDetail(p)}
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
                                            {(p.inventory?.sku || p.global_sku_code) && <span className="uppercase">SKU: {p.inventory?.sku || p.global_sku_code}</span>}
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

            {/* Detail modal — full submission review */}
            {selected && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setSelected(null)}>
                    <div className="bg-white rounded-3xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-5 space-y-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-black text-slate-900">{selected.name}</h2>
                                <p className="text-xs text-gray-500">{selected.category_name || selected.category} • from {selected.submitted_by_warehouse || 'warehouse'} • <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase border ${STATUS_TONES[selected.approval_status] || ''}`}>{selected.approval_status}</span></p>
                            </div>
                            <button onClick={() => setSelected(null)} className="p-1.5 rounded-full hover:bg-slate-100"><X size={16} /></button>
                        </div>

                        {/* Gallery — every uploaded image, not just the first */}
                        {gallery.length > 0 && (
                            <div className="space-y-2">
                                <img src={mainImage} alt="" className="w-full h-44 object-cover rounded-2xl border border-slate-100" />
                                {gallery.length > 1 && (
                                    <div className="flex gap-2 overflow-x-auto pb-1">
                                        {gallery.map((img, i) => (
                                            <button key={i} onClick={() => setModalImg(i)}
                                                className={`w-12 h-12 rounded-lg overflow-hidden border-2 shrink-0 transition-colors ${i === modalImg ? 'border-emerald-500' : 'border-transparent opacity-60 hover:opacity-100'}`}>
                                                <img src={img} alt="" className="w-full h-full object-cover" />
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Pricing & stock — products values + live warehouse line */}
                        <div className="grid grid-cols-4 gap-2 text-center">
                            <div className="bg-slate-50 rounded-xl p-2"><p className="text-[10px] font-black uppercase text-slate-400">Price</p><p className="text-sm font-black text-slate-900">₹{selected.price}</p></div>
                            <div className="bg-slate-50 rounded-xl p-2"><p className="text-[10px] font-black uppercase text-slate-400">MRP</p><p className="text-sm font-black text-slate-900">₹{selected.mrp || '—'}</p></div>
                            <div className="bg-slate-50 rounded-xl p-2"><p className="text-[10px] font-black uppercase text-slate-400">Stock</p><p className="text-sm font-black text-slate-900">{selected.stock ?? '—'}</p></div>
                            <div className="bg-slate-50 rounded-xl p-2"><p className="text-[10px] font-black uppercase text-slate-400">Live</p><p className="text-sm font-black text-slate-900">{inv ? inv.stock_quantity : '—'}</p></div>
                        </div>

                        {/* Identity */}
                        <Section title="Product Identity" icon={Hash}>
                            <DetailRow label="Brand" value={selected.brand} />
                            <DetailRow label="SKU" value={sku} />
                            <DetailRow label="Barcode" value={selected.barcode} />
                            <DetailRow label="Category" value={[selected.category_name || selected.category, selected.sub_category].filter(Boolean).join(' › ')} />
                            <DetailRow label="Variant" value={selected.variant_name} />
                        </Section>

                        {/* Warehouse inventory line — SKU/bin/GST live here */}
                        {inv && (
                            <Section title="Warehouse Inventory" icon={MapPin}>
                                <DetailRow label="Bin / Rack" value={inv.bin_location} />
                                <DetailRow label="GST" value={inv.gst_pct != null && Number(inv.gst_pct) > 0 ? `${inv.gst_pct}%` : null} />
                                <DetailRow label="Unit" value={inv.unit} />
                                <DetailRow label="Available / Reserved" value={`${inv.available_stock ?? 0} / ${inv.reserved_stock ?? 0}`} />
                                <DetailRow label="Low stock alert at" value={inv.low_stock_threshold} />
                                <DetailRow label="Cost price" value={inv.cost_price ? `₹${inv.cost_price}` : null} />
                                <DetailRow label="Listing status" value={inv.status} />
                            </Section>
                        )}

                        {/* Fulfillment & policies */}
                        <Section title="Fulfillment & Policies" icon={Truck}>
                            <DetailRow label="Delivery time" value={selected.delivery_time} />
                            <DetailRow label="Return policy" value={selected.return_policy} />
                            <DetailRow label="Prepaid only" value={selected.prepaid_only != null ? (Number(selected.prepaid_only) ? 'Yes' : 'No') : null} />
                            <DetailRow label="Expiry date" value={selected.expiry_date} />
                        </Section>

                        {/* Physical specs */}
                        {(selected.color || selected.weight || selected.dimensions || selected.units_per_pack || selected.material_type) && (
                            <Section title="Physical Details" icon={Package}>
                                <DetailRow label="Color" value={selected.color} />
                                <DetailRow label="Weight" value={selected.weight} />
                                <DetailRow label="Dimensions" value={selected.dimensions} />
                                <DetailRow label="Units per pack" value={selected.units_per_pack} />
                                <DetailRow label="Material" value={selected.material_type} />
                            </Section>
                        )}

                        {/* Handling flags — only when actually set */}
                        {(Number(selected.is_fragile) || Number(selected.is_temp_sensitive) || Number(selected.is_perishable) || Number(selected.is_featured)) && (
                            <div className="flex flex-wrap gap-1.5">
                                {Number(selected.is_fragile) === 1 && <FlagChip>Fragile</FlagChip>}
                                {Number(selected.is_temp_sensitive) === 1 && <FlagChip>Temp Sensitive</FlagChip>}
                                {Number(selected.is_perishable) === 1 && <FlagChip>Perishable</FlagChip>}
                                {Number(selected.is_featured) === 1 && <FlagChip>Featured</FlagChip>}
                            </div>
                        )}

                        {/* Variants — what the admin is approving as a group */}
                        {selected.variants?.length > 0 && (
                            <Section title={`Variants (${selected.variants.length})`} icon={Layers}>
                                <div className="space-y-1.5">
                                    {selected.variants.map(v => (
                                        <div key={v.id} className="bg-white rounded-lg border border-slate-100 px-2.5 py-1.5 flex items-center justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="text-xs font-black text-slate-800 truncate">{v.variant_name || v.name}</p>
                                                {(v.sku || inv?.sku) && <p className="text-[10px] font-bold text-slate-400 uppercase">SKU: {v.sku || '—'}</p>}
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-xs font-black text-slate-900">₹{v.price}</p>
                                                <p className="text-[10px] font-bold text-slate-400">stock {v.stock}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </Section>
                        )}

                        {/* Description — clean text, no raw HTML */}
                        {descriptionText && (
                            <div className="bg-slate-50 rounded-xl p-3 max-h-40 overflow-y-auto">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 flex items-center gap-1.5"><FileText size={11} /> Description</p>
                                <p className="text-xs text-gray-700 whitespace-pre-line">{descriptionText}</p>
                            </div>
                        )}

                        {/* SEO / discovery copy submitted by the merchant */}
                        {discovery && (
                            <Section title="SEO & Discovery" icon={Tag}>
                                <DetailRow label="Meta title" value={discovery.meta_title} />
                                <DetailRow label="Meta description" value={discovery.meta_description} />
                                <DetailRow label="Search keywords" value={Array.isArray(discovery.search_keywords) ? discovery.search_keywords.join(', ') : discovery.search_keywords} />
                                <DetailRow label="Tags" value={Array.isArray(discovery.product_tags) ? discovery.product_tags.join(', ') : discovery.product_tags} />
                                <DetailRow label="Synonyms" value={Array.isArray(discovery.search_synonyms) ? discovery.search_synonyms.join(', ') : discovery.search_synonyms} />
                            </Section>
                        )}

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
