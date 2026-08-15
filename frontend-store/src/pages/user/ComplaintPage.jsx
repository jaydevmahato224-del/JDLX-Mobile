import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronRight, Camera, AlertCircle, CheckCircle2, Loader2, ChevronDown, Check } from 'lucide-react'

function ComplaintPage() {
    const token = useStore.getState().token;
    const user = useStore(state => state.user);
    const navigate = useNavigate();

    const [orders, setOrders] = useState([]);
    const [loadingOrders, setLoadingOrders] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);

    const [form, setForm] = useState({
        order_id: '',
        issue_type: '',
        description: ''
    });
    const [photo, setPhoto] = useState(null);
    const [preview, setPreview] = useState(null);
    const [orderDropdownOpen, setOrderDropdownOpen] = useState(false);
    const [issueDropdownOpen, setIssueDropdownOpen] = useState(false);

    useEffect(() => {
        if (!user) {
            navigate('/login');
            return;
        }

        const fetchOrders = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/my-orders`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const data = await res.json();
                if (res.ok) {
                    const fetchedOrders = data.data || data;
                    setOrders(fetchedOrders);
                    
                    // Pre-select order from URL query param
                    const params = new URLSearchParams(window.location.search);
                    const preselectedOrder = params.get("order_id");
                    if (preselectedOrder && fetchedOrders.some(o => String(o.id) === String(preselectedOrder))) {
                        setForm(prev => ({ ...prev, order_id: preselectedOrder }));
                    }
                }
            } catch (err) {
                console.error("Failed to load orders", err);
            } finally {
                setLoadingOrders(false);
            }
        };

        fetchOrders();
    }, [user, navigate, token]);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setPhoto(file);
            setPreview(URL.createObjectURL(file));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!form.order_id || !form.issue_type || !form.description) {
            toast.error("Please fill in all required fields");
            return;
        }

        setSubmitting(true);
        const formData = new FormData();
        formData.append('order_id', form.order_id);
        formData.append('issue_type', form.issue_type);
        formData.append('description', form.description);
        if (photo) {
            formData.append('photo', photo);
        }

        try {
            const res = await fetch(`${API_BASE_URL}/complaint`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();
            
            if (res.ok) {
                toast.success("Complaint submitted successfully");
                setSuccess(true);
            } else {
                toast.error(data.message || "Failed to submit complaint");
            }
        } catch {
            toast.error("Something went wrong. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    if (success) {
        return (
            <div className="container-standard py-20 flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-6 animate-bounce">
                    <CheckCircle2 size={40} />
                </div>
                <h2 className="text-3xl font-black mb-2">Complaint Submitted!</h2>
                <p className="text-gray-500 mb-8 max-w-md">Your issue has been recorded. Our team will review it and get back to you shortly.</p>
                <Link to="/my-requests" className="btn-primary h-14 px-10">
                    View My Requests <ChevronRight size={18} className="ml-2" />
                </Link>
            </div>
        );
    }

    return (
        <div className="container-standard py-6 max-w-3xl">
            <div className="mb-8">
                <h1 className="text-3xl font-black tracking-tight">Report an Issue</h1>
                <p className="text-gray-500 mt-1">Tell us what went wrong with your order.</p>
            </div>

            <form onSubmit={handleSubmit} className="glass-card p-6 md:p-8 space-y-6">
                {/* Order Selection */}
                <div className="space-y-2 relative">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Select Order</label>
                    <button
                        type="button"
                        disabled={loadingOrders}
                        onClick={() => {
                            setOrderDropdownOpen(!orderDropdownOpen);
                            setIssueDropdownOpen(false);
                        }}
                        className="w-full h-12 rounded-2xl bg-[var(--color-surface-low)] px-5 text-sm font-bold text-[var(--color-on-surface)] flex items-center justify-between border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all disabled:opacity-50"
                    >
                        <span className={form.order_id ? 'text-[var(--color-on-surface)]' : 'text-gray-400'}>
                            {form.order_id 
                                ? (() => {
                                    const selected = orders.find(o => String(o.id) === String(form.order_id));
                                    return selected 
                                        ? `Order #${selected.order_number || selected.id} - ${selected.product_names?.substring(0, 30)}...`
                                        : "Choose an order..."
                                  })()
                                : "Choose an order..."
                            }
                        </span>
                        <ChevronDown size={18} className={`text-gray-400 transition-transform duration-300 ${orderDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {loadingOrders && <p className="text-[10px] text-primary animate-pulse ml-1">Loading your orders...</p>}

                    {orderDropdownOpen && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setOrderDropdownOpen(false)} />
                            <div className="absolute top-full left-0 right-0 z-50 mt-1.5 p-1 bg-[var(--color-surface-card)] border border-[var(--color-surface-high)] rounded-2xl max-h-60 overflow-y-auto animate-in slide-in-from-top-2 duration-200 flex flex-col gap-0.5 shadow-xl">
                                {orders.map(order => (
                                    <button
                                        key={order.id}
                                        type="button"
                                        onClick={() => {
                                            setForm({ ...form, order_id: order.id });
                                            setOrderDropdownOpen(false);
                                        }}
                                        className={`w-full text-left px-4 py-3 text-xs font-bold rounded-xl transition-all flex items-center justify-between ${
                                            String(form.order_id) === String(order.id)
                                            ? 'bg-primary text-white'
                                            : 'text-slate-700 hover:bg-slate-50'
                                        }`}
                                    >
                                        <span className="truncate max-w-[90%]">
                                            Order #{order.order_number || order.id} - {order.product_names?.substring(0, 30)}... ({new Date(order.created_at).toLocaleDateString()})
                                        </span>
                                        {String(form.order_id) === String(order.id) && (
                                            <Check size={14} className="text-white shrink-0" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* Issue Type */}
                <div className="space-y-2 relative">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Issue Type</label>
                    <button
                        type="button"
                        onClick={() => {
                            setIssueDropdownOpen(!issueDropdownOpen);
                            setOrderDropdownOpen(false);
                        }}
                        className="w-full h-12 rounded-2xl bg-[var(--color-surface-low)] px-5 text-sm font-bold text-[var(--color-on-surface)] flex items-center justify-between border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    >
                        <span className={form.issue_type ? 'text-[var(--color-on-surface)]' : 'text-gray-400'}>
                            {form.issue_type || "What's the problem?"}
                        </span>
                        <ChevronDown size={18} className={`text-gray-400 transition-transform duration-300 ${issueDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {issueDropdownOpen && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setIssueDropdownOpen(false)} />
                            <div className="absolute top-full left-0 right-0 z-50 mt-1.5 p-1 bg-[var(--color-surface-card)] border border-[var(--color-surface-high)] rounded-2xl max-h-60 overflow-y-auto animate-in slide-in-from-top-2 duration-200 flex flex-col gap-0.5 shadow-xl">
                                {[
                                    "Damaged product",
                                    "Wrong product delivered",
                                    "Missing item in order",
                                    "Product not working",
                                    "Other"
                                ].map(issue => (
                                    <button
                                        key={issue}
                                        type="button"
                                        onClick={() => {
                                            setForm({ ...form, issue_type: issue });
                                            setIssueDropdownOpen(false);
                                        }}
                                        className={`w-full text-left px-4 py-3 text-xs font-bold rounded-xl transition-all flex items-center justify-between ${
                                            form.issue_type === issue
                                            ? 'bg-primary text-white'
                                            : 'text-slate-700 hover:bg-slate-50'
                                        }`}
                                    >
                                        <span>{issue}</span>
                                        {form.issue_type === issue && (
                                            <Check size={14} className="text-white shrink-0" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* Description */}
                <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Description</label>
                    <textarea
                        placeholder="Please describe the issue in detail..."
                        value={form.description}
                        onChange={e => setForm({ ...form, description: e.target.value })}
                        className="w-full min-h-[120px] rounded-2xl bg-[var(--color-surface-low)] p-5 text-sm font-bold text-[var(--color-on-surface)] border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none"
                    />
                </div>

                {/* Photo Upload */}
                <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Attach Photo (Optional)</label>
                    <div className="flex items-center gap-4">
                        <label className="cursor-pointer flex flex-col items-center justify-center w-24 h-24 rounded-2xl border-2 border-dashed border-gray-200 hover:border-primary hover:bg-primary/5 transition-all text-gray-400 hover:text-primary">
                            <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                            <Camera size={24} />
                            <span className="text-[9px] font-black uppercase mt-1">Upload</span>
                        </label>
                        {preview && (
                            <div className="relative w-24 h-24 rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
                                <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                                <button 
                                    type="button"
                                    onClick={() => { setPhoto(null); setPreview(null); }}
                                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-all"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Submit Button */}
                <button
                    type="submit"
                    disabled={submitting}
                    className="btn-primary w-full h-14 text-base tracking-widest mt-4"
                >
                    {submitting ? (
                        <span className="flex items-center gap-2">
                            <Loader2 size={20} className="animate-spin" /> Submitting...
                        </span>
                    ) : (
                        "Submit Complaint"
                    )}
                </button>
            </form>
        </div>
    )
}

// Helper X icon for the preview remove button
const X = ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
)

export default ComplaintPage
