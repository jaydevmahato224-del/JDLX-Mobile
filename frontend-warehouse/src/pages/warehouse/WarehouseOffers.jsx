import { useState, useEffect } from 'react'
import { BadgePercent, Search, Check, X, Calendar } from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'

export default function WarehouseOffers() {
    const [offers, setOffers] = useState([])
    const [loading, setLoading] = useState(true)
    
    const warehouseToken = useStore(state => state.warehouseToken) || localStorage.getItem('warehouseToken') || localStorage.getItem('token')

    useEffect(() => {
        if (warehouseToken) {
            fetchOffers()
        }
    }, [warehouseToken])

    const fetchOffers = async () => {
        if (!warehouseToken) return
        setLoading(true)
        try {
            const res = await fetch(`${API_BASE_URL}/offers/active`, {
                headers: { 'Authorization': `Bearer ${warehouseToken}` }
            })
            const json = await res.json()
            if (res.ok) setOffers(json.data)
        } catch (e) {
            console.error("Failed to fetch offers", e)
        } finally {
            setLoading(false)
        }
    }

    const toggleStatus = async (offer) => {
        if (!warehouseToken) return
        // ...
        try {
            const res = await fetch(`${API_BASE_URL}/admin/offers/${offer.id}`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${warehouseToken}`
                },
                body: JSON.stringify({ ...offer, is_active: offer.is_active === 1 ? 0 : 1 })
            })
            if (res.ok) {
                // Success - silent update or alert
                fetchOffers()
            } else {
                console.error("You may not have permission to toggle offers")
            }
        } catch (e) {
            console.error("Status update failed", e)
        }
    }

    return (
        <div className="space-y-6 text-white p-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-black flex items-center gap-3">
                        <BadgePercent className="text-amber-500 w-8 h-8" />
                        Active Offers & Promotions
                    </h1>
                    <p className="text-slate-400 text-sm mt-1">View and manage live discounts for your store customers.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {offers.map(offer => (
                    <div key={offer.id} className="bg-slate-900 rounded-[2rem] border border-slate-800 p-6 space-y-4 hover:border-amber-500/50 transition-all">
                        <div className="flex justify-between items-start">
                            <div className="flex items-center gap-3">
                                <div className="p-3 bg-amber-500/10 rounded-2xl">
                                    <BadgePercent className="text-amber-500" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg">{offer.title}</h3>
                                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-lg ${
                                        offer.offer_type === 'coupon' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-amber-500/20 text-amber-400'
                                    }`}>
                                        {offer.offer_type}
                                    </span>
                                </div>
                            </div>
                            <button 
                                onClick={() => toggleStatus(offer)}
                                className={`p-2 rounded-xl transition-all ${offer.is_active ? 'text-emerald-500 bg-emerald-500/10' : 'text-slate-500 bg-slate-800'}`}
                            >
                                {offer.is_active ? <Check size={20} strokeWidth={3} /> : <X size={20} strokeWidth={3} />}
                            </button>
                        </div>

                        <p className="text-sm text-slate-400 line-clamp-2">{offer.description}</p>

                        <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                            <div className="flex flex-col">
                                <span className="text-xl font-black text-amber-500">
                                    {offer.discount_type === 'percentage' ? `${offer.discount_value}% OFF` : `₹${offer.discount_value} OFF`}
                                </span>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Min Order ₹{offer.min_order_amount}</span>
                            </div>
                            {offer.coupon_code && (
                                <div className="text-right">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">CODE</span>
                                    <code className="bg-white text-black px-3 py-1 rounded-lg font-black tracking-widest text-xs">{offer.coupon_code}</code>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-2 text-slate-500 font-bold text-xs pt-2">
                            <Calendar size={14} />
                            Expires: {offer.end_date ? new Date(offer.end_date).toLocaleDateString() : 'Never'}
                        </div>
                    </div>
                ))}
                
                {offers.length === 0 && !loading && (
                    <div className="col-span-full py-20 text-center bg-slate-900 rounded-[3rem] border-2 border-dashed border-slate-800">
                         <div className="flex flex-col items-center gap-4">
                            <BadgePercent size={48} className="text-slate-700" />
                            <p className="text-slate-500 font-bold">No active offers found for your warehouse.</p>
                         </div>
                    </div>
                )}
            </div>

            {loading && (
                <div className="flex justify-center py-12">
                    <div className="w-10 h-10 border-4 border-slate-800 border-t-amber-500 rounded-full animate-spin" />
                </div>
            )}
        </div>
    )
}
