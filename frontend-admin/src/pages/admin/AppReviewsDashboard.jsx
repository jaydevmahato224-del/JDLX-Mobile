import { useState, useEffect } from 'react'
import { Star, User, Calendar, ExternalLink, MessageSquare, BarChart3, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '../../config'

export default function AppReviewsDashboard() {
    const [reviews, setReviews] = useState([]);
    const [summary, setSummary] = useState({ avg_rating: 0, total_reviews: 0, went_to_google: 0 });
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    const fetchData = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/app-reviews`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await res.json();
            if (res.ok) {
                const data = result.data || result;
                setReviews(data.reviews || []);
                setSummary(data.summary || { avg_rating: 0, total_reviews: 0, went_to_google: 0 });
            }
        } catch (error) {
            console.error('Failed to fetch app reviews:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    if (loading) return (
        <div className="flex h-96 flex-col items-center justify-center gap-4 text-gray-500">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            <p className="font-bold">Loading App Reviews...</p>
        </div>
    );

    return (
        <div className="p-6 flex flex-col gap-8">
            <div className="flex items-center gap-4">
                <button 
                    onClick={() => navigate(-1)}
                    className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
                >
                    <ArrowLeft size={24} />
                </button>
                <h1 className="text-3xl font-black text-gray-900 tracking-tight flex items-center gap-3">
                    <BarChart3 className="text-primary w-8 h-8" />
                    App Reviews Dashboard
                </h1>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <div className="ui-card-premium p-6 flex flex-col gap-2 bg-white">
                    <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center shadow-inner">
                        <Star size={24} fill="currentColor" />
                    </div>
                    <p className="ui-label mt-2">Average App Rating</p>
                    <h2 className="text-4xl font-black text-gray-900 tracking-tighter">{summary.avg_rating} / 5.0</h2>
                </div>

                <div className="ui-card-premium p-6 flex flex-col gap-2 bg-white">
                    <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center shadow-inner">
                        <MessageSquare size={24} />
                    </div>
                    <p className="ui-label mt-2">Total In-App Reviews</p>
                    <h2 className="text-4xl font-black text-gray-900 tracking-tighter">{summary.total_reviews}</h2>
                </div>

                <div className="ui-card-premium p-6 flex flex-col gap-2 bg-white">
                    <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center shadow-inner">
                        <ExternalLink size={24} />
                    </div>
                    <p className="ui-label mt-2">Public Reviews (Google)</p>
                    <h2 className="text-4xl font-black text-gray-900 tracking-tighter">{summary.went_to_google}</h2>
                </div>
            </div>

            {/* Table */}
            <div className="ui-card-premium overflow-hidden bg-white shadow-sm border border-gray-100">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50/50">
                            <tr>
                                <th className="p-5 font-bold text-gray-600 uppercase text-xs tracking-widest">User Details</th>
                                <th className="p-5 font-bold text-gray-600 uppercase text-xs tracking-widest">Rating</th>
                                <th className="p-5 font-bold text-gray-600 uppercase text-xs tracking-widest">Feedback</th>
                                <th className="p-5 font-bold text-gray-600 uppercase text-xs tracking-widest text-center">Platform</th>
                                <th className="p-5 font-bold text-gray-600 uppercase text-xs tracking-widest">Date</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {reviews.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-20 text-center">
                                        <div className="flex flex-col items-center gap-3 text-gray-400">
                                            <MessageSquare size={48} className="opacity-20" />
                                            <p className="font-semibold">No app reviews collected yet.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                reviews.map((review) => (
                                    <tr key={review.id} className="hover:bg-gray-50/50 transition-colors group">
                                        <td className="p-5">
                                            <div className="flex items-center gap-4">
                                                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-500 font-bold shadow-inner group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                                    {review.full_name?.charAt(0) || <User size={20} />}
                                                </div>
                                                <div>
                                                    <p className="font-black text-gray-900">{review.full_name}</p>
                                                    <p className="text-xs font-medium text-gray-500">{review.email}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-5">
                                            <div className="flex gap-1 text-amber-500">
                                                {[...Array(5)].map((_, i) => (
                                                    <Star key={i} size={16} fill={i < review.rating ? "currentColor" : "none"} strokeWidth={i < review.rating ? 0 : 2} />
                                                ))}
                                            </div>
                                        </td>
                                        <td className="p-5">
                                            <p className="max-w-md text-sm font-medium text-gray-700 leading-relaxed">
                                                {review.review_text === 'dismissed_maybe_later' ? 
                                                    <span className="italic text-gray-400">Dismissed ("Maybe later")</span> : 
                                                    (review.review_text || <span className="italic text-gray-400">Rating only</span>)
                                                }
                                            </p>
                                        </td>
                                        <td className="p-5 text-center">
                                            {review.went_to_google ? (
                                                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-4 py-1.5 text-xs font-black text-emerald-600 border border-emerald-100">
                                                    <ExternalLink size={12} /> Google
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-4 py-1.5 text-xs font-black text-gray-500 border border-gray-200">
                                                    In-App
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-5">
                                            <div className="flex items-center gap-2 text-sm font-bold text-gray-400">
                                                <Calendar size={14} />
                                                {new Date(review.submitted_at || review.created_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
