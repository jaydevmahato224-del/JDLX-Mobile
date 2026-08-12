import { useState, useEffect, useCallback } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { 
    ChevronRight, 
    Camera, 
    AlertCircle, 
    CheckCircle2, 
    Loader2, 
    RotateCcw, 
    Undo2, 
    Calendar,
    ArrowLeft,
    Coins,
    ChevronDown,
    Check
} from 'lucide-react'

function RefundRequestPage() {
    const token = useStore.getState().token;
    const user = useStore(state => state.user);
    const navigate = useNavigate();

    const [orders, setOrders] = useState([]);
    const [loadingOrders, setLoadingOrders] = useState(true);
    const [eligibility, setEligibility] = useState(null);
    const [loadingEligibility, setLoadingEligibility] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);

    const [form, setForm] = useState({
        order_id: '',
        request_type: '',
        reason: '',
        description: ''
    });
    const [photo, setPhoto] = useState(null);
    const [preview, setPreview] = useState(null);
    const [isReadOnly, setIsReadOnly] = useState(false);
    const [orderDropdownOpen, setOrderDropdownOpen] = useState(false);
    const [requestTypeDropdownOpen, setRequestTypeDropdownOpen] = useState(false);
    const [reasonDropdownOpen, setReasonDropdownOpen] = useState(false);

    useEffect(() => {
        if (!user) {
            navigate('/login');
            return;
        }

        const params = new URLSearchParams(window.location.search);
        const orderIdParam = params.get("order_id");

        const initialize = async () => {
            if (orderIdParam) {
                setForm(prev => ({ ...prev, order_id: orderIdParam }));
                setIsReadOnly(true);
                await checkEligibility(orderIdParam);
            }
            
            try {
                const res = await fetch(`${API_BASE_URL}/my-orders`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const data = await res.json();
                if (res.ok) {
                    setOrders(data.data || data);
                }
            } catch (err) {
                console.error("Failed to load orders", err);
            } finally {
                setLoadingOrders(false);
            }
        };

        initialize();
    }, [user, navigate, checkEligibility, token]);

    const checkEligibility = useCallback(async (orderId) => {
        if (!orderId) return;
        setLoadingEligibility(true);
        setErrorMsg(null);
        try {
            const res = await fetch(`${API_BASE_URL}/refund-eligibility/${orderId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok) {
                const result = data.data || data;
                setEligibility(result);
                if (!result.eligible) {
                    setErrorMsg(result.reason);
                }
            }
        } catch {
            toast.error("Eligibility check failed");
        } finally {
            setLoadingEligibility(false);
        }
    }, [token]);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setPhoto(file);
            setPreview(URL.createObjectURL(file));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorMsg(null);
        
        if (!form.order_id || !form.request_type || !form.reason || !form.description) {
            toast.error("All required fields are needed");
            return;
        }

        if (form.description.length < 30) {
            toast.error("Description must be at least 30 characters");
            return;
        }

        if (eligibility && !eligibility.eligible) {
            toast.error(eligibility.reason);
            return;
        }

        setSubmitting(true);
        const formData = new FormData();
        formData.append('order_id', form.order_id);
        formData.append('request_type', form.request_type);
        formData.append('reason', form.reason);
        formData.append('description', form.description);
        if (photo) {
            formData.append('photo', photo);
        }

        try {
            const res = await fetch(`${API_BASE_URL}/refund-request`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();
            
            if (res.ok) {
                toast.success("Refund request submitted!");
                setSuccess(true);
            } else {
                if (res.status === 403) {
                    setErrorMsg("This order does not belong to you.");
                } else if (res.status === 400 && data.message?.includes("7 day")) {
                    setErrorMsg("The 7-day return window has expired.");
                } else if (res.status === 400 && data.message?.includes("deliver")) {
                    setErrorMsg("Only delivered orders can be refunded.");
                } else if (res.status === 409) {
                    setErrorMsg(
                        <div className="flex flex-col gap-2">
                            <span>A refund request for this order has already been submitted.</span>
                            <Link to="/profile/my-refunds" className="text-white underline font-bold">View Requests →</Link>
                        </div>
                    );
                } else {
                    toast.error(data.message || "Failed to submit request");
                }
            }
        } catch {
            toast.error("Network issue.");
        } finally {
            setSubmitting(false);
        }
    };

    if (success) {
        return (
            <div className="container-standard py-20 flex flex-col items-center justify-center text-center">
                <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-6 animate-bounce">
                    <CheckCircle2 size={48} />
                </div>
                <h2 className="text-3xl font-black mb-2 tracking-tight">Refund Request Submitted!</h2>
                <div className="glass-card p-6 bg-green-50 border-green-100 text-green-800 mb-8 max-w-md">
                    <p className="font-bold text-lg mb-1 text-green-900">Expected refund: ₹{eligibility?.order_amount || '...'}</p>
                    <p className="text-sm opacity-80 italic">Final amount will be confirmed after admin review.</p>
                </div>
                <p className="text-gray-500 mb-8 max-w-md">Our team will process your request within 3-5 business days and provide a status update.</p>
                <Link to="/profile/my-refunds" className="btn-primary h-14 px-10">
                    My Refunds History <ChevronRight size={18} className="ml-2" />
                </Link>
            </div>
        );
    }

    return (
        <div className="container-standard py-6 max-w-3xl">
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <RotateCcw className="text-primary w-8 h-8" />
                        <h1 className="text-3xl font-black tracking-tight">Returns & Refunds</h1>
                    </div>
                    <p className="text-gray-500">Need to return an order? Please provide the details.</p>
                </div>
                <Link to="/profile/orders" className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline flex items-center gap-1">
                    <ArrowLeft size={12} /> Orders
                </Link>
            </div>

            {errorMsg && (
                <div className="mb-6 p-5 bg-red-500 text-white rounded-2xl flex items-start gap-4 shadow-lg animate-in slide-in-from-top-4 duration-300">
                    <AlertCircle className="shrink-0 mt-0.5" />
                    <div className="text-sm font-black uppercase tracking-widest">{errorMsg}</div>
                </div>
            )}

            {isReadOnly && eligibility && !eligibility.eligible && (
                <div className="glass-card p-10 text-center space-y-6">
                    <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center text-red-400 mx-auto">
                        <AlertCircle size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-800">Not Eligible for Refund</h3>
                    <p className="text-gray-500 text-sm max-w-xs mx-auto">{eligibility.reason}</p>
                    <Link to="/profile/orders" className="btn-primary inline-flex mt-4 px-10">
                        Back to My Orders
                    </Link>
                </div>
            )}

            {(!isReadOnly || (eligibility && eligibility.eligible)) && (
                <form onSubmit={handleSubmit} className="glass-card p-6 md:p-8 space-y-8">
                    {/* Order Selection */}
                    <div className="space-y-2 relative">
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Select Order</label>
                        <button
                            type="button"
                            disabled={loadingOrders || isReadOnly}
                            onClick={() => {
                                setOrderDropdownOpen(!orderDropdownOpen);
                                setRequestTypeDropdownOpen(false);
                                setReasonDropdownOpen(false);
                            }}
                            className={`w-full h-12 rounded-2xl bg-[var(--color-surface-low)] px-5 text-sm font-bold text-[var(--color-on-surface)] flex items-center justify-between border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                            <span className={form.order_id ? 'text-[var(--color-on-surface)]' : 'text-gray-400'}>
                                {form.order_id 
                                    ? (() => {
                                        const selected = orders.find(o => String(o.id) === String(form.order_id));
                                        return selected 
                                            ? `Order #${selected.id} — ${selected.product_names?.substring(0, 25)}...`
                                            : "Choose order..."
                                      })()
                                    : "Choose order..."
                                }
                            </span>
                            {!isReadOnly && <ChevronDown size={18} className={`text-gray-400 transition-transform duration-300 ${orderDropdownOpen ? 'rotate-180' : ''}`} />}
                        </button>
                        {loadingEligibility && <p className="text-[10px] text-primary animate-pulse ml-1">Verifying eligibility...</p>}

                        {orderDropdownOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setOrderDropdownOpen(false)} />
                                <div className="absolute top-full left-0 right-0 z-50 mt-1.5 p-1 bg-white border border-gray-100 rounded-2xl max-h-60 overflow-y-auto animate-in slide-in-from-top-2 duration-200 flex flex-col gap-0.5 shadow-xl">
                                    {orders.map(order => (
                                        <button
                                            key={order.id}
                                            type="button"
                                            onClick={() => {
                                                setForm({ ...form, order_id: order.id });
                                                setOrderDropdownOpen(false);
                                                setEligibility(null);
                                                checkEligibility(order.id);
                                            }}
                                            className={`w-full text-left px-4 py-3 text-xs font-bold rounded-xl transition-all flex items-center justify-between ${
                                                String(form.order_id) === String(order.id)
                                                ? 'bg-primary text-white'
                                                : 'text-slate-700 hover:bg-slate-50'
                                            }`}
                                        >
                                            <span className="truncate max-w-[90%]">
                                                Order #{order.id} — {order.product_names?.substring(0, 25)}... ({new Date(order.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })})
                                            </span>
                                            {String(form.order_id) === String(order.id) && (
                                                <Check size={14} className="text-white shrink-0" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                        
                        {eligibility && eligibility.eligible && (
                            <div className="mt-3 grid grid-cols-2 gap-4">
                                <div className="p-4 bg-primary/5 rounded-2xl border border-primary/10 flex items-center gap-3">
                                    <Coins size={20} className="text-primary" />
                                    <div>
                                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Refund Amount</p>
                                        <p className="text-sm font-black text-primary">₹{eligibility.order_amount}</p>
                                    </div>
                                </div>
                                <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-center gap-3">
                                    <Calendar size={20} className="text-amber-600" />
                                    <div>
                                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Return Window</p>
                                        <p className="text-sm font-black text-amber-700">{eligibility.days_remaining} Days Left</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Form Layout Split */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Request Type */}
                        <div className="space-y-2 relative">
                            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Request Type</label>
                            <button
                                type="button"
                                onClick={() => {
                                    setRequestTypeDropdownOpen(!requestTypeDropdownOpen);
                                    setOrderDropdownOpen(false);
                                    setReasonDropdownOpen(false);
                                }}
                                className="w-full h-12 rounded-2xl bg-[var(--color-surface-low)] px-5 text-sm font-bold text-[var(--color-on-surface)] flex items-center justify-between border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                            >
                                <span className={form.request_type ? 'text-[var(--color-on-surface)]' : 'text-gray-400'}>
                                    {form.request_type || "What do you want?"}
                                </span>
                                <ChevronDown size={18} className={`text-gray-400 transition-transform duration-300 ${requestTypeDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {requestTypeDropdownOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setRequestTypeDropdownOpen(false)} />
                                    <div className="absolute top-full left-0 right-0 z-50 mt-1.5 p-1 bg-white border border-gray-100 rounded-2xl max-h-60 overflow-y-auto animate-in slide-in-from-top-2 duration-200 flex flex-col gap-0.5 shadow-xl">
                                        {[
                                            "Refund only",
                                            "Return and Refund",
                                            "Exchange"
                                        ].map(typeVal => (
                                            <button
                                                key={typeVal}
                                                type="button"
                                                onClick={() => {
                                                    setForm({ ...form, request_type: typeVal });
                                                    setRequestTypeDropdownOpen(false);
                                                }}
                                                className={`w-full text-left px-4 py-3 text-xs font-bold rounded-xl transition-all flex items-center justify-between ${
                                                    form.request_type === typeVal
                                                    ? 'bg-primary text-white'
                                                    : 'text-slate-700 hover:bg-slate-50'
                                                }`}
                                            >
                                                <span>{typeVal}</span>
                                                {form.request_type === typeVal && (
                                                    <Check size={14} className="text-white shrink-0" />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Reason */}
                        <div className="space-y-2 relative">
                            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Reason for Return</label>
                            <button
                                type="button"
                                onClick={() => {
                                    setReasonDropdownOpen(!reasonDropdownOpen);
                                    setOrderDropdownOpen(false);
                                    setRequestTypeDropdownOpen(false);
                                }}
                                className="w-full h-12 rounded-2xl bg-[var(--color-surface-low)] px-5 text-sm font-bold text-[var(--color-on-surface)] flex items-center justify-between border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                            >
                                <span className={form.reason ? 'text-[var(--color-on-surface)]' : 'text-gray-400'}>
                                    {form.reason || "Reason for returning?"}
                                </span>
                                <ChevronDown size={18} className={`text-gray-400 transition-transform duration-300 ${reasonDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {reasonDropdownOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setReasonDropdownOpen(false)} />
                                    <div className="absolute top-full left-0 right-0 z-50 mt-1.5 p-1 bg-white border border-gray-100 rounded-2xl max-h-60 overflow-y-auto animate-in slide-in-from-top-2 duration-200 flex flex-col gap-0.5 shadow-xl">
                                        {[
                                            "Item damaged on arrival",
                                            "Wrong item delivered",
                                            "Item not as described",
                                            "Changed my mind",
                                            "Item stopped working",
                                            "Other"
                                        ].map(reasonVal => (
                                            <button
                                                key={reasonVal}
                                                type="button"
                                                onClick={() => {
                                                    setForm({ ...form, reason: reasonVal });
                                                    setReasonDropdownOpen(false);
                                                }}
                                                className={`w-full text-left px-4 py-3 text-xs font-bold rounded-xl transition-all flex items-center justify-between ${
                                                    form.reason === reasonVal
                                                    ? 'bg-primary text-white'
                                                    : 'text-slate-700 hover:bg-slate-50'
                                                }`}
                                            >
                                                <span>{reasonVal}</span>
                                                {form.reason === reasonVal && (
                                                    <Check size={14} className="text-white shrink-0" />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Description</label>
                        <textarea
                            placeholder="Describe the problem in detail — this helps our team process your request faster..."
                            value={form.description}
                            onChange={e => setForm({ ...form, description: e.target.value })}
                            className="w-full min-h-[140px] rounded-2xl bg-[var(--color-surface-low)] p-5 text-sm font-bold text-[var(--color-on-surface)] border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none"
                        />
                        <div className="flex justify-between items-center px-1">
                            <p className="text-[9px] text-gray-400 uppercase font-bold tracking-widest">
                                {form.description.length}/30 characters minimum
                            </p>
                            <p className="text-[9px] text-gray-400 italic">Expected refund is ₹{eligibility?.order_amount || '0'}</p>
                        </div>
                    </div>

                    {/* Photo Upload */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Evidence Photo (Optional)</label>
                        <div className="flex items-center gap-4">
                            <label className="cursor-pointer flex flex-col items-center justify-center w-24 h-24 rounded-2xl border-2 border-dashed border-gray-200 hover:border-primary hover:bg-primary/5 transition-all text-gray-400 hover:text-primary">
                                <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                                <Camera size={24} />
                                <span className="text-[9px] font-black uppercase mt-1">Upload</span>
                            </label>
                            {preview && (
                                <div className="relative w-24 h-24 rounded-2xl overflow-hidden border border-gray-100 shadow-sm group">
                                    <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                                    <button 
                                        type="button"
                                        onClick={() => { setPhoto(null); setPreview(null); }}
                                        className="absolute inset-0 bg-red-500/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <span className="text-[9px] font-black uppercase">Remove</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Action Button */}
                    <div className="pt-4">
                        <button
                            type="submit"
                            disabled={submitting || (eligibility && !eligibility.eligible)}
                            className="btn-primary w-full h-16 text-base tracking-widest relative overflow-hidden group"
                        >
                            {submitting ? (
                                <span className="flex items-center gap-2">
                                    <Loader2 size={20} className="animate-spin" /> Processing...
                                </span>
                            ) : (
                                <span className="flex items-center gap-2">
                                    <Undo2 size={20} /> Submit Refund Request
                                </span>
                            )}
                        </button>
                        <p className="text-[10px] text-center text-gray-400 mt-4 font-bold uppercase tracking-tighter">
                            Final amount will be confirmed after admin review
                        </p>
                    </div>
                </form>
            )}
        </div>
    )
}

export default RefundRequestPage
