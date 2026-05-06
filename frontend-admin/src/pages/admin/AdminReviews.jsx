import { useState, useEffect } from 'react'
import { ArrowLeft, Search, Filter, Trash2, Star, MessageSquare, User, Package, AlertCircle, ShieldCheck, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '../../config'

function AdminReviews() {
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [ratingFilter, setRatingFilter] = useState('all');
    const navigate = useNavigate();

    const fetchReviews = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/reviews`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok) {
                // Handle both {data: [...]} and [...] formats
                const reviewData = data.data || data;
                setReviews(Array.isArray(reviewData) ? reviewData : []);
            }
        } catch (error) {
            console.error('Failed to fetch reviews:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchReviews();
    }, []);

    const handleDeleteReview = async (reviewId) => {
        if (!window.confirm('Are you sure you want to delete this review? This action cannot be undone.')) return;
        
        try {
            const token = localStorage.getItem('adminToken') || localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/admin/reviews/${reviewId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                setReviews(prev => prev.filter(r => r.id !== reviewId));
            } else {
                const data = await res.json();
                alert(data.error || 'Failed to delete review');
            }
        } catch (error) {
            console.error('Delete error:', error);
            alert('An error occurred while deleting the review');
        }
    };

    const filteredReviews = Array.isArray(reviews) ? reviews.filter(rev => {
        const matchesSearch = 
            (rev.product_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (rev.user_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (rev.review_text || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (rev.product_sku || '').toLowerCase().includes(searchTerm.toLowerCase());
        
        const matchesRating = ratingFilter === 'all' || rev.rating === parseInt(ratingFilter);
        
        return matchesSearch && matchesRating;
    }) : [];

    const stats = {
        total: reviews.length,
        average: reviews.length > 0 ? (reviews.reduce((acc, curr) => acc + curr.rating, 0) / reviews.length).toFixed(1) : '0.0',
        verified: reviews.filter(r => r.is_verified === 1).length,
        lowRating: reviews.filter(r => r.rating <= 2).length
    };

    return (
        <div className="py-6 flex flex-col gap-6 relative min-h-screen">
            <div className="flex items-center gap-4">
                <button onClick={() => navigate('/admin')} className="p-2 bg-white rounded-full shadow-sm hover:bg-gray-50 transition-colors">
                    <ArrowLeft className="w-5 h-5 text-gray-800" />
                </button>
                <h1 className="text-2xl font-bold text-gray-800">Customer Reviews Management</h1>
            </div>

            {/* Analytics Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="glass-card p-4 flex flex-col justify-center border-l-4 border-blue-500">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Total Reviews</p>
                    <p className="text-2xl font-black text-gray-800">{stats.total}</p>
                </div>
                <div className="glass-card p-4 flex flex-col justify-center border-l-4 border-yellow-400">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Avg Store Rating</p>
                    <div className="flex items-center gap-2">
                        <p className="text-2xl font-black text-gray-800">{stats.average}</p>
                        <div className="flex text-yellow-400">
                             <Star size={16} fill="currentColor" />
                        </div>
                    </div>
                </div>
                <div className="glass-card p-4 flex flex-col justify-center border-l-4 border-green-500">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Verified Purchases</p>
                    <p className="text-2xl font-black text-green-600">{stats.verified}</p>
                </div>
                <div className="glass-card p-4 flex flex-col justify-center border-l-4 border-red-500">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Critical (1-2★)</p>
                    <p className="text-2xl font-black text-red-600">{stats.lowRating}</p>
                </div>
            </div>

            {/* Controls */}
            <div className="glass-card p-4 flex flex-col md:flex-row gap-4 items-center justify-between bg-white/50 backdrop-blur-md">
                <div className="relative w-full md:w-96">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search product, user or content..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm font-medium transition-all"
                    />
                </div>
                
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-xl">
                        {['all', '5', '4', '3', '2', '1'].map(r => (
                            <button
                                key={r}
                                onClick={() => setRatingFilter(r)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    ratingFilter === r 
                                    ? 'bg-white text-gray-900 shadow-sm' 
                                    : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                {r === 'all' ? 'All' : `${r}★`}
                            </button>
                        ))}
                    </div>
                    <button 
                        onClick={fetchReviews}
                        className="p-2.5 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
                    >
                        <RefreshCw size={18} className={`text-gray-600 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="glass-card overflow-hidden border border-gray-100 shadow-xl shadow-gray-200/20">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50/50">
                                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100">Product Info</th>
                                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100">Reviewer</th>
                                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100">Rating & Content</th>
                                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {loading ? (
                                <tr>
                                    <td colSpan="4" className="px-6 py-20 text-center">
                                        <div className="flex flex-col items-center gap-3">
                                            <div className="w-10 h-10 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                                            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Loading Reviews...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredReviews.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="px-6 py-20 text-center">
                                        <div className="flex flex-col items-center gap-4 opacity-20">
                                            <MessageSquare size={48} />
                                            <p className="text-lg font-bold uppercase tracking-widest">No reviews found</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredReviews.map((rev) => (
                                <tr key={rev.id} className="hover:bg-gray-50/50 transition-colors group">
                                    <td className="px-6 py-5">
                                        <div className="flex flex-col">
                                            <span className="text-sm font-bold text-gray-800 line-clamp-1">{rev.product_name}</span>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-[10px] font-black text-blue-500 uppercase tracking-tighter">{rev.product_sku}</span>
                                                {rev.store_name && (
                                                    <>
                                                        <span className="w-1 h-1 rounded-full bg-gray-300" />
                                                        <span className="text-[10px] font-black text-emerald-600 uppercase tracking-tighter">
                                                            {rev.store_name} {rev.store_id_code && `(#${rev.store_id_code})`}
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-black text-gray-400 border border-gray-200">
                                                {rev.user_name?.charAt(0) || 'U'}
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-gray-800">{rev.user_name}</span>
                                                <span className="text-[10px] font-medium text-gray-400 lowercase">{rev.user_email}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5">
                                        <div className="flex flex-col gap-1.5 max-w-md">
                                            <div className="flex items-center gap-2">
                                                <div className="flex text-yellow-400">
                                                    {[1, 2, 3, 4, 5].map(s => (
                                                        <Star key={s} size={10} fill={s <= rev.rating ? "currentColor" : "none"} className={s <= rev.rating ? "" : "text-gray-200"} />
                                                    ))}
                                                </div>
                                                {rev.is_verified === 1 && (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-green-50 text-green-600 text-[8px] font-black uppercase tracking-tighter border border-green-100">
                                                        <ShieldCheck size={8} />
                                                        Verified
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm text-gray-600 font-medium leading-relaxed italic line-clamp-2">"{rev.review_text}"</p>
                                            <span className="text-[9px] text-gray-400 font-bold">{new Date(rev.created_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5 text-right">
                                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                            <button 
                                                onClick={() => handleDeleteReview(rev.id)}
                                                className="p-2.5 rounded-xl bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition-all shadow-sm"
                                                title="Delete Review"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}

export default AdminReviews
