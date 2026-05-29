import React, { useState } from 'react';
import { Star, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { API_BASE_URL } from '../config';
import toast from 'react-hot-toast';

export default function AppReviewPrompt({ show, reason, onDismiss }) {
    const [rating, setRating] = useState(0);
    const [reviewText, setReviewText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const token = useStore.getState().token;
    const googleReviewUrl = import.meta.env.VITE_GOOGLE_REVIEW_URL || 'https://g.page/r/YOUR_GOOGLE_PLACE_ID/review';

    if (!show) return null;

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
        if (rating === 0) {
            toast.error('Please select a rating');
            return;
        }

        setIsSubmitting(true);
        const wentToGoogle = rating >= 4;

        try {
            const res = await fetch(`${API_BASE_URL}/app-review/submit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    rating,
                    review_text: reviewText,
                    went_to_google: wentToGoogle
                })
            });

            if (res.ok) {
                toast.success('Thank you for your feedback!');
                if (wentToGoogle) {
                    window.open(googleReviewUrl, '_blank');
                }
                onDismiss();
            } else {
                toast.error('Failed to submit review');
            }
        } catch (err) {
            console.error('Error submitting review:', err);
            toast.error('Connection error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleMaybeLater = async () => {
        // Submit empty review to dismiss forever as per requirements
        try {
            await fetch(`${API_BASE_URL}/app-review/submit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    rating: null,
                    review_text: 'dismissed_maybe_later',
                    went_to_google: false
                })
            });
        } catch (err) {
            console.error('Error dismissing review:', err);
        }
        onDismiss();
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 pb-[80px] backdrop-blur-sm">
            <div className="relative w-[90%] max-w-[400px] max-h-[calc(100vh-160px)] overflow-y-auto rounded-[24px] bg-white p-6 shadow-2xl animate-in slide-in-from-bottom duration-500">
                <button 
                    onClick={onDismiss}
                    className="absolute right-4 top-4 rounded-full p-2 text-gray-400 hover:bg-gray-100 transition-colors"
                >
                    <X size={24} />
                </button>

                <div className="flex flex-col items-center text-center">
                    <img src="/logo192.png" alt="JDLX Logo" className="mb-4 h-16 w-16 object-contain" />
                    <h2 className="mb-2 text-2xl font-bold text-gray-900">Enjoying JDLX Mobile?</h2>
                    <p className="mb-6 text-gray-600">Your review helps other shoppers discover us</p>

                    <div className="mb-6 flex gap-2">
                        {[1, 2, 3, 4, 5].map((star) => (
                            <button
                                key={star}
                                onClick={() => setRating(star)}
                                className="transition-transform active:scale-90"
                            >
                                <Star
                                    size={40}
                                    fill={rating >= star ? "#F5A623" : "none"}
                                    color={rating >= star ? "#F5A623" : "#D1D5DB"}
                                    strokeWidth={rating >= star ? 0 : 2}
                                />
                            </button>
                        ))}
                    </div>

                    {rating > 0 && rating <= 3 && (
                        <textarea
                            value={reviewText}
                            onChange={(e) => setReviewText(e.target.value)}
                            placeholder="Tell us more... (optional)"
                            className="mb-6 w-full rounded-xl border border-gray-200 p-4 text-gray-700 focus:border-[#F5A623] focus:outline-none focus:ring-1 focus:ring-[#F5A623] transition-all"
                            rows={3}
                        />
                    )}

                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || rating === 0}
                        className={`mb-4 w-full rounded-full py-4 text-lg font-bold text-white transition-all active:scale-[0.98] ${
                            rating === 0 
                            ? 'bg-gray-300 cursor-not-allowed' 
                            : 'bg-black hover:bg-gray-800 shadow-lg'
                        }`}
                    >
                        {isSubmitting ? 'Submitting...' : (rating >= 4 ? 'Submit & Rate on Google' : 'Submit Feedback')}
                    </button>

                    <button
                        onClick={handleMaybeLater}
                        className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
                    >
                        Maybe later
                    </button>
                </div>
            </div>
        </div>
    );
}
