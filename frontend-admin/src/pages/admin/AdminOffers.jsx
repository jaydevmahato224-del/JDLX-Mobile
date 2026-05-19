import { useState, useEffect } from 'react'
import { BadgePercent, Plus, Search, Filter, AlertCircle, Edit, Trash2, Image as ImageIcon, Calendar, Target, Box, Check, X } from 'lucide-react'
import { API_BASE_URL, resolveMediaUrl } from '../../config'
import { toast } from 'react-hot-toast'
import { useStore } from '../../store/useStore'

export default function AdminOffers() {
    const [offers, setOffers] = useState([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('All') // All, Active, Expired, Coupon, Automatic
    const [showForm, setShowForm] = useState(false)
    const [editingOffer, setEditingOffer] = useState(null)
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        offer_type: 'coupon',
        discount_type: 'percentage',
        discount_value: '',
        coupon_code: '',
        min_order_amount: '',
        max_discount_amount: '',
        target_type: 'all',
        applicable_on: 'all',
        applicable_ids: '', // JSON string for editing compatibility
        usage_limit: '',
        per_user_limit: '1',
        start_date: '',
        end_date: '',
        is_active: true
    })
    const [bannerFile, setBannerFile] = useState(null)
    
    const adminToken = useStore(state => state.adminToken) || localStorage.getItem('adminToken') || localStorage.getItem('token')

    useEffect(() => {
        if (adminToken) {
            fetchOffers()
        }
    }, [adminToken])

    const fetchOffers = async () => {
        if (!adminToken) return
        setLoading(true)
        try {
            const res = await fetch(`${API_BASE_URL}/admin/offers`, {
                headers: { 'Authorization': `Bearer ${adminToken}` }
            })
            const json = await res.json()
            if (res.ok) setOffers(json.data)
        } catch (e) {
            toast.error("Failed to fetch offers")
        } finally {
            setLoading(false)
        }
    }

    const handleFormSubmit = async (e) => {
        e.preventDefault()
        try {
            const method = editingOffer ? 'PUT' : 'POST'
            const url = editingOffer 
                ? `${API_BASE_URL}/admin/offers/${editingOffer.id}` 
                : `${API_BASE_URL}/admin/offers`
            
            const payload = { ...formData }
            // Handle applicable_ids (convert string back to array if needed)
            if (typeof payload.applicable_ids === 'string' && payload.applicable_ids.trim()) {
                try {
                    payload.applicable_ids = JSON.parse(payload.applicable_ids)
                } catch (e) {
                    // If not valid JSON, treat as comma separated
                    payload.applicable_ids = payload.applicable_ids.split(',').map(x => x.trim())
                }
            } else if (!payload.applicable_ids) {
                payload.applicable_ids = []
            }

            // Clean up empty fields
            if (!payload.min_order_amount) payload.min_order_amount = 0
            if (!payload.max_discount_amount) delete payload.max_discount_amount
            if (!payload.usage_limit) delete payload.usage_limit
            if (!payload.start_date) delete payload.start_date
            if (!payload.end_date) delete payload.end_date
            if (payload.offer_type !== 'coupon') delete payload.coupon_code

            const res = await fetch(url, {
                method,
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${adminToken}`
                },
                body: JSON.stringify(payload)
            })
            const json = await res.json()
            
            if (!res.ok) throw new Error(json.error || "Failed to save offer")

            const offerId = editingOffer ? editingOffer.id : json.data.id

            if (bannerFile) {
                const bannerFormData = new FormData()
                bannerFormData.append('file', bannerFile)
                await fetch(`${API_BASE_URL}/admin/offers/${offerId}/upload-banner`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${adminToken}` },
                    body: bannerFormData
                })
            }

            toast.success("Offer saved successfully")
            setShowForm(false)
            setEditingOffer(null)
            setBannerFile(null)
            fetchOffers()
        } catch (e) {
            toast.error(e.message)
        }
    }

    const handleDelete = async (id) => {
        if (!confirm("Delete this offer? This cannot be undone.")) return
        try {
            const res = await fetch(`${API_BASE_URL}/admin/offers/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${adminToken}` }
            })
            if (res.ok) {
                toast.success("Offer deleted")
                fetchOffers()
            }
        } catch (e) {
            toast.error("Delete failed")
        }
    }

    const toggleStatus = async (offer) => {
        try {
            const res = await fetch(`${API_BASE_URL}/admin/offers/${offer.id}`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${adminToken}`
                },
                body: JSON.stringify({ ...offer, is_active: offer.is_active === 1 ? 0 : 1 })
            })
            if (res.ok) {
                toast.success(`Offer ${offer.is_active ? 'disabled' : 'enabled'}`)
                fetchOffers()
            }
        } catch (e) {
            toast.error("Status update failed")
        }
    }

    const filteredOffers = offers.filter(offer => {
        if (filter === 'Active') return offer.is_active === 1
        if (filter === 'Expired') return offer.is_active === 0 || (offer.end_date && new Date(offer.end_date) < new Date())
        if (filter === 'Coupon') return offer.offer_type === 'coupon'
        if (filter === 'Automatic') return ['automatic', 'seasonal', 'daily'].includes(offer.offer_type)
        return true
    })

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-black flex items-center gap-3 text-slate-900">
                        <div className="p-2 bg-rose-100 rounded-xl">
                            <BadgePercent className="text-rose-600 w-6 h-6" />
                        </div>
                        Offers & Promotions
                    </h1>
                    <p className="text-slate-500 text-sm font-medium mt-1">Manage discount coupons, automatic deals, and seasonal sales.</p>
                </div>
                <button 
                    onClick={() => {
                        setEditingOffer(null)
                        setFormData({
                            title: '', description: '', offer_type: 'coupon', discount_type: 'percentage',
                            discount_value: '', coupon_code: '', min_order_amount: '', max_discount_amount: '',
                            target_type: 'all', applicable_on: 'all', applicable_ids: '', usage_limit: '', per_user_limit: '1',
                            start_date: '', end_date: '', is_active: true
                        })
                        setShowForm(!showForm)
                    }}
                    className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
                >
                    <Plus size={18} /> Create New Offer
                </button>
            </div>

            {showForm && (
                <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100 animate-in slide-in-from-top-4 duration-500">
                    <div className="flex justify-between items-center mb-8">
                        <h2 className="text-xl font-black text-slate-900">{editingOffer ? 'Edit Promotional Offer' : 'Configure New Offer'}</h2>
                        <button onClick={() => setShowForm(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400"><X size={20}/></button>
                    </div>
                    
                    <form onSubmit={handleFormSubmit} className="space-y-8">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* Basic Info */}
                            <div className="md:col-span-2 space-y-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Offer Title</label>
                                    <input required className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 font-bold focus:outline-none focus:border-rose-500 transition-all" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} placeholder="e.g. Summer Flash Sale" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Description</label>
                                    <textarea className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 font-medium focus:outline-none focus:border-rose-500 transition-all" rows="2" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Describe the offer for customers..." />
                                </div>
                            </div>

                            {/* Status & Image */}
                            <div className="space-y-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Banner Image</label>
                                    <div className="relative group">
                                        <input type="file" accept="image/*" className="hidden" id="banner-upload" onChange={e => setBannerFile(e.target.files[0])} />
                                        <label htmlFor="banner-upload" className="w-full aspect-video bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center cursor-pointer group-hover:border-rose-300 transition-all overflow-hidden">
                                            {bannerFile ? (
                                                <img src={URL.createObjectURL(bannerFile)} className="w-full h-full object-cover" />
                                            ) : formData.banner_image ? (
                                                <img src={resolveMediaUrl(formData.banner_image)} className="w-full h-full object-cover" />
                                            ) : (
                                                <>
                                                    <ImageIcon className="text-slate-300 w-8 h-8 mb-2" />
                                                    <span className="text-xs font-bold text-slate-400">Upload Banner</span>
                                                </>
                                            )}
                                        </label>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border-2 border-slate-100">
                                    <span className="text-sm font-bold text-slate-700">Enable Offer</span>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" checked={formData.is_active} onChange={e => setFormData({...formData, is_active: e.target.checked})} className="sr-only peer" />
                                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                                    </label>
                                </div>
                            </div>

                            {/* Configuration */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Offer Type</label>
                                <select className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 font-bold focus:outline-none focus:border-rose-500 transition-all" value={formData.offer_type} onChange={e => setFormData({...formData, offer_type: e.target.value})}>
                                    <option value="coupon">🎟️ Coupon Code</option>
                                    <option value="automatic">⚡ Automatic Discount</option>
                                    <option value="seasonal">📅 Seasonal Sale</option>
                                    <option value="daily">🕒 Daily Deal</option>
                                </select>
                            </div>

                            {formData.offer_type === 'coupon' && (
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Coupon Code</label>
                                    <input required className="w-full bg-slate-900 text-white border-2 border-slate-900 rounded-2xl px-5 py-3 font-black tracking-widest uppercase focus:outline-none focus:border-rose-500 transition-all" value={formData.coupon_code} onChange={e => setFormData({...formData, coupon_code: e.target.value.toUpperCase()})} placeholder="SUMMER50" />
                                </div>
                            )}

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Discount Type</label>
                                <select className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 font-bold focus:outline-none focus:border-rose-500 transition-all" value={formData.discount_type} onChange={e => setFormData({...formData, discount_type: e.target.value})}>
                                    <option value="percentage">Percentage (%)</option>
                                    <option value="flat">Flat Amount (₹)</option>
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Discount Value</label>
                                <input required type="number" step="0.01" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 font-bold focus:outline-none focus:border-rose-500 transition-all" value={formData.discount_value} onChange={e => setFormData({...formData, discount_value: e.target.value})} placeholder="e.g. 10" />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Min Order Amount (₹)</label>
                                <input type="number" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 font-bold focus:outline-none focus:border-rose-500 transition-all" value={formData.min_order_amount} onChange={e => setFormData({...formData, min_order_amount: e.target.value})} placeholder="0" />
                            </div>

                            {formData.discount_type === 'percentage' && (
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Max Discount Cap (₹)</label>
                                    <input type="number" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 font-bold focus:outline-none focus:border-rose-500 transition-all" value={formData.max_discount_amount} onChange={e => setFormData({...formData, max_discount_amount: e.target.value})} placeholder="Unlimited" />
                                </div>
                            )}

                            {/* Targeting */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Target Audience</label>
                                <select className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 font-bold focus:outline-none focus:border-rose-500 transition-all" value={formData.target_type} onChange={e => setFormData({...formData, target_type: e.target.value})}>
                                    <option value="all">Everyone</option>
                                    <option value="new_user">First Time Users</option>
                                    <option value="specific_user">Specific User IDs</option>
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Applicable On</label>
                                <select className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 font-bold focus:outline-none focus:border-rose-500 transition-all" value={formData.applicable_on} onChange={e => setFormData({...formData, applicable_on: e.target.value})}>
                                    <option value="all">Entire Store</option>
                                    <option value="category">Specific Categories</option>
                                    <option value="product">Specific Products</option>
                                </select>
                            </div>

                            {formData.applicable_on !== 'all' && (
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Target IDs (Comma Separated)</label>
                                    <input className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 font-bold focus:outline-none focus:border-rose-500 transition-all" value={formData.applicable_ids} onChange={e => setFormData({...formData, applicable_ids: e.target.value})} placeholder="e.g. 1, 5, 23" />
                                </div>
                            )}

                            {/* Usage Limits */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Global Usage Limit</label>
                                <input type="number" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 font-bold focus:outline-none focus:border-rose-500 transition-all" value={formData.usage_limit} onChange={e => setFormData({...formData, usage_limit: e.target.value})} placeholder="Unlimited" />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Limit Per User</label>
                                <input type="number" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 font-bold focus:outline-none focus:border-rose-500 transition-all" value={formData.per_user_limit} onChange={e => setFormData({...formData, per_user_limit: e.target.value})} placeholder="1" />
                            </div>

                            {/* Validity */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Start Date</label>
                                <input type="datetime-local" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 font-bold focus:outline-none focus:border-rose-500 transition-all" value={formData.start_date ? formData.start_date.replace(' ', 'T') : ''} onChange={e => setFormData({...formData, start_date: e.target.value.replace('T', ' ')})} />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Expiry Date</label>
                                <input type="datetime-local" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 font-bold focus:outline-none focus:border-rose-500 transition-all" value={formData.end_date ? formData.end_date.replace(' ', 'T') : ''} onChange={e => setFormData({...formData, end_date: e.target.value.replace('T', ' ')})} />
                            </div>
                        </div>

                        <div className="flex gap-4 justify-end border-t border-slate-100 pt-8">
                            <button type="button" onClick={() => setShowForm(false)} className="px-8 py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-2xl transition-all">Cancel</button>
                            <button type="submit" className="px-10 py-3 bg-slate-900 text-white rounded-2xl font-black shadow-lg shadow-slate-200 hover:scale-[1.02] active:scale-[0.98] transition-all">
                                {editingOffer ? 'Update Promotion' : 'Activate Promotion'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Filter Tabs */}
            <div className="flex overflow-x-auto no-scrollbar gap-2 p-1 bg-slate-100 rounded-2xl w-fit">
                {['All', 'Active', 'Expired', 'Coupon', 'Automatic'].map(f => (
                    <button 
                        key={f} 
                        onClick={() => setFilter(f)}
                        className={`px-6 py-2 rounded-xl text-sm font-black transition-all whitespace-nowrap ${filter === f ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                        {f}
                    </button>
                ))}
            </div>

            {/* Offers Table */}
            <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50">
                                <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Offer / Title</th>
                                <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Type</th>
                                <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Benefit</th>
                                <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Coupon Code</th>
                                <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Usage</th>
                                <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Valid Until</th>
                                <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Status</th>
                                <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {filteredOffers.map(offer => (
                                <tr key={offer.id} className="hover:bg-slate-50/50 transition-colors group">
                                    <td className="p-6">
                                        <div className="flex items-center gap-4">
                                            {offer.banner_image ? (
                                                <img src={resolveMediaUrl(offer.banner_image)} className="w-12 h-12 rounded-xl object-cover border border-slate-100" />
                                            ) : (
                                                <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
                                                    <BadgePercent size={20} />
                                                </div>
                                            )}
                                            <div>
                                                <p className="font-black text-slate-900 leading-tight">{offer.title}</p>
                                                <p className="text-[11px] font-medium text-slate-400 mt-0.5 line-clamp-1 max-w-[200px]">{offer.description}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-6">
                                        <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-lg ${
                                            offer.offer_type === 'coupon' ? 'bg-indigo-50 text-indigo-600' :
                                            offer.offer_type === 'automatic' ? 'bg-amber-50 text-amber-600' :
                                            'bg-slate-100 text-slate-600'
                                        }`}>
                                            {offer.offer_type}
                                        </span>
                                    </td>
                                    <td className="p-6">
                                        <div className="flex flex-col">
                                            <span className="font-black text-rose-600">
                                                {offer.discount_type === 'percentage' ? `${offer.discount_value}% OFF` : `₹${offer.discount_value} OFF`}
                                            </span>
                                            <span className="text-[10px] font-bold text-slate-400 uppercase">Min ₹{offer.min_order_amount}</span>
                                        </div>
                                    </td>
                                    <td className="p-6">
                                        {offer.coupon_code ? (
                                            <code className="bg-slate-900 text-white px-3 py-1.5 rounded-xl font-black text-xs tracking-widest">{offer.coupon_code}</code>
                                        ) : (
                                            <span className="text-slate-300 font-bold text-xs">—</span>
                                        )}
                                    </td>
                                    <td className="p-6">
                                        <div className="flex flex-col gap-1.5 min-w-[120px]">
                                            <div className="flex justify-between text-[10px] font-black uppercase tracking-tighter">
                                                <span className="text-slate-400">{offer.usage_count} Used</span>
                                                <span className="text-slate-600">{offer.usage_limit || '∞'} Limit</span>
                                            </div>
                                            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                                <div 
                                                    className="bg-rose-500 h-full transition-all duration-500" 
                                                    style={{ width: offer.usage_limit ? `${Math.min((offer.usage_count / offer.usage_limit) * 100, 100)}%` : '5%' }}
                                                />
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-6">
                                        <div className="flex items-center gap-2 text-slate-500 font-bold text-sm">
                                            <Calendar size={14} className="text-slate-300" />
                                            {offer.end_date ? new Date(offer.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Never'}
                                        </div>
                                    </td>
                                    <td className="p-6 text-center">
                                        <button 
                                            onClick={() => toggleStatus(offer)}
                                            className={`p-2 rounded-xl transition-all ${offer.is_active ? 'text-emerald-500 bg-emerald-50 hover:bg-emerald-100' : 'text-slate-300 bg-slate-50 hover:bg-slate-100'}`}
                                        >
                                            {offer.is_active ? <Check size={20} strokeWidth={3} /> : <X size={20} strokeWidth={3} />}
                                        </button>
                                    </td>
                                    <td className="p-6 text-right">
                                        <div className="flex justify-end gap-2">
                                            <button 
                                                onClick={() => {
                                                    setEditingOffer(offer)
                                                    setFormData({
                                                        ...offer,
                                                        is_active: offer.is_active === 1,
                                                        min_order_amount: offer.min_order_amount || '',
                                                        max_discount_amount: offer.max_discount_amount || '',
                                                        usage_limit: offer.usage_limit || '',
                                                        applicable_ids: Array.isArray(offer.applicable_ids) ? offer.applicable_ids.join(', ') : (offer.applicable_ids || '')
                                                    })
                                                    setShowForm(true)
                                                }}
                                                className="p-2.5 text-slate-400 hover:text-slate-900 hover:bg-white rounded-xl transition-all shadow-sm"
                                            >
                                                <Edit size={18} />
                                            </button>
                                            <button 
                                                onClick={() => handleDelete(offer.id)}
                                                className="p-2.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredOffers.length === 0 && !loading && (
                                <tr>
                                    <td colSpan="8" className="p-20 text-center">
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="p-4 bg-slate-50 rounded-full">
                                                <Search size={40} className="text-slate-200" />
                                            </div>
                                            <div className="space-y-1">
                                                <p className="font-black text-slate-900">No offers found</p>
                                                <p className="text-slate-400 text-sm font-medium">Try adjusting your filters or create a new promotion.</p>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {loading && (
                <div className="flex justify-center py-12">
                    <div className="w-10 h-10 border-4 border-slate-100 border-t-rose-500 rounded-full animate-spin" />
                </div>
            )}
        </div>
    )
}

