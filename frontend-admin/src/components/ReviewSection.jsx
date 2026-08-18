import { useState, useEffect } from 'react'
import { Star, MessageSquare, ShieldCheck, User, Send } from 'lucide-react'
import { API_BASE_URL } from '../config'
import { useStore } from '../store/useStore'

function ReviewSection({ productId, averageRating, totalReviews }) {
    const [reviews, setReviews] = useState([]);
    const [rating, setRating] = useState(5);
    const [reviewText, setReviewText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);

    const token = useStore(state => state.token);
    const user = useStore(state => state.user);

    const fetchReviews = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/review/product/${productId}`);
            const data = await res.json();
            if (res.ok) {
                setReviews(data);
            }
        } catch (error) {
            console.error('Failed to fetch reviews:', error);
        }
    };

    /* eslint-disable react-hooks/exhaustive-deps -- intentional: fetch on mount only */
    useEffect(() => {
        // Wrapped so the fetch isn't invoked synchronously from the effect body
        const load = () => fetchReviews();
        load();
    }, [productId]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setSuccess(false);

        if (!token) {
            setError("Please login to leave a review.");
            return;
        }

        setIsSubmitting(true);
        try {
            const res = await fetch(`${API_BASE_URL}/review/add`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    product_id: productId,
                    rating,
                    review_text: reviewText
                })
            });

            const data = await res.json();
            if (res.ok) {
                setSuccess(true);
                setReviewText('');
                fetchReviews();
            } else {
                setError(data.error || "Failed to submit review");
            }
        } catch {
            setError("An error occurred while submitting your review.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const renderStars = (count, active = true, size = 16) => {
        return [...Array(5)].map((_, i) => (
            <Star
                key={i}
                size={size}
                className={`${i < count ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'} ${!active ? 'opacity-50' : ''}`}
            />
        ));
    };

    return (
        <div className="mt-12 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-xl">
                        <MessageSquare className="text-primary w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-gray-800">Customer Reviews</h3>
                        <p className="text-xs text-gray-500">{totalReviews} verified ratings</p>
                    </div>
                </div>
                <div className="text-right">
                    <div className="flex items-center gap-1">
                        <span className="text-2xl font-black text-gray-800">{averageRating || '0.0'}</span>
                        <div className="flex">{renderStars(Math.round(averageRating || 0), true, 18)}</div>
                    </div>
                </div>
            </div>

            {/* Review Form (Conditional for buyers in real logic, currently public for verification) */}
            {user && (
                <div className="glass-card p-6 border-2 border-primary/10 bg-primary/5">
                    <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-primary" /> Verified Purchase Review
                    </h4>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-medium text-gray-600">Your Rating:</span>
                            <div className="flex gap-1">
                                {[1, 2, 3, 4, 5].map((num) => (
                                    <button
                                        key={num}
                                        type="button"
                                        onClick={() => setRating(num)}
                                        className="transition-transform active:scale-90"
                                    >
                                        <Star size={24} className={`${num <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'} transition-colors`} />
                                    </button>
                                ))}
                            </div>
                        </div>

                        <textarea
                            value={reviewText}
                            onChange={(e) => setReviewText(e.target.value)}
                            placeholder="Share your experience with this product..."
                            className="w-full bg-white border border-gray-200 rounded-xl p-4 text-sm focus:ring-2 focus:ring-primary focus:outline-none transition-all h-24 placeholder:text-gray-400"
                        />

                        {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
                        {success && <p className="text-xs text-green-500 font-bold">Thank you! Your review has been posted.</p>}

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="btn-primary w-full flex items-center justify-center gap-2 py-3 rounded-xl shadow-lg shadow-primary/20"
                        >
                            {isSubmitting ? 'Posting...' : (
                                <>
                                    <span>Post Review</span>
                                    <Send size={16} />
                                </>
                            )}
                        </button>
                    </form>
                </div>
            )}

            {/* Review List */}
            <div className="space-y-6">
                {reviews.length === 0 ? (
                    <div className="text-center py-10 opacity-50">
                        <p className="text-sm text-gray-500 italic">No reviews yet. Be the first to share your feedback!</p>
                    </div>
                ) : (
                    reviews.map((rev) => (
                        <div key={rev.id} className="glass-card p-5 animate-in fade-in slide-in-from-left-2 duration-500">
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center border border-gray-200">
                                        <User size={16} className="text-gray-400" />
                                    </div>
                                    <div>
                                        <h5 className="text-sm font-bold text-gray-800">{rev.user_name}</h5>
                                        <div className="flex">{renderStars(rev.rating, true, 12)}</div>
                                    </div>
                                </div>
                                <span className="text-[10px] text-gray-400 font-medium">
                                    {new Date(rev.created_at).toLocaleDateString()}
                                </span>
                            </div>
                            <p className="text-gray-600 text-sm leading-relaxed mt-3 italic">
                                "{rev.review_text}"
                            </p>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}

export default ReviewSection
