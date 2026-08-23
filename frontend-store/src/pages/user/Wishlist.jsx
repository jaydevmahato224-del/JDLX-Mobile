import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Heart, Eye, ArrowLeft, Trash2, ChevronRight, Package, Zap, Star } from 'lucide-react'
import { useStore } from '../../store/useStore'
import BlurImage from '../../components/BlurImage'
import { resolveMediaUrl } from '../../config'
import toast from 'react-hot-toast'
import { getProductUrl } from '../../utils/productSlug'

export default function Wishlist() {
    const navigate = useNavigate();
    const token = useStore((state) => state.token);
    const wishlist = useStore((state) => state.wishlist);
    const fetchWishlist = useStore((state) => state.fetchWishlist);
    const toggleWishlist = useStore((state) => state.toggleWishlist);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!token) {
            navigate('/login');
            return;
        }
        const load = async () => {
            setLoading(true);
            await fetchWishlist();
            setLoading(false);
        };
        load();
    }, [token, fetchWishlist, navigate]);



    const handleRemove = (product) => {
        toggleWishlist(product);
        toast.success('Removed from wishlist');
    };

    const getProductImage = (product) => {
        let images = product.images || product.image_url;
        if (typeof images === 'string' && images.startsWith('[')) {
            try {
                const parsed = JSON.parse(images);
                if (Array.isArray(parsed) && parsed.length > 0) images = parsed[0];
            } catch {
                // Invalid JSON string — keep original value
            }
        }
        if (Array.isArray(images) && images.length > 0) images = images[0];
        return resolveMediaUrl(images) || 'https://placehold.co/400x400/f8fafc/0f172a?text=JDLX';
    };

    if (loading) {
        return (
            <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 space-y-4">
                <div className="h-12 w-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                <p className="text-[var(--color-on-surface-variant)] font-bold animate-pulse">Syncing your favorites...</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button 
                        onClick={() => navigate(-1)}
                        className="h-10 w-10 rounded-full bg-[var(--color-surface-container)] flex items-center justify-center text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-high)] transition-colors"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h1 className="text-2xl font-black text-[var(--color-on-surface)] flex items-center gap-2">
                            <Heart className="text-red-500" fill="currentColor" size={24} />
                            My Wishlist
                        </h1>
                        <p className="text-sm text-[var(--color-on-surface-variant)] font-medium">{wishlist.length} items saved</p>
                    </div>
                </div>
            </header>

            {wishlist.length === 0 ? (
                <div className="glass-card p-12 flex flex-col items-center text-center space-y-6">
                    <div className="h-24 w-24 rounded-[2.5rem] bg-[var(--color-surface-low)] flex items-center justify-center text-slate-300">
                        <Heart size={48} strokeWidth={1} />
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-xl font-black text-[var(--color-on-surface)]">Your wishlist is empty</h3>
                        <p className="text-[var(--color-on-surface-variant)] max-w-xs mx-auto">Save your favorite items here to track stock and buy them later.</p>
                    </div>
                    <Link to="/" className="btn-primary px-8">
                        Continue Shopping
                    </Link>
                </div>
            ) : (
                <div className="grid gap-4">
                    {wishlist.map((product) => {
                        const stock = Math.max(0, Number(product.stock ?? 0) - Number(product.hard_reserved ?? product.reserved_stock ?? 0));
                        const isLowStock = stock > 0 && stock <= 2;
                        const isOutOfStock = stock <= 0;

                        return (
                            <div key={product.id} className="glass-card group overflow-hidden flex flex-col md:flex-row items-center gap-6 p-4 md:p-6 hover:border-primary/20 transition-all duration-300">
                                {/* Product Image */}
                                <Link to={getProductUrl(product)} className="relative w-full md:w-32 aspect-square rounded-2xl bg-[var(--color-surface-container)] overflow-hidden flex-shrink-0">
                                    <BlurImage 
                                        src={getProductImage(product)}
                                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                                    />
                                    {isOutOfStock && (
                                        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center">
                                            <span className="text-[10px] font-black uppercase tracking-widest text-white px-2 py-1 border border-white/30 rounded-full">Sold Out</span>
                                        </div>
                                    )}
                                </Link>

                                {/* Product Info */}
                                <div className="flex-1 text-center md:text-left space-y-2">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{product.category}</div>
                                            <Link to={getProductUrl(product)} className="text-lg font-black text-[var(--color-on-surface)] hover:text-primary transition-colors line-clamp-1">{product.name}</Link>
                                            
                                            {product.average_rating > 0 && (
                                                <div className="mt-1 flex items-center justify-center md:justify-start gap-1.5">
                                                    <div className="flex items-center gap-0.5 text-amber-400">
                                                        <Star size={12} fill="currentColor" />
                                                    </div>
                                                    <span className="text-[11px] font-black text-[var(--color-on-surface-variant)]">
                                                        {Number(product.average_rating).toFixed(1)}
                                                    </span>
                                                    {product.total_reviews > 0 && (
                                                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">
                                                            ({product.total_reviews} Reviews)
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-xl font-black text-primary">₹{product.price}</div>
                                    </div>

                                    {/* Stock Status */}
                                    <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
                                        {isLowStock && (
                                            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-black uppercase tracking-wider border border-amber-100">
                                                <Zap size={10} fill="currentColor" /> Only {stock} left
                                            </div>
                                        )}
                                        {!isOutOfStock && !isLowStock && (
                                            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-wider border border-emerald-100">
                                                <Package size={10} /> In Stock
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-3 w-full md:w-auto">
                                    <button 
                                        onClick={() => handleRemove(product)}
                                        className="h-12 w-12 rounded-2xl bg-[var(--color-surface-low)] text-slate-400 flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-all border border-[var(--color-surface-high)]"
                                        title="Remove from wishlist"
                                    >
                                        <Trash2 size={20} />
                                    </button>
                                    <Link 
                                        to={getProductUrl(product)}
                                        className="flex-1 md:flex-none btn-primary h-12 px-10 flex items-center justify-center gap-2 shadow-lg shadow-primary/20 transition-all active:scale-95"
                                    >
                                        <Eye size={18} />
                                        <span className="font-black text-sm">View</span>
                                    </Link>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Footer Suggestions */}
            {wishlist.length > 0 && (
                <section className="pt-8 border-t border-[var(--color-surface-high)]">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-black text-[var(--color-on-surface)]">Recommended for you</h2>
                        <Link to="/" className="text-sm font-bold text-primary hover:underline flex items-center gap-1">
                            View All <ChevronRight size={16} />
                        </Link>
                    </div>
                    {/* Placeholder for Recommendations or just some text */}
                    <p className="text-sm text-[var(--color-on-surface-variant)] italic font-medium">Based on your saved items and interests.</p>
                </section>
            )}
        </div>
    );
}
