import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Star, ThumbsUp, CheckCircle2, MessageSquare, AlertCircle, Send, X, Camera, Plus, Trash2, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { API_BASE_URL, resolveMediaUrl } from '../config'
import toast from 'react-hot-toast'
import { apiFetch } from '../utils/apiFetch'

export default function ProductReviews({ productId }) {
    const [reviews, setReviews] = useState([]);
    const [stats, setStats] = useState({ total: 0, average: 0, distribution: {} });
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    
    // Form state
    const [rating, setRating] = useState(0);
    const [hoverRating, setHoverRating] = useState(0);
    const [comment, setComment] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Pagination: show only the latest few by default, then reveal a page at a
    // time so the DOM never renders the entire review history at once.
    const INITIAL_COUNT = 3;
    const PAGE_SIZE = 10;
    const [showAll, setShowAll] = useState(false);
    const [page, setPage] = useState(0);
    const listRef = useRef(null);

    const fetchReviews = useCallback(async () => {
        try {
            setLoading(true);
            const res = await apiFetch(`/review/product/${productId}`);
            const data = await res.json();
            if (res.ok) {
                setReviews(data.reviews || []);
                setStats(data.stats || { total: 0, average: 0, distribution: {} });
            }
        } catch {
            console.error('Failed to fetch reviews:');
        } finally {
            setLoading(false);
        }
    }, [productId]);

    useEffect(() => {
        fetchReviews();
    }, [fetchReviews]);

    // Collapse back to the summary view whenever we switch products.
    useEffect(() => {
        setShowAll(false);
        setPage(0);
    }, [productId]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (rating === 0) return toast.error('Please select a rating');

        setSubmitting(true);
        try {
            const res = await apiFetch('/review/add', {
                method: 'POST',
                body: JSON.stringify({
                    product_id: productId,
                    rating,
                    review_text: comment
                })
            });
            const data = await res.json();
            if (res.ok) {
                toast.success('Review submitted! Thank you for your feedback.');
                setShowForm(false);
                setRating(0);
                setComment('');
                fetchReviews();
            } else {
                toast.error(data.error || 'Submission failed');
            }
        } catch {
            toast.error('Connection error');
        } finally {
            setSubmitting(false);
        }
    };

    const distributionArray = useMemo(() => {
        const dist = stats.distribution || {};
        return [5, 4, 3, 2, 1].map(star => ({
            star,
            count: dist[star] || 0,
            percentage: stats.total > 0 ? (dist[star] || 0) / stats.total * 100 : 0
        }));
    }, [stats]);

    const totalPages = Math.max(1, Math.ceil(reviews.length / PAGE_SIZE));
    const visibleReviews = showAll
        ? reviews.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
        : reviews.slice(0, INITIAL_COUNT);

    const goToPage = (next) => {
        setPage(next);
        // Nudge the viewport back to the top of the list so the new page starts in view.
        requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };

    if (loading && reviews.length === 0) {
        return (
            <div className="py-12 flex flex-col items-center justify-center space-y-4">
                <div className="h-10 w-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                <p className="text-slate-400 font-bold animate-pulse text-sm">Loading verified feedback...</p>
            </div>
        );
    }

    return (
        <div className="space-y-12 animate-in fade-in duration-700">
            {/* Header & Stats Overview */}
            <div className="grid md:grid-cols-[1fr_1.5fr] gap-10 items-start">
                <div className="space-y-6">
                    <div className="space-y-2">
                        <h2 className="text-3xl font-black tracking-tight text-[var(--color-on-surface)]">Customer Reviews</h2>
                        <div className="flex items-center gap-3">
                            <div className="flex items-center text-amber-400">
                                {[1, 2, 3, 4, 5].map((s) => (
                                    <Star 
                                        key={s} 
                                        size={18} 
                                        fill={s <= Math.round(stats.average) ? "currentColor" : "none"} 
                                        className={s <= Math.round(stats.average) ? "" : "text-slate-200"}
                                    />
                                ))}
                            </div>
                            <span className="text-xl font-black text-[var(--color-on-surface)]">{stats.average} out of 5</span>
                        </div>
                        <p className="text-sm text-[var(--color-on-surface-variant)] font-medium">{stats.total} total global ratings</p>
                    </div>

                    <button 
                        onClick={() => setShowForm(true)}
                        className="w-full py-4 rounded-2xl bg-slate-900 text-white font-black text-sm shadow-xl shadow-slate-200 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                        <MessageSquare size={18} />
                        Write a Review
                    </button>
                </div>

                {/* Distribution Bars */}
                <div className="space-y-3">
                    {distributionArray.map((item) => (
                        <div key={item.star} className="flex items-center gap-4 group cursor-default">
                            <span className="text-xs font-black text-[var(--color-on-surface-variant)] w-10">{item.star} Star</span>
                            <div className="flex-1 h-3 bg-[var(--color-surface-container)] rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-primary transition-all duration-1000 ease-out" 
                                    style={{ width: `${item.percentage}%` }}
                                />
                            </div>
                            <span className="text-xs font-bold text-slate-400 w-10">{Math.round(item.percentage)}%</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Reviews List */}
            <div ref={listRef} className="space-y-8 scroll-mt-[calc(var(--app-header-offset)+1rem)]">
                <div className="flex items-center justify-between border-b border-[var(--color-surface-high)] pb-4">
                    <h3 className="font-black text-[var(--color-on-surface)] uppercase tracking-widest text-xs">Verified Experiences</h3>
                    <div className="text-[10px] font-bold text-slate-400">
                        {showAll ? `Showing ${page * PAGE_SIZE + 1}–${Math.min(reviews.length, page * PAGE_SIZE + PAGE_SIZE)} of ${reviews.length}` : 'Sort: Most Recent'}
                    </div>
                </div>

                {reviews.length === 0 ? (
                    <div className="py-20 text-center space-y-6 bg-slate-50/50 rounded-[3rem] border-2 border-dashed border-slate-100 animate-in fade-in zoom-in-95 duration-700">
                        <div className="h-24 w-24 bg-[var(--color-surface-card)] rounded-[2.5rem] flex items-center justify-center text-primary/20 mx-auto shadow-xl shadow-slate-200/50">
                            <Star size={48} className="animate-pulse" />
                        </div>
                        <div className="space-y-2">
                            <h4 className="font-black text-slate-900 text-xl">Be the First to Review</h4>
                            <p className="text-sm text-slate-500 max-w-xs mx-auto font-medium leading-relaxed">
                                Share your thoughts with the community and help others make a better choice!
                            </p>
                        </div>
                        <button 
                            onClick={() => setShowForm(true)}
                            className="inline-flex items-center gap-2 px-8 py-3 rounded-2xl bg-slate-900 text-white font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-lg"
                        >
                            <Plus size={16} />
                            Add Review Now
                        </button>
                    </div>
                ) : (
                    <div className="grid gap-8">
                        {visibleReviews.map((rev) => (
                            <div key={rev.id} className="space-y-4 group animate-in slide-in-from-bottom-4 duration-500">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-2xl bg-[var(--color-surface-container)] flex items-center justify-center text-slate-400 font-black text-xs overflow-hidden">
                                            {rev.profile_image ? (
                                                <img src={resolveMediaUrl(rev.profile_image)} className="h-full w-full object-cover" alt="" />
                                            ) : (
                                                rev.user_name?.charAt(0) || 'U'
                                            )}
                                        </div>
                                        <div>
                                            <div className="text-sm font-black text-[var(--color-on-surface)] flex items-center gap-2">
                                                {rev.user_name}
                                                {rev.is_verified === 1 && (
                                                    <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                                                        <CheckCircle2 size={10} /> Verified
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center text-amber-400 gap-0.5 mt-0.5">
                                                {[1, 2, 3, 4, 5].map((s) => (
                                                    <Star 
                                                        key={s} 
                                                        size={12} 
                                                        fill={s <= rev.rating ? "currentColor" : "none"} 
                                                        className={s <= rev.rating ? "" : "text-slate-200"}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-[10px] font-bold text-slate-400 italic">
                                        {new Date(rev.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </div>
                                </div>

                                <p className="text-sm font-medium leading-relaxed text-[var(--color-on-surface-variant)] md:pl-[3.25rem]">
                                    {rev.review_text}
                                </p>

                                <div className="md:pl-[3.25rem] flex items-center gap-4">
                                    <button 
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            
                                            (async () => {
                                                try {
                                                    const res = await apiFetch(`/review/helpful/${rev.id}`, { 
                                                        method: 'POST',
                                                    });
                                                    const data = await res.json();
                                                    if (res.ok) {
                                                        const isUnliking = data.data?.action === 'unliked';
                                                        const newCount = data.data?.count ?? (isUnliking ? Math.max(0, rev.helpful_count - 1) : rev.helpful_count + 1);
                                                        setReviews(prev => prev.map(r => r.id === rev.id ? { ...r, helpful_count: newCount, user_has_liked: isUnliking ? 0 : 1 } : r));
                                                        toast.success(data.message);
                                                    }
                                                } catch {
                                                    toast.error('Connection error');
                                                }
                                            })();
                                        }}
                                        className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-widest transition-all active:scale-90 ${rev.user_has_liked ? 'text-primary' : 'text-slate-400 hover:text-primary'}`}
                                        type="button"
                                    >
                                        <ThumbsUp size={14} fill={rev.user_has_liked ? "currentColor" : "none"} /> 
                                        Helpful ({rev.helpful_count})
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* View-more / pagination controls */}
                {reviews.length > INITIAL_COUNT && (
                    <div className="pt-2">
                        {!showAll ? (
                            <button
                                onClick={() => { setShowAll(true); setPage(0); }}
                                className="w-full py-4 rounded-2xl border-2 border-[var(--color-surface-high)] bg-[var(--color-surface-low)] text-[var(--color-on-surface)] font-black text-xs uppercase tracking-widest hover:bg-[var(--color-surface-container)] active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                            >
                                <ChevronDown size={16} />
                                View More Reviews ({reviews.length - INITIAL_COUNT} more)
                            </button>
                        ) : (
                            <div className="flex items-center justify-between gap-3">
                                <button
                                    disabled={page === 0}
                                    onClick={() => goToPage(Math.max(0, page - 1))}
                                    className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-[var(--color-surface-low)] border-2 border-[var(--color-surface-high)] text-[var(--color-on-surface)] font-black text-[11px] uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 transition-all"
                                >
                                    <ChevronLeft size={16} /> Prev
                                </button>
                                <span className="text-[11px] font-black uppercase tracking-widest text-[var(--color-on-surface-variant)]">Page {page + 1} of {totalPages}</span>
                                {page < totalPages - 1 ? (
                                    <button
                                        onClick={() => goToPage(page + 1)}
                                        className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-slate-900 text-white font-black text-[11px] uppercase tracking-widest active:scale-95 transition-all shadow-lg"
                                    >
                                        Next <ChevronRight size={16} />
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => { setShowAll(false); setPage(0); requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }}
                                        className="px-5 py-3 rounded-2xl bg-[var(--color-surface-low)] border-2 border-[var(--color-surface-high)] text-[var(--color-on-surface)] font-black text-[11px] uppercase tracking-widest active:scale-95 transition-all"
                                    >
                                        Show Less
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Submission Modal */}
            {showForm && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-[var(--color-surface-card)] w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <h2 className="text-xl font-black text-slate-900 flex items-center gap-3">
                                <Star className="text-amber-400" fill="currentColor" size={24} />
                                Share Your Experience
                            </h2>
                            <button onClick={() => setShowForm(false)} className="p-2 hover:bg-[var(--color-surface-card)] rounded-full transition-colors text-slate-400">
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-8 space-y-8">
                            <div className="space-y-4 text-center">
                                <label className="text-xs font-black uppercase tracking-widest text-slate-400 block">Rate this product</label>
                                <div className="flex justify-center gap-2">
                                    {[1, 2, 3, 4, 5].map((s) => (
                                        <button
                                            key={s}
                                            type="button"
                                            onMouseEnter={() => setHoverRating(s)}
                                            onMouseLeave={() => setHoverRating(0)}
                                            onClick={() => setRating(s)}
                                            className="p-1 transition-transform active:scale-90"
                                        >
                                            <Star 
                                                size={36} 
                                                fill={(hoverRating || rating) >= s ? "#fbbf24" : "none"} 
                                                className={(hoverRating || rating) >= s ? "text-amber-400" : "text-slate-200"}
                                                strokeWidth={1.5}
                                            />
                                        </button>
                                    ))}
                                </div>
                                <div className="h-4 text-xs font-black text-primary uppercase tracking-widest">
                                    {hoverRating === 1 || (rating === 1 && !hoverRating) ? 'Poor' : ''}
                                    {hoverRating === 2 || (rating === 2 && !hoverRating) ? 'Fair' : ''}
                                    {hoverRating === 3 || (rating === 3 && !hoverRating) ? 'Good' : ''}
                                    {hoverRating === 4 || (rating === 4 && !hoverRating) ? 'Great' : ''}
                                    {hoverRating === 5 || (rating === 5 && !hoverRating) ? 'Outstanding' : ''}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Your feedback</label>
                                <textarea
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                    rows={4}
                                    className="w-full px-5 py-4 rounded-3xl bg-[var(--color-surface-low)] border-2 border-transparent focus:border-primary focus:bg-[var(--color-surface-card)] outline-none transition-all font-medium text-[var(--color-on-surface-variant)] placeholder:text-slate-300 resize-none"
                                    placeholder="What did you like or dislike? How was the quality?"
                                    required
                                />
                            </div>

                            <div className="pt-4 flex items-center gap-4">
                                <div className="p-4 rounded-2xl bg-amber-50 flex items-start gap-3">
                                    <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                                    <p className="text-[10px] font-bold text-amber-700 leading-relaxed">
                                        Verified Buyer badge will be added automatically if our systems confirm your purchase.
                                    </p>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={submitting || rating === 0}
                                className="w-full py-4 rounded-2xl bg-primary text-white font-black text-sm shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:grayscale"
                            >
                                {submitting ? (
                                    <div className="h-5 w-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <>
                                        <Send size={18} />
                                        Submit Review
                                    </>
                                )}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
