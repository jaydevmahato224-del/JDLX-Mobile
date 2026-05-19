import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate } from 'react-router-dom'
import { BadgePercent, Copy, CheckCircle2, Clock, ShoppingBag, Sparkles, Tag, Gift, Zap } from 'lucide-react'
import toast from 'react-hot-toast'

function Coupons() {
    const user = useStore(state => state.user);
    const navigate = useNavigate();
    const [offers, setOffers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [copiedId, setCopiedId] = useState(null);

    useEffect(() => {
        if (!user) { navigate('/login'); return; }

        fetch(`${API_BASE_URL}/offers/active`)
            .then(res => res.json())
            .then(json => {
                if (json.success && Array.isArray(json.data)) {
                    setOffers(json.data);
                }
            })
            .catch(err => console.error('Failed to fetch offers:', err))
            .finally(() => setLoading(false));
    }, [user, navigate]);

    const handleCopy = (code, id) => {
        navigator.clipboard.writeText(code).then(() => {
            setCopiedId(id);
            toast.success(`Coupon ${code} copied!`, {
                icon: '📋',
                style: { borderRadius: '16px', background: '#1e293b', color: '#fff', fontSize: '13px', fontWeight: 'bold' }
            });
            setTimeout(() => setCopiedId(null), 2000);
        });
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return null;
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch {
            return dateStr;
        }
    };

    const getOfferGradient = (index) => {
        const gradients = [
            'from-amber-500 to-orange-600',
            'from-emerald-500 to-teal-600',
            'from-violet-500 to-purple-600',
            'from-rose-500 to-pink-600',
            'from-blue-500 to-indigo-600',
            'from-cyan-500 to-blue-600',
        ];
        return gradients[index % gradients.length];
    };

    const getOfferIcon = (type) => {
        switch (type) {
            case 'coupon': return <Tag size={20} />;
            case 'automatic': return <Zap size={20} />;
            case 'seasonal': return <Gift size={20} />;
            default: return <Sparkles size={20} />;
        }
    };

    if (loading) {
        return (
            <div className="container-standard py-12">
                <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
                    <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Loading offers...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="container-standard py-8 space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
            {/* Header */}
            <div className="space-y-3">
                <div className="flex items-center gap-3">
                    <div className="h-12 w-12 bg-primary/10 rounded-2xl flex items-center justify-center">
                        <BadgePercent className="text-primary" size={24} />
                    </div>
                    <div>
                        <h1 className="text-2xl md:text-3xl font-black tracking-tighter text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>
                            Coupons & Offers
                        </h1>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
                            {offers.length} {offers.length === 1 ? 'offer' : 'offers'} available
                        </p>
                    </div>
                </div>
            </div>

            {offers.length === 0 ? (
                <div className="flex flex-col items-center justify-center min-h-[40vh] gap-6 text-center">
                    <div className="relative">
                        <div className="absolute inset-0 bg-primary/10 blur-3xl rounded-full" />
                        <div className="relative w-24 h-24 bg-slate-50 rounded-3xl flex items-center justify-center border-2 border-dashed border-slate-200">
                            <BadgePercent size={40} className="text-slate-300" />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-xl font-black text-slate-900 tracking-tight">No Active Offers</h3>
                        <p className="text-sm text-slate-400 font-medium max-w-xs">
                            Check back soon! We regularly add new exclusive offers and discounts for our customers.
                        </p>
                    </div>
                    <button 
                        onClick={() => navigate('/')}
                        className="btn-primary px-8 py-3 rounded-2xl text-sm"
                    >
                        <ShoppingBag size={16} />
                        Continue Shopping
                    </button>
                </div>
            ) : (
                <div className="grid gap-5">
                    {offers.map((offer, index) => (
                        <div
                            key={offer.id}
                            className="relative overflow-hidden rounded-[28px] border border-slate-100 bg-white shadow-lg hover:shadow-xl transition-all duration-500 hover:-translate-y-1 group"
                        >
                            {/* Colored accent strip */}
                            <div className={`absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r ${getOfferGradient(index)}`} />

                            <div className="p-6 pt-5 space-y-4">
                                {/* Top row: Icon + Title + Type */}
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${getOfferGradient(index)} text-white flex items-center justify-center shadow-lg flex-shrink-0`}>
                                            {getOfferIcon(offer.offer_type)}
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="text-lg font-black text-slate-900 tracking-tight leading-tight">
                                                {offer.title}
                                            </h3>
                                            {offer.description && (
                                                <p className="text-xs text-slate-400 font-medium mt-0.5 line-clamp-1">
                                                    {offer.description}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-gradient-to-r ${getOfferGradient(index)} text-white flex-shrink-0`}>
                                        {offer.offer_type}
                                    </span>
                                </div>

                                {/* Discount Display */}
                                <div className="flex items-center gap-6 py-3 px-4 bg-slate-50/80 rounded-2xl border border-slate-100">
                                    <div className="space-y-0.5">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Discount</p>
                                        <p className="text-2xl font-black text-slate-900 tracking-tighter">
                                            {offer.discount_type === 'percentage' 
                                                ? `${offer.discount_value}% OFF` 
                                                : `₹${offer.discount_value} OFF`
                                            }
                                        </p>
                                    </div>

                                    {offer.min_order_amount > 0 && (
                                        <div className="space-y-0.5 border-l border-slate-200 pl-6">
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Min. Order</p>
                                            <p className="text-lg font-black text-slate-700 tracking-tight">₹{offer.min_order_amount}</p>
                                        </div>
                                    )}

                                    {offer.max_discount_amount && (
                                        <div className="space-y-0.5 border-l border-slate-200 pl-6">
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Max Save</p>
                                            <p className="text-lg font-black text-emerald-600 tracking-tight">₹{offer.max_discount_amount}</p>
                                        </div>
                                    )}
                                </div>

                                {/* Bottom row: Coupon Code + Expiry */}
                                <div className="flex items-center justify-between gap-4 pt-1">
                                    {offer.coupon_code ? (
                                        <button
                                            onClick={() => handleCopy(offer.coupon_code, offer.id)}
                                            className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl border-2 border-dashed transition-all active:scale-95 ${
                                                copiedId === offer.id 
                                                    ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                                                    : 'border-slate-200 bg-white text-slate-700 hover:border-primary hover:bg-primary/5'
                                            }`}
                                        >
                                            {copiedId === offer.id ? (
                                                <CheckCircle2 size={16} className="text-emerald-500" />
                                            ) : (
                                                <Copy size={16} className="text-slate-400" />
                                            )}
                                            <span className="text-sm font-black tracking-widest uppercase">
                                                {offer.coupon_code}
                                            </span>
                                        </button>
                                    ) : (
                                        <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-xl">
                                            <Zap size={14} className="text-emerald-500" />
                                            <span className="text-[11px] font-black text-emerald-700 uppercase tracking-widest">Auto-Applied</span>
                                        </div>
                                    )}

                                    {offer.end_date && (
                                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-bold">
                                            <Clock size={13} />
                                            <span>Expires {formatDate(offer.end_date)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Shop CTA */}
            {offers.length > 0 && (
                <div className="flex justify-center pt-4">
                    <button 
                        onClick={() => navigate('/')}
                        className="btn-primary px-10 py-4 rounded-2xl text-sm shadow-xl shadow-primary/20 flex items-center gap-2"
                    >
                        <ShoppingBag size={18} />
                        Shop & Apply Coupons
                    </button>
                </div>
            )}
        </div>
    )
}

export default Coupons
