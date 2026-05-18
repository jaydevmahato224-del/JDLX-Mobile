import { useState, useEffect } from 'react'
import { BadgePercent, Plus, Search, Filter, AlertCircle, Edit, Trash2, Image as ImageIcon } from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { toast } from 'react-hot-toast'

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
        usage_limit: '',
        per_user_limit: '1',
        start_date: '',
        end_date: '',
        is_active: true
    })
    const [bannerFile, setBannerFile] = useState(null)
    const token = localStorage.getItem('admin_token')

    useEffect(() => {
        fetchOffers()
    }, [])

    const fetchOffers = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/admin/offers`, {
                headers: { 'Authorization': `Bearer ${token}` }
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
            // Clean up empty numbers
            if (!payload.min_order_amount) delete payload.min_order_amount
            if (!payload.max_discount_amount) delete payload.max_discount_amount
            if (!payload.usage_limit) delete payload.usage_limit
            if (!payload.start_date) delete payload.start_date
            if (!payload.end_date) delete payload.end_date

            const res = await fetch(url, {
                method,
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            })
            const json = await res.json()
            
            if (!res.ok) throw new Error(json.error || "Failed to save offer")

            const offerId = editingOffer ? editingOffer.id : json.data.id

            if (bannerFile) {
                const formData = new FormData()
                formData.append('file', bannerFile)
                await fetch(`${API_BASE_URL}/admin/offers/${offerId}/upload-banner`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
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
                headers: { 'Authorization': `Bearer ${token}` }
            })
            if (res.ok) {
                toast.success("Offer deleted")
                fetchOffers()
            }
        } catch (e) {
            toast.error("Delete failed")
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
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <BadgePercent className="text-primary" /> Offers & Promotions
                </h1>
                <button 
                    onClick={() => {
                        setEditingOffer(null)
                        setFormData({
                            title: '', description: '', offer_type: 'coupon', discount_type: 'percentage',
                            discount_value: '', coupon_code: '', min_order_amount: '', max_discount_amount: '',
                            target_type: 'all', applicable_on: 'all', usage_limit: '', per_user_limit: '1',
                            start_date: '', end_date: '', is_active: true
                        })
                        setShowForm(!showForm)
                    }}
                    className="btn-primary flex items-center gap-2"
                >
                    <Plus size={18} /> Create Offer
                </button>
            </div>

            {showForm && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <h2 className="text-lg font-bold mb-4">{editingOffer ? 'Edit Offer' : 'New Offer'}</h2>
                    <form onSubmit={handleFormSubmit} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Title</label>
                                <input required className="w-full border p-2 rounded" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Offer Type</label>
                                <select className="w-full border p-2 rounded" value={formData.offer_type} onChange={e => setFormData({...formData, offer_type: e.target.value})}>
                                    <option value="coupon">Coupon Code</option>
                                    <option value="automatic">Automatic Discount</option>
                                    <option value="seasonal">Seasonal Sale</option>
                                    <option value="daily">Daily Deal</option>
                                </select>
                            </div>
                            {formData.offer_type === 'coupon' && (
                                <div>
                                    <label className="block text-sm font-medium mb-1">Coupon Code</label>
                                    <input required className="w-full border p-2 rounded uppercase" value={formData.coupon_code} onChange={e => setFormData({...formData, coupon_code: e.target.value.toUpperCase()})} />
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium mb-1">Discount Type</label>
                                <select className="w-full border p-2 rounded" value={formData.discount_type} onChange={e => setFormData({...formData, discount_type: e.target.value})}>
                                    <option value="percentage">Percentage (%)</option>
                                    <option value="flat">Flat Amount (₹)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Discount Value</label>
                                <input required type="number" step="0.01" className="w-full border p-2 rounded" value={formData.discount_value} onChange={e => setFormData({...formData, discount_value: e.target.value})} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Min Order Amount (₹)</label>
                                <input type="number" className="w-full border p-2 rounded" value={formData.min_order_amount} onChange={e => setFormData({...formData, min_order_amount: e.target.value})} />
                            </div>
                            {formData.discount_type === 'percentage' && (
                                <div>
                                    <label className="block text-sm font-medium mb-1">Max Discount Amount (₹)</label>
                                    <input type="number" className="w-full border p-2 rounded" value={formData.max_discount_amount} onChange={e => setFormData({...formData, max_discount_amount: e.target.value})} />
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium mb-1">Usage Limit (Global)</label>
                                <input type="number" placeholder="Leave empty for unlimited" className="w-full border p-2 rounded" value={formData.usage_limit} onChange={e => setFormData({...formData, usage_limit: e.target.value})} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Usage Limit (Per User)</label>
                                <input type="number" className="w-full border p-2 rounded" value={formData.per_user_limit} onChange={e => setFormData({...formData, per_user_limit: e.target.value})} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Banner Image (Optional)</label>
                                <input type="file" accept="image/*" className="w-full border p-2 rounded" onChange={e => setBannerFile(e.target.files[0])} />
                            </div>
                            <div className="flex items-center gap-2 mt-6">
                                <input type="checkbox" id="is_active" checked={formData.is_active} onChange={e => setFormData({...formData, is_active: e.target.checked})} className="w-5 h-5" />
                                <label htmlFor="is_active" className="font-medium">Offer is Active</label>
                            </div>
                        </div>
                        <div className="flex gap-2 justify-end mt-4">
                            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border rounded">Cancel</button>
                            <button type="submit" className="px-4 py-2 bg-primary text-white rounded font-bold">Save Offer</button>
                        </div>
                    </form>
                </div>
            )}

            <div className="flex gap-2 mb-4">
                {['All', 'Active', 'Expired', 'Coupon', 'Automatic'].map(f => (
                    <button 
                        key={f} 
                        onClick={() => setFilter(f)}
                        className={`px-4 py-1.5 rounded-full text-sm font-medium ${filter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                        {f}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredOffers.map(offer => (
                    <div key={offer.id} className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 relative">
                        <div className="flex justify-between items-start mb-3">
                            <div>
                                <h3 className="font-bold text-lg">{offer.title}</h3>
                                <span className={`text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full ${offer.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                    {offer.is_active ? 'Active' : 'Disabled'}
                                </span>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => {
                                    setEditingOffer(offer)
                                    setFormData({
                                        ...offer,
                                        is_active: offer.is_active === 1,
                                        min_order_amount: offer.min_order_amount || '',
                                        max_discount_amount: offer.max_discount_amount || '',
                                        usage_limit: offer.usage_limit || ''
                                    })
                                    setShowForm(true)
                                }} className="text-slate-400 hover:text-blue-500"><Edit size={16} /></button>
                                <button onClick={() => handleDelete(offer.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={16} /></button>
                            </div>
                        </div>

                        <div className="space-y-1 mb-4">
                            <p className="text-sm"><span className="text-slate-500">Type:</span> <span className="font-medium capitalize">{offer.offer_type}</span></p>
                            {offer.coupon_code && <p className="text-sm"><span className="text-slate-500">Code:</span> <span className="font-bold text-emerald-600">{offer.coupon_code}</span></p>}
                            <p className="text-sm"><span className="text-slate-500">Discount:</span> <span className="font-bold text-primary">{offer.discount_type === 'percentage' ? `${offer.discount_value}%` : `₹${offer.discount_value}`}</span></p>
                        </div>

                        <div className="bg-slate-50 rounded-lg p-3 text-xs">
                            <div className="flex justify-between mb-1">
                                <span className="text-slate-500">Usage Limit:</span>
                                <span className="font-medium">{offer.usage_count} / {offer.usage_limit || '∞'}</span>
                            </div>
                            <div className="w-full bg-slate-200 rounded-full h-1.5">
                                <div className="bg-primary h-1.5 rounded-full" style={{ width: offer.usage_limit ? `${(offer.usage_count / offer.usage_limit) * 100}%` : '0%' }}></div>
                            </div>
                        </div>
                    </div>
                ))}
                {filteredOffers.length === 0 && !loading && (
                    <div className="col-span-full py-12 text-center text-slate-400">
                        No offers found matching this filter.
                    </div>
                )}
            </div>
        </div>
    )
}
