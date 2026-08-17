import { useState, useEffect, useMemo, useRef } from 'react'
import {
    BadgePercent,
    Plus,
    Search,
    Check,
    X,
    Calendar,
    Edit3,
    Trash2,
    Ticket,
    Zap,
    Package,
    Layers,
    Store,
    Image as ImageIcon,
    Clock,
    Users,
    Loader2,
    Tag,
    Boxes
} from 'lucide-react'
import { API_BASE_URL, resolveMediaUrl } from '../../config'
import { useStore } from '../../store/useStore'
import toast from 'react-hot-toast'

const OFFER_TYPE_META = {
    coupon:    { label: 'Coupon',    icon: Ticket,  badge: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' },
    automatic: { label: 'Automatic', icon: Zap,     badge: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    seasonal:  { label: 'Seasonal',  icon: Calendar,badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    daily:     { label: 'Daily',     icon: Clock,   badge: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
}

const SCOPE_META = {
    all:      { label: 'Store-wide', icon: Store,   badge: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
    product:  { label: 'Products',   icon: Package, badge: 'bg-sky-500/20 text-sky-400 border-sky-500/30' },
    category: { label: 'Categories', icon: Layers,  badge: 'bg-violet-500/20 text-violet-400 border-violet-500/30' },
}

const EMPTY_FORM = {
    title: '',
    description: '',
    offer_type: 'automatic',
    discount_type: 'percentage',
    discount_value: '',
    coupon_code: '',
    min_order_amount: '',
    max_discount_amount: '',
    applicable_on: 'all',
    applicable_ids: [],
    usage_limit: '',
    per_user_limit: '1',
    start_date: '',
    end_date: '',
    is_active: true,
    banner_image: '',
}

const isOfferActive = (offer) => {
    if (offer.is_active !== 1) return false
    if (offer.start_date && new Date(offer.start_date) > new Date()) return false
    if (offer.end_date && new Date(offer.end_date) < new Date()) return false
    return true
}

export default function WarehouseOffers() {
    const [offers, setOffers] = useState([])
    const [products, setProducts] = useState([])
    const [categories, setCategories] = useState([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('All')
    const [search, setSearch] = useState('')
    const [showForm, setShowForm] = useState(false)
    const [editingOffer, setEditingOffer] = useState(null)
    const [formData, setFormData] = useState(EMPTY_FORM)
    const [saving, setSaving] = useState(false)
    const [bannerUploading, setBannerUploading] = useState(false)
    const [productSearch, setProductSearch] = useState('')
    const bannerInputRef = useRef(null)

    const warehouseToken = useStore((state) => state.warehouseToken) || localStorage.getItem('warehouseToken') || localStorage.getItem('token')

    const loadAll = async () => {
        if (!warehouseToken) return
        setLoading(true)
        try {
            const [offersRes, productsRes, categoriesRes] = await Promise.all([
                fetch(`${API_BASE_URL}/warehouse/offers`, { headers: { 'Authorization': `Bearer ${warehouseToken}` } }),
                fetch(`${API_BASE_URL}/warehouse/offers/products`, { headers: { 'Authorization': `Bearer ${warehouseToken}` } }),
                fetch(`${API_BASE_URL}/categories`),
            ])
            const offersJson = await offersRes.json()
            if (offersRes.ok) setOffers(offersJson.data || [])
            else toast.error(offersJson.error || 'Failed to fetch offers')

            const productsJson = await productsRes.json()
            if (productsRes.ok) setProducts(productsJson.data || [])

            const categoriesJson = await categoriesRes.json()
            if (categoriesRes.ok) setCategories(Array.isArray(categoriesJson.data) ? categoriesJson.data : [])
        } catch (e) {
            console.error('Failed to load offers data', e)
            toast.error('Failed to load offers')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (warehouseToken) loadAll()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [warehouseToken])

    const productNameMap = useMemo(() => {
        const map = {}
        products.forEach(p => { map[String(p.id)] = p.name })
        return map
    }, [products])

    const categoryNameMap = useMemo(() => {
        const map = {}
        categories.forEach(c => { map[String(c.id)] = c.name })
        return map
    }, [categories])

    const filteredOffers = useMemo(() => {
        const q = search.trim().toLowerCase()
        return offers.filter(offer => {
            if (filter === 'Active' && !isOfferActive(offer)) return false
            if (filter === 'Paused' && isOfferActive(offer)) return false
            if (filter === 'Coupon' && offer.offer_type !== 'coupon') return false
            if (filter === 'Automatic' && !['automatic', 'seasonal', 'daily'].includes(offer.offer_type)) return false
            if (q) {
                const hay = `${offer.title} ${offer.description || ''} ${offer.coupon_code || ''}`.toLowerCase()
                if (!hay.includes(q)) return false
            }
            return true
        })
    }, [offers, filter, search])

    const stats = useMemo(() => {
        const active = offers.filter(isOfferActive).length
        const coupons = offers.filter(o => o.offer_type === 'coupon').length
        const auto = offers.filter(o => ['automatic', 'seasonal', 'daily'].includes(o.offer_type)).length
        return { total: offers.length, active, paused: offers.length - active, coupons, auto }
    }, [offers])

    const scopeTargets = (offer) => {
        const ids = Array.isArray(offer.applicable_ids) ? offer.applicable_ids.map(String) : []
        if (offer.applicable_on === 'product') return { label: 'Products', names: ids.map(id => productNameMap[id]).filter(Boolean), count: ids.length }
        if (offer.applicable_on === 'category') return { label: 'Categories', names: ids.map(id => categoryNameMap[id]).filter(Boolean), count: ids.length }
        return null
    }

    const openCreate = () => {
        setEditingOffer(null)
        setFormData(EMPTY_FORM)
        setProductSearch('')
        setShowForm(true)
    }

    const openEdit = (offer) => {
        setEditingOffer(offer)
        setFormData({
            title: offer.title || '',
            description: offer.description || '',
            offer_type: offer.offer_type || 'automatic',
            discount_type: offer.discount_type || 'percentage',
            discount_value: offer.discount_value ?? '',
            coupon_code: offer.coupon_code || '',
            min_order_amount: offer.min_order_amount || '',
            max_discount_amount: offer.max_discount_amount || '',
            applicable_on: offer.applicable_on || 'all',
            applicable_ids: Array.isArray(offer.applicable_ids) ? offer.applicable_ids.map(Number) : [],
            usage_limit: offer.usage_limit ?? '',
            per_user_limit: offer.per_user_limit ?? '1',
            start_date: offer.start_date ? String(offer.start_date).replace(' ', 'T').slice(0, 16) : '',
            end_date: offer.end_date ? String(offer.end_date).replace(' ', 'T').slice(0, 16) : '',
            is_active: offer.is_active === 1,
            banner_image: offer.banner_image || '',
        })
        setProductSearch('')
        setShowForm(true)
    }

    const handleBannerUpload = async (e) => {
        const file = e.target.files?.[0]
        if (!file || !warehouseToken) return
        setBannerUploading(true)
        try {
            const fd = new FormData()
            fd.append('file', file)
            const res = await fetch(`${API_BASE_URL}/warehouse/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${warehouseToken}` },
                body: fd,
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Upload failed')
            const url = json.data?.url
            if (!url) throw new Error('Upload returned no URL')
            setFormData(prev => ({ ...prev, banner_image: url }))
            toast.success('Banner uploaded')
        } catch (err) {
            toast.error(err.message || 'Banner upload failed')
        } finally {
            setBannerUploading(false)
            if (e.target) e.target.value = ''
        }
    }

    const toggleTarget = (id) => {
        setFormData(prev => {
            const ids = prev.applicable_ids.includes(id)
                ? prev.applicable_ids.filter(x => x !== id)
                : [...prev.applicable_ids, id]
            return { ...prev, applicable_ids: ids }
        })
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (!warehouseToken) return

        // Client-side validation (mirrors backend rules)
        if (!formData.title.trim()) return toast.error('Offer title is required')
        if (!formData.discount_value || Number(formData.discount_value) <= 0) return toast.error('Enter a valid discount value')
        if (formData.offer_type === 'coupon' && !formData.coupon_code.trim()) return toast.error('Coupon code is required for coupon offers')
        // Category-wise offers are admin-managed; warehouse partners only
        // target their own products (or the whole store).
        if (formData.applicable_on === 'product' && formData.applicable_ids.length === 0) {
            return toast.error('Select at least one product')
        }

        const payload = {
            ...formData,
            coupon_code: formData.offer_type === 'coupon' ? formData.coupon_code.toUpperCase() : '',
            start_date: formData.start_date ? formData.start_date.replace('T', ' ') : null,
            end_date: formData.end_date ? formData.end_date.replace('T', ' ') : null,
            min_order_amount: formData.min_order_amount || 0,
            max_discount_amount: formData.max_discount_amount || null,
            usage_limit: formData.usage_limit || null,
            per_user_limit: formData.per_user_limit || 1,
            is_active: formData.is_active ? 1 : 0,
        }

        setSaving(true)
        try {
            const method = editingOffer ? 'PUT' : 'POST'
            const url = editingOffer
                ? `${API_BASE_URL}/warehouse/offers/${editingOffer.id}`
                : `${API_BASE_URL}/warehouse/offers`
            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${warehouseToken}`,
                },
                body: JSON.stringify(payload),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to save offer')
            toast.success(editingOffer ? 'Offer updated' : 'Offer created')
            setShowForm(false)
            setEditingOffer(null)
            loadAll()
        } catch (err) {
            toast.error(err.message || 'Failed to save offer')
        } finally {
            setSaving(false)
        }
    }

    const toggleStatus = async (offer) => {
        if (!warehouseToken) return
        const nextActive = offer.is_active === 1 ? 0 : 1
        try {
            const res = await fetch(`${API_BASE_URL}/warehouse/offers/${offer.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${warehouseToken}`,
                },
                body: JSON.stringify({ ...offer, is_active: nextActive, applicable_ids: Array.isArray(offer.applicable_ids) ? offer.applicable_ids : [] }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Status update failed')
            toast.success(nextActive ? 'Offer enabled' : 'Offer paused')
            loadAll()
        } catch (err) {
            toast.error(err.message || 'Status update failed')
        }
    }

    const handleDelete = async (offer) => {
        if (!warehouseToken) return
        if (!confirm(`Delete "${offer.title}"? This cannot be undone.`)) return
        try {
            const res = await fetch(`${API_BASE_URL}/warehouse/offers/${offer.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${warehouseToken}` },
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Delete failed')
            toast.success('Offer deleted')
            loadAll()
        } catch (err) {
            toast.error(err.message || 'Delete failed')
        }
    }

    const filteredProducts = useMemo(() => {
        const q = productSearch.trim().toLowerCase()
        if (!q) return products
        return products.filter(p => (p.name || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q))
    }, [products, productSearch])

    const selectedProducts = formData.applicable_ids
        .map(id => products.find(p => p.id === id))
        .filter(Boolean)

    return (
        <div className="space-y-6 text-white p-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-black flex items-center gap-3">
                        <span className="p-2.5 bg-amber-500/15 border border-amber-500/25 rounded-2xl">
                            <BadgePercent className="text-amber-400 w-7 h-7" />
                        </span>
                        Offers & Promotions
                    </h1>
                    <p className="text-slate-400 text-sm mt-1.5 max-w-xl">
                        Create discounts for your own products — store-wide or product-wise — and drive more sales at your store.
                    </p>
                </div>
                <button
                    onClick={openCreate}
                    className="inline-flex items-center gap-2 px-6 py-3.5 bg-gradient-to-r from-amber-400 to-orange-500 text-slate-900 rounded-2xl font-black shadow-lg shadow-amber-500/20 hover:shadow-amber-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                    <Plus size={18} strokeWidth={3} /> Create Offer
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                {[
                    { label: 'Total Offers', value: stats.total, Icon: BadgePercent, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
                    { label: 'Live Now', value: stats.active, Icon: Check, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
                    { label: 'Paused', value: stats.paused, Icon: X, color: 'text-slate-300 bg-slate-500/10 border-slate-500/20' },
                    { label: 'Coupons', value: stats.coupons, Icon: Ticket, color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' },
                    { label: 'Auto Discounts', value: stats.auto, Icon: Zap, color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
                ].map((stat) => {
                    const Icon = stat.Icon
                    return (
                    <div key={stat.label} className="bg-slate-900 rounded-[1.5rem] border border-slate-800 p-5 flex items-center gap-4">
                        <div className={`p-3 rounded-2xl border ${stat.color}`}>
                            <Icon size={20} />
                        </div>
                        <div>
                            <p className="text-2xl font-black leading-none">{stat.value}</p>
                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-1.5">{stat.label}</p>
                        </div>
                    </div>
                    )
                })}
            </div>

            {/* Toolbar */}
            <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex overflow-x-auto no-scrollbar gap-1.5 p-1.5 bg-slate-900 border border-slate-800 rounded-2xl w-fit">
                    {['All', 'Active', 'Paused', 'Coupon', 'Automatic'].map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-5 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap ${filter === f ? 'bg-amber-400 text-slate-900 shadow' : 'text-slate-400 hover:text-amber-300'}`}
                        >
                            {f}
                        </button>
                    ))}
                </div>
                <div className="relative md:ml-auto w-full md:w-80">
                    <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search offers, coupons…"
                        className="w-full bg-slate-900 border border-slate-800 rounded-2xl pl-11 pr-4 py-3 text-sm font-bold placeholder:text-slate-600 focus:outline-none focus:border-amber-500/40 transition-all"
                    />
                </div>
            </div>

            {/* Offers grid */}
            {loading ? (
                <div className="flex justify-center py-20">
                    <div className="w-10 h-10 border-4 border-slate-800 border-t-amber-500 rounded-full animate-spin" />
                </div>
            ) : filteredOffers.length === 0 ? (
                <div className="py-24 text-center bg-slate-900 rounded-[3rem] border-2 border-dashed border-slate-800">
                    <div className="flex flex-col items-center gap-4">
                        <div className="p-4 bg-slate-800/50 rounded-full">
                            <BadgePercent size={44} className="text-slate-600" />
                        </div>
                        <div className="space-y-1">
                            <p className="font-black text-lg text-slate-300">No offers found</p>
                            <p className="text-sm text-slate-500 font-bold">
                                {offers.length === 0 ? 'Create your first offer to start boosting sales.' : 'Try a different filter or search.'}
                            </p>
                        </div>
                        {offers.length === 0 && (
                            <button onClick={openCreate} className="mt-2 inline-flex items-center gap-2 px-5 py-3 bg-amber-400 text-slate-900 rounded-2xl font-black hover:bg-amber-300 transition-all">
                                <Plus size={16} strokeWidth={3} /> Create Offer
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filteredOffers.map(offer => {
                        const typeMeta = OFFER_TYPE_META[offer.offer_type] || OFFER_TYPE_META.automatic
                        const TypeIcon = typeMeta.icon
                        const scopeMeta = SCOPE_META[offer.applicable_on] || SCOPE_META.all
                        const ScopeIcon = scopeMeta.icon
                        const live = isOfferActive(offer)
                        const targets = scopeTargets(offer)
                        const usagePct = offer.usage_limit ? Math.min((offer.usage_count / offer.usage_limit) * 100, 100) : null

                        return (
                            <div key={offer.id} className="bg-slate-900 rounded-[2rem] border border-slate-800 p-6 space-y-4 hover:border-amber-500/40 transition-all group relative overflow-hidden">
                                {offer.banner_image && (
                                    <div className="absolute inset-x-0 top-0 h-24 overflow-hidden">
                                        <img src={resolveMediaUrl(offer.banner_image)} alt="" className="w-full h-full object-cover opacity-40" />
                                        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-slate-900" />
                                    </div>
                                )}
                                <div className={`relative flex justify-between items-start gap-3 ${offer.banner_image ? 'pt-16' : ''}`}>
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className={`p-3 rounded-2xl border ${typeMeta.badge.split(' ').slice(0, 2).join(' ')} shrink-0`}>
                                            <TypeIcon className="w-5 h-5" />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="font-black text-lg leading-tight truncate">{offer.title}</h3>
                                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${typeMeta.badge}`}>
                                                    {typeMeta.label}
                                                </span>
                                                <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${scopeMeta.badge}`}>
                                                    <ScopeIcon size={10} /> {scopeMeta.label}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => toggleStatus(offer)}
                                        title={live ? 'Pause offer' : 'Enable offer'}
                                        className={`p-2 rounded-xl border transition-all shrink-0 ${live ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' : 'text-slate-500 bg-slate-800 border-slate-700'}`}
                                    >
                                        {live ? <Check size={18} strokeWidth={3} /> : <X size={18} strokeWidth={3} />}
                                    </button>
                                </div>

                                {offer.description && (
                                    <p className="text-sm text-slate-400 line-clamp-2">{offer.description}</p>
                                )}

                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col">
                                        <span className="text-2xl font-black text-amber-400">
                                            {offer.discount_type === 'percentage' ? `${offer.discount_value}% OFF` : `₹${offer.discount_value} OFF`}
                                        </span>
                                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                            Min Order ₹{offer.min_order_amount || 0}
                                            {offer.max_discount_amount ? ` • Cap ₹${offer.max_discount_amount}` : ''}
                                        </span>
                                    </div>
                                    {offer.coupon_code ? (
                                        <div className="text-right">
                                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">CODE</span>
                                            <code className="bg-white text-slate-900 px-3 py-1 rounded-lg font-black tracking-widest text-xs">{offer.coupon_code}</code>
                                        </div>
                                    ) : (
                                        <div className="text-right">
                                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-1">Auto-applied</span>
                                            <span className="text-xs font-black text-emerald-400">At checkout ✓</span>
                                        </div>
                                    )}
                                </div>

                                {targets && (
                                    <div className="pt-3 border-t border-slate-800">
                                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                            {targets.label === 'Products' ? <Package size={11} /> : <Layers size={11} />}
                                            {targets.label} ({targets.count})
                                        </p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {targets.names.slice(0, 3).map(name => (
                                                <span key={name} className="text-[10px] font-bold text-slate-300 bg-slate-800 border border-slate-700 px-2 py-1 rounded-lg truncate max-w-[160px]">
                                                    {name}
                                                </span>
                                            ))}
                                            {targets.names.length > 3 && (
                                                <span className="text-[10px] font-black text-slate-500 px-2 py-1">+{targets.names.length - 3} more</span>
                                            )}
                                            {targets.names.length === 0 && (
                                                <span className="text-[10px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/25 px-2 py-1 rounded-lg">
                                                    {targets.count} target(s) unavailable
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {usagePct !== null && (
                                    <div className="flex items-center gap-3 pt-2">
                                        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                            <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${usagePct}%` }} />
                                        </div>
                                        <span className="text-[10px] font-black text-slate-500 whitespace-nowrap">
                                            {offer.usage_count}/{offer.usage_limit} used
                                        </span>
                                    </div>
                                )}

                                <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                                    <div className="flex items-center gap-1.5 text-slate-500 font-bold text-xs">
                                        <Calendar size={13} />
                                        {offer.end_date ? new Date(offer.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never expires'}
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => openEdit(offer)}
                                            title="Edit offer"
                                            className="p-2 text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 rounded-xl transition-all"
                                        >
                                            <Edit3 size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(offer)}
                                            title="Delete offer"
                                            className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Create / Edit Modal */}
            {showForm && (
                <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-sm overflow-y-auto custom-scrollbar" onClick={() => !saving && setShowForm(false)}>
                    <div className="w-full max-w-4xl bg-[#0b1224] border border-white/10 rounded-[2rem] shadow-2xl my-4 sm:my-8" onClick={e => e.stopPropagation()}>
                        {/* Modal header */}
                        <div className="flex items-center justify-between px-6 sm:px-8 py-5 border-b border-white/10 sticky top-0 bg-[#0b1224] rounded-t-[2rem] z-10">
                            <div>
                                <h2 className="text-xl font-black flex items-center gap-2.5">
                                    <BadgePercent className="text-amber-400" />
                                    {editingOffer ? 'Edit Offer' : 'Create New Offer'}
                                </h2>
                                <p className="text-xs text-slate-500 font-bold mt-0.5">Discounts apply to your own products at checkout.</p>
                            </div>
                            <button onClick={() => setShowForm(false)} className="p-2 hover:bg-white/5 rounded-full text-slate-400 hover:text-white transition-all">
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-7">
                            {/* Basic info */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Offer Title *</label>
                                    <input
                                        required
                                        value={formData.title}
                                        onChange={e => setFormData({ ...formData, title: e.target.value })}
                                        placeholder="e.g. Festive Accessories Sale"
                                        className="w-full bg-slate-900 border-2 border-slate-800 rounded-2xl px-5 py-3.5 font-bold focus:outline-none focus:border-amber-500/50 transition-all"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Offer Type</label>
                                    <select
                                        value={formData.offer_type}
                                        onChange={e => setFormData({ ...formData, offer_type: e.target.value })}
                                        className="w-full bg-slate-900 border-2 border-slate-800 rounded-2xl px-5 py-3.5 font-bold focus:outline-none focus:border-amber-500/50 transition-all"
                                    >
                                        <option value="automatic">⚡ Automatic Discount</option>
                                        <option value="coupon">🎟️ Coupon Code</option>
                                        <option value="seasonal">📅 Seasonal Sale</option>
                                        <option value="daily">🕒 Daily Deal</option>
                                    </select>
                                </div>
                                <div className="md:col-span-2 space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Description</label>
                                    <textarea
                                        rows="2"
                                        value={formData.description}
                                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                                        placeholder="Describe the offer for your customers…"
                                        className="w-full bg-slate-900 border-2 border-slate-800 rounded-2xl px-5 py-3.5 font-medium focus:outline-none focus:border-amber-500/50 transition-all resize-none"
                                    />
                                </div>
                            </div>

                            {/* Discount config */}
                            <div className="bg-slate-900/60 border border-slate-800 rounded-[1.5rem] p-5 space-y-5">
                                <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest flex items-center gap-2">
                                    <Tag size={12} /> Discount
                                </p>
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Discount Type</label>
                                        <select
                                            value={formData.discount_type}
                                            onChange={e => setFormData({ ...formData, discount_type: e.target.value })}
                                            className="w-full bg-slate-900 border-2 border-slate-800 rounded-2xl px-4 py-3.5 font-bold focus:outline-none focus:border-amber-500/50 transition-all"
                                        >
                                            <option value="percentage">Percentage (%)</option>
                                            <option value="flat">Flat Amount (₹)</option>
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Discount Value *</label>
                                        <input
                                            required
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={formData.discount_value}
                                            onChange={e => setFormData({ ...formData, discount_value: e.target.value })}
                                            placeholder={formData.discount_type === 'percentage' ? 'e.g. 10' : 'e.g. 50'}
                                            className="w-full bg-slate-900 border-2 border-slate-800 rounded-2xl px-4 py-3.5 font-bold focus:outline-none focus:border-amber-500/50 transition-all"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Min Order (₹)</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={formData.min_order_amount}
                                            onChange={e => setFormData({ ...formData, min_order_amount: e.target.value })}
                                            placeholder="0"
                                            className="w-full bg-slate-900 border-2 border-slate-800 rounded-2xl px-4 py-3.5 font-bold focus:outline-none focus:border-amber-500/50 transition-all"
                                        />
                                    </div>
                                    {formData.discount_type === 'percentage' ? (
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Max Cap (₹)</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={formData.max_discount_amount}
                                                onChange={e => setFormData({ ...formData, max_discount_amount: e.target.value })}
                                                placeholder="Unlimited"
                                                className="w-full bg-slate-900 border-2 border-slate-800 rounded-2xl px-4 py-3.5 font-bold focus:outline-none focus:border-amber-500/50 transition-all"
                                            />
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Coupon Code</label>
                                            {formData.offer_type === 'coupon' ? (
                                                <input
                                                    value={formData.coupon_code}
                                                    onChange={e => setFormData({ ...formData, coupon_code: e.target.value.toUpperCase() })}
                                                    placeholder="SAVE10"
                                                    className="w-full bg-slate-900 border-2 border-slate-800 rounded-2xl px-4 py-3.5 font-black tracking-widest uppercase focus:outline-none focus:border-amber-500/50 transition-all"
                                                />
                                            ) : (
                                                <div className="w-full bg-slate-800/50 border-2 border-dashed border-slate-700 rounded-2xl px-4 py-3.5 text-xs font-bold text-slate-500">
                                                    Only for coupon offers
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                {formData.offer_type === 'coupon' && formData.discount_type === 'flat' && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Coupon Code *</label>
                                        <input
                                            required
                                            value={formData.coupon_code}
                                            onChange={e => setFormData({ ...formData, coupon_code: e.target.value.toUpperCase() })}
                                            placeholder="SAVE10"
                                            className="w-full max-w-xs bg-slate-900 border-2 border-slate-800 rounded-2xl px-4 py-3.5 font-black tracking-widest uppercase focus:outline-none focus:border-amber-500/50 transition-all"
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Targeting */}
                            <div className="bg-slate-900/60 border border-slate-800 rounded-[1.5rem] p-5 space-y-5">
                                <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest flex items-center gap-2">
                                    <Boxes size={12} /> Applies To
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    {[
                                        { key: 'all', label: 'Entire Store', desc: 'All your products', Icon: Store },
                                        { key: 'product', label: 'Specific Products', desc: 'Pick from your inventory', Icon: Package },
                                    ].map((scope) => {
                                        const Icon = scope.Icon
                                        return (
                                        <button
                                            type="button"
                                            key={scope.key}
                                            onClick={() => {
                                                setFormData(prev => ({ ...prev, applicable_on: scope.key, applicable_ids: [] }))
                                            }}
                                            className={`text-left p-4 rounded-2xl border-2 transition-all ${formData.applicable_on === scope.key ? 'border-amber-400/60 bg-amber-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-600'}`}
                                        >
                                            <Icon size={18} className={formData.applicable_on === scope.key ? 'text-amber-400' : 'text-slate-500'} />
                                            <p className="font-black text-sm mt-2">{scope.label}</p>
                                            <p className="text-[11px] font-bold text-slate-500 mt-0.5">{scope.desc}</p>
                                        </button>
                                        )
                                    })}
                                </div>

                                {formData.applicable_on === 'product' && (
                                    <div className="space-y-3">
                                        <div className="relative">
                                            <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                                            <input
                                                value={productSearch}
                                                onChange={e => setProductSearch(e.target.value)}
                                                placeholder="Search your products…"
                                                className="w-full bg-slate-900 border-2 border-slate-800 rounded-2xl pl-10 pr-4 py-3 text-sm font-bold focus:outline-none focus:border-amber-500/50 transition-all"
                                            />
                                        </div>
                                        {selectedProducts.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5">
                                                {selectedProducts.map(p => (
                                                    <span key={p.id} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/25 px-2.5 py-1 rounded-lg">
                                                        {p.name}
                                                        <button type="button" onClick={() => toggleTarget(p.id)} className="hover:text-white">
                                                            <X size={12} />
                                                        </button>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        <div className="max-h-56 overflow-y-auto custom-scrollbar border border-slate-800 rounded-2xl divide-y divide-slate-800/70">
                                            {filteredProducts.length === 0 && (
                                                <p className="p-6 text-center text-sm font-bold text-slate-500">No products found in your inventory.</p>
                                            )}
                                            {filteredProducts.map(p => {
                                                const selected = formData.applicable_ids.includes(p.id)
                                                return (
                                                    <label key={p.id} className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-all ${selected ? 'bg-amber-500/10' : 'hover:bg-slate-800/50'}`}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selected}
                                                            onChange={() => toggleTarget(p.id)}
                                                            className="w-4 h-4 accent-amber-400"
                                                        />
                                                        {p.image ? (
                                                            <img src={resolveMediaUrl(p.image)} alt="" className="w-9 h-9 rounded-lg object-cover border border-slate-700" />
                                                        ) : (
                                                            <span className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center text-slate-600">
                                                                <Package size={16} />
                                                            </span>
                                                        )}
                                                        <span className="flex-1 min-w-0">
                                                            <span className="block text-sm font-bold truncate">{p.name}</span>
                                                            <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">{p.category || 'Uncategorized'}</span>
                                                        </span>
                                                        <span className="text-xs font-black text-amber-400">₹{p.price}</span>
                                                    </label>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}

                            </div>

                            {/* Limits & validity */}
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Usage Limit</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={formData.usage_limit}
                                        onChange={e => setFormData({ ...formData, usage_limit: e.target.value })}
                                        placeholder="Unlimited"
                                        className="w-full bg-slate-900 border-2 border-slate-800 rounded-2xl px-4 py-3.5 font-bold focus:outline-none focus:border-amber-500/50 transition-all"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 flex items-center gap-1"><Users size={11} /> Per User</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={formData.per_user_limit}
                                        onChange={e => setFormData({ ...formData, per_user_limit: e.target.value })}
                                        placeholder="1"
                                        className="w-full bg-slate-900 border-2 border-slate-800 rounded-2xl px-4 py-3.5 font-bold focus:outline-none focus:border-amber-500/50 transition-all"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Starts</label>
                                    <input
                                        type="datetime-local"
                                        value={formData.start_date}
                                        onChange={e => setFormData({ ...formData, start_date: e.target.value })}
                                        className="w-full bg-slate-900 border-2 border-slate-800 rounded-2xl px-4 py-3.5 font-bold focus:outline-none focus:border-amber-500/50 transition-all [color-scheme:dark]"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Expires</label>
                                    <input
                                        type="datetime-local"
                                        value={formData.end_date}
                                        onChange={e => setFormData({ ...formData, end_date: e.target.value })}
                                        className="w-full bg-slate-900 border-2 border-slate-800 rounded-2xl px-4 py-3.5 font-bold focus:outline-none focus:border-amber-500/50 transition-all [color-scheme:dark]"
                                    />
                                </div>
                            </div>

                            {/* Banner + status */}
                            <div className="flex flex-col sm:flex-row sm:items-end gap-5">
                                <div className="flex-1 space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Banner Image (optional)</label>
                                    <div className="flex items-center gap-4">
                                        <button
                                            type="button"
                                            onClick={() => bannerInputRef.current?.click()}
                                            disabled={bannerUploading}
                                            className="w-28 h-20 bg-slate-900 border-2 border-dashed border-slate-700 rounded-2xl flex items-center justify-center text-slate-500 hover:border-amber-500/40 hover:text-amber-400 transition-all overflow-hidden disabled:opacity-50"
                                        >
                                            {bannerUploading ? (
                                                <Loader2 size={20} className="animate-spin" />
                                            ) : formData.banner_image ? (
                                                <img src={resolveMediaUrl(formData.banner_image)} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <ImageIcon size={22} />
                                            )}
                                        </button>
                                        <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerUpload} />
                                        <div className="space-y-2 flex-1">
                                            {formData.banner_image && (
                                                <button
                                                    type="button"
                                                    onClick={() => setFormData(prev => ({ ...prev, banner_image: '' }))}
                                                    className="text-xs font-bold text-rose-400 hover:text-rose-300"
                                                >
                                                    Remove banner
                                                </button>
                                            )}
                                            <p className="text-[11px] font-bold text-slate-500">Shown on the storefront promotions banner. Upload a wide image for best results.</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between gap-4 p-4 bg-slate-900 border-2 border-slate-800 rounded-2xl sm:min-w-[220px]">
                                    <div>
                                        <p className="text-sm font-black">{formData.is_active ? 'Offer Live' : 'Offer Paused'}</p>
                                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">{formData.is_active ? 'Visible at checkout' : 'Hidden from customers'}</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={formData.is_active}
                                            onChange={e => setFormData({ ...formData, is_active: e.target.checked })}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                                    </label>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-4 justify-end border-t border-white/10 pt-6">
                                <button
                                    type="button"
                                    onClick={() => setShowForm(false)}
                                    disabled={saving}
                                    className="px-8 py-3.5 text-slate-400 font-black hover:bg-white/5 rounded-2xl transition-all disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="inline-flex items-center gap-2 px-10 py-3.5 bg-gradient-to-r from-amber-400 to-orange-500 text-slate-900 rounded-2xl font-black shadow-lg shadow-amber-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-60 disabled:hover:scale-100"
                                >
                                    {saving && <Loader2 size={16} className="animate-spin" />}
                                    {editingOffer ? 'Update Offer' : 'Create Offer'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
