import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronRight, Camera, AlertCircle, CheckCircle2, Loader2, PackageSearch, ChevronDown, Check } from 'lucide-react'

function OrderReportPage() {
    const token = useStore.getState().token;
    const user = useStore(state => state.user);
    const navigate = useNavigate();

    const [orders, setOrders] = useState([]);
    const [loadingOrders, setLoadingOrders] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);

    const [form, setForm] = useState({
        order_id: '',
        report_type: '',
        description: ''
    });
    const [photo, setPhoto] = useState(null);
    const [preview, setPreview] = useState(null);
    const [isReadOnly, setIsReadOnly] = useState(false);
    const [orderDropdownOpen, setOrderDropdownOpen] = useState(false);
    const [reportTypeDropdownOpen, setReportTypeDropdownOpen] = useState(false);

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
                        setIsReadOnly(true);
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
        setErrorMsg(null);
        
        if (!form.order_id || !form.report_type || !form.description) {
            toast.error("Please fill in all details");
            return;
        }

        if (form.description.length < 20) {
            toast.error("Description must be at least 20 characters");
            return;
        }

        setSubmitting(true);
        const formData = new FormData();
        formData.append('order_id', form.order_id);
        formData.append('report_type', form.report_type);
        formData.append('description', form.description);
        if (photo) {
            formData.append('photo', photo);
        }

        try {
            const res = await fetch(`${API_BASE_URL}/order-report`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();
            
            if (res.ok) {
                toast.success("Report submitted successfully!");
                setSuccess(true);
            } else {
                if (res.status === 403) {
                    setErrorMsg("This order does not belong to you. Please select a valid order.");
                } else if (res.status === 400 && data.message?.includes("deliver hue")) {
                    setErrorMsg("Reports can only be submitted for delivered orders. Please wait for processing orders to be delivered.");
                } else if (res.status === 409) {
                    setErrorMsg(
                        <div className="flex flex-col gap-2">
                            <span>A report for this order has already been submitted.</span>
                            <Link to="/profile/my-reports" className="text-white underline font-bold">View previous report →</Link>
                        </div>
                    );
                } else {
                    toast.error(data.message || "Failed to submit report");
                }
            }
        } catch {
            toast.error("Network issue. Please try again.");
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
                <h2 className="text-3xl font-black mb-2">Report Submitted!</h2>
                <p className="text-gray-500 mb-8 max-w-md">Your report has been submitted! Our team will review it within 48 hours and provide an update.</p>
                <Link to="/profile/my-reports" className="btn-primary h-14 px-10">
                    My Reports History <ChevronRight size={18} className="ml-2" />
                </Link>
            </div>
        );
    }

    return (
        <div className="container-standard py-6 max-w-3xl">
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                    <PackageSearch className="text-primary w-8 h-8" />
                    <h1 className="text-3xl font-black tracking-tight">Report Order Issue</h1>
                </div>
                <p className="text-gray-500">Experienced a problem after your order was delivered? Report it here.</p>
            </div>

            {errorMsg && (
                <div className="mb-6 p-5 bg-red-500 text-white rounded-2xl flex items-start gap-4 shadow-lg animate-in slide-in-from-top-4 duration-300">
                    <AlertCircle className="shrink-0 mt-0.5" />
                    <div className="text-sm font-black uppercase tracking-widest">{errorMsg}</div>
                </div>
            )}

            <form onSubmit={handleSubmit} className="glass-card p-6 md:p-8 space-y-6">
                {/* Order Selection */}
                <div className="space-y-2 relative">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Select Your Order</label>
                    <button
                        type="button"
                        disabled={loadingOrders || isReadOnly}
                        onClick={() => {
                            setOrderDropdownOpen(!orderDropdownOpen);
                            setReportTypeDropdownOpen(false);
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
                    {loadingOrders && <p className="text-[10px] text-primary animate-pulse ml-1">Checking your recent orders...</p>}

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
                </div>

                {/* Report Type */}
                <div className="space-y-2 relative">
                    <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Problem Type</label>
                    <button
                        type="button"
                        onClick={() => {
                            setReportTypeDropdownOpen(!reportTypeDropdownOpen);
                            setOrderDropdownOpen(false);
                        }}
                        className="w-full h-12 rounded-2xl bg-[var(--color-surface-low)] px-5 text-sm font-bold text-[var(--color-on-surface)] flex items-center justify-between border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    >
                        <span className={form.report_type ? 'text-[var(--color-on-surface)]' : 'text-gray-400'}>
                            {form.report_type || "What happened?"}
                        </span>
                        <ChevronDown size={18} className={`text-gray-400 transition-transform duration-300 ${reportTypeDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {reportTypeDropdownOpen && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setReportTypeDropdownOpen(false)} />
                            <div className="absolute top-full left-0 right-0 z-50 mt-1.5 p-1 bg-[var(--color-surface-card)] border border-[var(--color-surface-high)] rounded-2xl max-h-60 overflow-y-auto animate-in slide-in-from-top-2 duration-200 flex flex-col gap-0.5 shadow-xl">
                                {[
                                    "Item not delivered",
                                    "Wrong item received",
                                    "Missing item in package",
                                    "Damaged in transit",
                                    "Duplicate charge",
                                    "Other"
                                ].map(typeVal => (
                                    <button
                                        key={typeVal}
                                        type="button"
                                        onClick={() => {
                                            setForm({ ...form, report_type: typeVal });
                                            setReportTypeDropdownOpen(false);
                                        }}
                                        className={`w-full text-left px-4 py-3 text-xs font-bold rounded-xl transition-all flex items-center justify-between ${
                                            form.report_type === typeVal
                                            ? 'bg-primary text-white'
                                            : 'text-slate-700 hover:bg-slate-50'
                                        }`}
                                    >
                                        <span>{typeVal}</span>
                                        {form.report_type === typeVal && (
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
                        placeholder="What problem did you experience? Provide as much detail as possible..."
                        value={form.description}
                        onChange={e => setForm({ ...form, description: e.target.value })}
                        className="w-full min-h-[120px] rounded-2xl bg-[var(--color-surface-low)] p-5 text-sm font-bold text-[var(--color-on-surface)] border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none"
                    />
                    <p className="text-[9px] text-gray-400 ml-1 uppercase font-bold tracking-widest">
                        {form.description.length < 20 ? `${20 - form.description.length} characters more required` : 'Description looking good'}
                    </p>
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
                            <Loader2 size={20} className="animate-spin" /> Submitting Report...
                        </span>
                    ) : (
                        "Submit Order Report"
                    )}
                </button>
            </form>
        </div>
    )
}

// Helper X icon
const X = ({ size }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
)

export default OrderReportPage
