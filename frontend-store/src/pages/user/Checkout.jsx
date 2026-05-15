import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { 
    CheckCircle2, Navigation, MapPin, Plus, Trash2, ChevronRight, 
    ShieldCheck, Truck, ShoppingBag, Info, BadgePercent, Lock, 
    Zap, CreditCard, Wallet, AlertTriangle, ArrowRight 
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import AddressPicker from '../../components/AddressPicker'
import { toast } from 'react-hot-toast'

function Checkout() {
    const navigate = useNavigate();
    const cart = useStore(state => state.cart);
    const user = useStore(state => state.user);
    const clearCart = useStore(state => state.clearCart);
    const removeFromCart = useStore(state => state.removeFromCart);

    const [formData, setFormData] = useState({
        name: user?.name || '',
        email: user?.email || '',
        phone: '',
        address: '',
        landmark: '',
        pincode: ''
    });

    const [coords, setCoords] = useState({ latitude: 28.6139, longitude: 77.2090 });
    const [orderPlaced, setOrderPlaced] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState('PREPAID'); // Default to Prepaid as recommended
    const [isProcessing, setIsProcessing] = useState(false);
    const [savedAddresses, setSavedAddresses] = useState([]);
    const [selectedAddressId, setSelectedAddressId] = useState(null);
    const [showPicker, setShowPicker] = useState(false);
    const [availability, setAvailability] = useState(null);
    const [pincode, setPincode] = useState('');
    const [serviceability, setServiceability] = useState(null);
    const [checkingPincode, setCheckingPincode] = useState(false);
    const deliveryMode = useStore(state => state.deliveryMode);
    const nearestStoreId = useStore(state => state.nearestStoreId);
    const syncCartWithInventory = useStore(state => state.syncCartWithInventory);

    useEffect(() => {
        // Refresh inventory data on mount
        syncCartWithInventory();

        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    setCoords({
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude
                    });
                },
                (error) => {
                    console.warn("Geolocation permission denied, using default Delhi coordinates.");
                }
            );
        }

        const fetchAddresses = async () => {
            const token = localStorage.getItem('token');
            if (!token) return;
            try {
                const res = await fetch(`${API_BASE_URL}/address/user`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setSavedAddresses(data);
                    const defaultAddr = data.find(a => a.is_default);
                    if (defaultAddr) {
                        setSelectedAddressId(defaultAddr.id);
                        setFormData(prev => ({ ...prev, address: defaultAddr.address_text }));
                        setCoords({ latitude: defaultAddr.latitude, longitude: defaultAddr.longitude });
                    }
                }
            } catch (err) {
                console.error("Failed to fetch addresses");
            }
        };
        fetchAddresses();

        // Fetch availability for delivery time context
        fetch(`${API_BASE_URL}/warehouse/availability`)
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    setAvailability(data.data);
                }
            })
            .catch(e => console.error('Failed to load availability:', e));
    }, []);

    const checkPincode = () => {
        if (!pincode || pincode.length !== 6) return;
        setCheckingPincode(true);
        setTimeout(() => {
            setServiceability({
                status: 'serviceable',
                edd: new Date(Date.now() + (deliveryMode === 'quick' ? 30 * 60000 : 3 * 24 * 60 * 60 * 1000)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
                courier: deliveryMode === 'quick' ? 'JDLX Hyperlocal' : 'Shiprocket Express'
            });
            setCheckingPincode(false);
        }, 800);
    };

    const subtotal = cart.reduce((sum, item) => {
        const price = Number(item.price || 0);
        const qty = Number(item.qty || 1);
        return sum + (price * qty);
    }, 0);
    const fittingTotal = cart.reduce((sum, item) => {
        if (item.fitting) {
            const charge = item.sub_category?.toLowerCase().includes('uv glass') ? 80 : 40;
            const qty = Number(item.qty || 1);
            return sum + (charge * qty);
        }
        return sum;
    }, 0);
    
    const hasOutOfStockItems = cart.some(item => (item.stock ?? 0) <= 0);
    
    // Dynamic Settings
    const freeThreshold = Number(availability?.free_delivery_threshold || 499);
    const isFreeDeliveryEnabled = availability?.free_delivery_enabled !== false; // Default true
    const platformFee = Number(availability?.platform_fee || 7);
    const prepaidFee = Number(availability?.prepaid_delivery_charge || 49);
    const codFee = Number(availability?.cod_delivery_charge || 99);
    const codAdvance = Number(availability?.cod_advance_amount || 49);
    const minOrderCod = Number(availability?.min_order_cod || 0);
    const codEnabled = availability?.cod_enabled !== false;
    const showPrepaidRecommendation = availability?.prepaid_recommendation_enabled !== false;
    const showPriorityBadge = availability?.priority_dispatch_enabled !== false;
    const codAlertText = availability?.cod_alert_text || 'Save more with prepaid orders! FREE delivery on orders above ₹499.';

    // Delivery Charge Calculation
    const deliveryCharge = (isFreeDeliveryEnabled && subtotal >= freeThreshold)
        ? 0
        : (paymentMethod === 'PREPAID' ? prepaidFee : codFee);

    const finalTotal = subtotal + platformFee + deliveryCharge + fittingTotal;
    const payNowAmount = paymentMethod === 'COD' ? codAdvance : finalTotal;
    const remainingCodAmount = paymentMethod === 'COD' ? (finalTotal - codAdvance) : 0;
    const isCodDisabledByAmount = subtotal < minOrderCod;

    // Free delivery progress
    const progressPercent = Math.min((subtotal / freeThreshold) * 100, 100);
    const amountToFree = freeThreshold - subtotal;

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handlePlaceOrder = async (e) => {
        e.preventDefault();

        if (!user) {
            toast.error("Please login via Google before placing an order!");
            navigate('/login');
            return;
        }

        if (hasOutOfStockItems) {
            toast.error("One or more cart items are out of stock. Remove them before checkout.");
            return;
        }

        if (!formData.phone || formData.phone.length !== 10) {
            toast.error("Please enter a valid 10-digit phone number");
            return;
        }

        const token = useStore.getState().token;
        setIsProcessing(true);

        try {
            const orderPayload = {
                items: cart.map(item => ({ 
                    id: item.id, 
                    qty: item.qty, 
                    price: item.price, 
                    device_model: item.device_model || null,
                    fitting_charge: item.fitting ? (item.sub_category?.toLowerCase().includes('uv glass') ? 80 : 40) : 0
                })),
                address: `${formData.address}${formData.landmark ? `, ${formData.landmark}` : ''}${formData.pincode ? `, ${formData.pincode}` : ''}`,
                pincode: formData.pincode,
                address_id: selectedAddressId,
                phone: formData.phone,
                total_amount: subtotal,
                fitting_charge: fittingTotal,
                latitude: coords.latitude,
                longitude: coords.longitude,
                email: formData.email,
                delivery_type: useStore.getState().deliveryMode,
                customer_name: formData.name,
                payment_type: paymentMethod // Pass payment_type
            };

            const orderRes = await fetch(`${API_BASE_URL}/checkout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(orderPayload)
            });

            const orderData = await orderRes.json();
            if (!orderRes.ok) throw new Error(orderData.error || "Order creation failed");

            const orderId = orderData.order_id;

            // Handle Payment Flow
            const paymentRes = await fetch(`${API_BASE_URL}/payment/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ order_id: orderId, payment_method: 'RAZORPAY' })
            });
            const paymentData = await paymentRes.json();
            if (!paymentRes.ok) throw new Error(paymentData.error || "Payment initialization failed");

            // Verify simulated success
            const verifyRes = await fetch(`${API_BASE_URL}/payment/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    order_id: orderId,
                    razorpay_order_id: paymentData.id,
                    razorpay_payment_id: "pay_simulated_success",
                    razorpay_signature: "simulated_signature",
                    payment_method: 'RAZORPAY'
                })
            });
            if (!verifyRes.ok) throw new Error("Payment verification failed");

            setOrderPlaced(true);
            setTimeout(() => {
                clearCart();
                navigate(`/track/${orderId}`);
            }, 3000);
        } catch (error) {
            console.error('Checkout Error:', error);
            toast.error(error.message);
        } finally {
            setIsProcessing(false);
        }
    };

    if (cart.length === 0 && !orderPlaced) {
        navigate('/');
        return null;
    }

    if (orderPlaced) {
        return (
            <div className="container-standard flex flex-col items-center justify-center min-h-[70vh] gap-6 animate-in fade-in zoom-in duration-700">
                <div className="relative">
                    <div className="absolute inset-0 bg-emerald-500/20 blur-3xl rounded-full animate-pulse" />
                    <CheckCircle2 className="w-28 h-28 text-emerald-500 relative z-10 drop-shadow-[0_0_20px_rgba(16,185,129,0.4)]" />
                </div>
                <div className="text-center space-y-2">
                    <h2 className="text-3xl font-black tracking-tighter text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>Order Confirmed!</h2>
                    <p className="text-[var(--color-on-surface-variant)] text-center px-6 max-w-md font-medium leading-relaxed">
                        A dedicated JDLX logistics partner is being assigned. Confirmation sent to <span className="font-bold text-primary">{formData.email}</span>.
                    </p>
                </div>
                <div className="mt-4 flex flex-col gap-3 w-full max-w-xs px-4">
                     <button onClick={() => navigate('/')} className="btn-primary w-full">Back to Shop</button>
                </div>
            </div>
        )
    }

    return (
        <div className="container-standard py-6 space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <h1 className="text-3xl font-black tracking-tighter text-[var(--color-on-surface)] px-2" style={{ fontFamily: 'Manrope, sans-serif' }}>Secure Checkout</h1>

            {!user && (
                <div className="glass-card border-none bg-amber-500/10 text-amber-500 p-5 flex flex-col items-center gap-3 text-center">
                    <p className="font-bold text-sm">You must be logged in to place an order.</p>
                    <button onClick={() => navigate('/login')} className="btn-primary w-full sm:w-auto px-10">Login with Google</button>
                </div>
            )}

            <form onSubmit={handlePlaceOrder} className="flex flex-col lg:grid lg:grid-cols-12 gap-8 items-start">
                
                {/* Left Column: Address & Logistics */}
                <div className="lg:col-span-7 w-full space-y-6">
                    
                    {/* Free Delivery Progress Bar */}
                    {isFreeDeliveryEnabled && (
                        <div className="glass-card p-6 border-none shadow-xl bg-gradient-to-br from-primary/5 to-transparent">
                            <div className="flex items-center justify-between mb-4">
                                <p className="text-sm font-black text-[var(--color-on-surface)] flex items-center gap-2">
                                    <Truck size={18} className="text-primary" />
                                    {subtotal >= freeThreshold ? (
                                        <span className="text-emerald-500">You unlocked FREE delivery! 🚚</span>
                                    ) : (
                                        <span>Add ₹{amountToFree.toLocaleString()} more for FREE delivery 🚚</span>
                                    )}
                                </p>
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{Math.round(progressPercent)}%</span>
                            </div>
                            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
                                <div 
                                    className={`h-full transition-all duration-1000 ease-out rounded-full ${subtotal >= freeThreshold ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'bg-primary'}`}
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                        </div>
                    )}

                    <div className="glass-card p-6 shadow-xl space-y-6">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-black text-[var(--color-on-surface)] flex items-center gap-2.5" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                <MapPin className="w-5 h-5 text-primary" /> Delivery Address
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowPicker(true)}
                                className="text-[11px] font-black text-primary uppercase tracking-widest flex items-center gap-1.5 hover:opacity-70 transition-opacity bg-primary/5 px-3 py-1.5 rounded-full"
                            >
                                <Plus size={14} /> Add New
                            </button>
                        </div>

                        {savedAddresses.length > 0 ? (
                            <div className="flex flex-col gap-3">
                                {savedAddresses.map(addr => (
                                    <div
                                        key={addr.id}
                                        onClick={() => {
                                            setSelectedAddressId(addr.id);
                                            setFormData(prev => ({ ...prev, address: addr.address_text }));
                                            setCoords({ latitude: addr.latitude, longitude: addr.longitude });
                                        }}
                                        className={`p-4 rounded-[20px] border-2 transition-all cursor-pointer flex items-center justify-between gap-4 ${selectedAddressId === addr.id ? 'border-primary bg-primary/[0.03] shadow-lg shadow-primary/5' : 'border-slate-100 bg-slate-50/50 hover:bg-white'}`}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`p-2.5 rounded-xl ${selectedAddressId === addr.id ? 'bg-primary text-white' : 'bg-slate-200 text-slate-500'}`}>
                                                <MapPin size={16} />
                                            </div>
                                            <div className="flex flex-col">
                                                <p className="text-[14px] font-black tracking-tight text-[var(--color-on-surface)] truncate max-w-[200px] sm:max-w-md">{addr.address_text}</p>
                                                <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest">Verified Location</p>
                                            </div>
                                        </div>
                                        {selectedAddressId === addr.id && <CheckCircle2 size={20} className="text-primary" />}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-8 text-center bg-slate-50 rounded-2xl border-2 border-dashed border-slate-100">
                                <p className="text-sm text-slate-400 font-medium">No saved addresses yet.</p>
                            </div>
                        )}

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-1">Active Contact Number</label>
                                <input
                                    type="tel"
                                    name="phone"
                                    value={formData.phone}
                                    onChange={handleChange}
                                    required
                                    pattern="[0-9]{10}"
                                    className="bg-white border-2 border-slate-100 rounded-[18px] px-5 py-4 shadow-sm focus:outline-none focus:border-primary w-full text-slate-900 text-[15px] font-black tracking-tight transition-all"
                                    placeholder="10-digit Mobile Number"
                                />
                            </div>

                            {!selectedAddressId && (
                                <div className="space-y-2 animate-in slide-in-from-top-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-1">Manual Address Entry</label>
                                    <textarea
                                        name="address"
                                        value={formData.address}
                                        onChange={handleChange}
                                        required
                                        rows="2"
                                        className="bg-white border-2 border-slate-100 rounded-[18px] px-5 py-4 shadow-sm focus:outline-none focus:border-primary w-full text-slate-900 text-[15px] font-black tracking-tight transition-all"
                                        placeholder="Flat NO, Building, Street, Landmark"
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Payment Selection */}
                    <div className="glass-card p-6 shadow-xl space-y-6">
                        <h3 className="text-lg font-black text-[var(--color-on-surface)] flex items-center gap-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
                            <Wallet className="w-5 h-5 text-primary" /> Payment Method
                        </h3>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* Prepaid Card */}
                            <div 
                                onClick={() => setPaymentMethod('PREPAID')}
                                className={`relative p-5 rounded-[24px] border-2 transition-all cursor-pointer overflow-hidden group ${paymentMethod === 'PREPAID' ? 'border-primary bg-primary/[0.03] shadow-lg ring-4 ring-primary/5' : 'border-slate-100 bg-white hover:border-primary/30'}`}
                            >
                                {paymentMethod === 'PREPAID' && showPrepaidRecommendation && (
                                    <div className="absolute top-0 right-0 bg-primary text-white text-[9px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-widest animate-in slide-in-from-right">Recommended</div>
                                )}
                                <div className="flex flex-col gap-3">
                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${paymentMethod === 'PREPAID' ? 'bg-primary text-white shadow-lg' : 'bg-slate-100 text-slate-500'}`}>
                                        <CreditCard size={24} />
                                    </div>
                                    <div>
                                        <p className="font-black text-[16px] text-[var(--color-on-surface)]">Prepaid</p>
                                        <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-tight flex items-center gap-1 mt-1">
                                            {showPriorityBadge && <Zap size={10} className="fill-emerald-500" />} Lower Fees • Priority Dispatch
                                        </p>
                                    </div>
                                </div>
                                <div className={`absolute bottom-4 right-4 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${paymentMethod === 'PREPAID' ? 'border-primary bg-primary scale-110' : 'border-slate-200'}`}>
                                    {paymentMethod === 'PREPAID' && <CheckCircle2 size={14} className="text-white" />}
                                </div>
                            </div>

                            {/* COD Card */}
                            {codEnabled && (
                                <div 
                                    onClick={() => !isCodDisabledByAmount && setPaymentMethod('COD')}
                                    className={`relative p-5 rounded-[24px] border-2 transition-all cursor-pointer group ${isCodDisabledByAmount ? 'opacity-50 grayscale cursor-not-allowed' : ''} ${paymentMethod === 'COD' ? 'border-amber-500 bg-amber-500/[0.03] shadow-lg ring-4 ring-amber-500/5' : 'border-slate-100 bg-white hover:border-amber-500/30'}`}
                                >
                                    <div className="flex flex-col gap-3">
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${paymentMethod === 'COD' ? 'bg-amber-500 text-white shadow-lg' : 'bg-slate-100 text-slate-500'}`}>
                                            <Truck size={24} />
                                        </div>
                                        <div>
                                            <p className="font-black text-[16px] text-[var(--color-on-surface)]">Cash on Delivery</p>
                                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight mt-1">
                                                {isCodDisabledByAmount ? `Min. ₹${minOrderCod} required` : `₹${codAdvance} Advance Confirmation`}
                                            </p>
                                        </div>
                                    </div>
                                    <div className={`absolute bottom-4 right-4 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${paymentMethod === 'COD' ? 'border-amber-500 bg-amber-500 scale-110' : 'border-slate-200'}`}>
                                        {paymentMethod === 'COD' && <CheckCircle2 size={14} className="text-white" />}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Prepaid Benefits Message */}
                        {paymentMethod === 'PREPAID' && (
                            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100 flex gap-3 animate-in slide-in-from-top-4 duration-500">
                                <Zap className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                                <div className="space-y-1">
                                    <p className="text-[13px] font-black text-emerald-800">{showPriorityBadge ? 'Priority Dispatch Active' : 'Prepaid Benefits Active'}</p>
                                    <p className="text-[11px] font-medium text-emerald-600 leading-relaxed">
                                        Prepaid orders are processed 2x faster and qualify for {isFreeDeliveryEnabled && subtotal >= freeThreshold ? <span className="font-bold">FREE Delivery</span> : `₹${prepaidFee} lower delivery charge`}.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* COD Alert Card */}
                        {paymentMethod === 'COD' && (
                            <div className="p-5 rounded-3xl bg-amber-50 border-2 border-amber-100 space-y-4 animate-in slide-in-from-top-4 duration-500">
                                <div className="flex items-center gap-3">
                                    <AlertTriangle className="w-6 h-6 text-amber-500" />
                                    <p className="text-sm font-black text-amber-900">{codAlertText}</p>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Choose Prepaid for:</p>
                                        <ul className="space-y-1.5">
                                            {[isFreeDeliveryEnabled ? `FREE delivery above ₹${freeThreshold}` : 'Faster processing', 'Lower delivery fees', 'Priority dispatch'].map((item, i) => (
                                                <li key={i} className="flex items-center gap-1.5 text-[11px] font-black text-slate-700">
                                                    <CheckCircle2 size={12} className="text-emerald-500" /> {item}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">COD Orders include:</p>
                                        <ul className="space-y-1.5">
                                            {['₹99 delivery fee', '₹49 advance payment'].map((item, i) => (
                                                <li key={i} className="flex items-center gap-1.5 text-[11px] font-black text-slate-700">
                                                    <Info size={12} className="text-amber-500" /> {item}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                                <div className="pt-2 border-t border-amber-200/50">
                                    <p className="text-[11px] font-black text-amber-800 text-center">
                                        ₹49 advance payment is required to confirm Cash on Delivery orders.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column: Order Summary */}
                <div className="lg:col-span-5 w-full sticky top-24">
                    <div className="glass-card p-6 shadow-2xl border-none space-y-6">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                            <h3 className="text-lg font-black text-[var(--color-on-surface)] flex items-center gap-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                <ShoppingBag className="w-5 h-5 text-primary" /> Order Summary
                            </h3>
                            <span className="text-[11px] font-black bg-slate-100 px-3 py-1 rounded-full uppercase tracking-widest text-slate-500">{cart.length} Items</span>
                        </div>

                        {/* Cart Items List */}
                        <div className="max-h-40 overflow-y-auto no-scrollbar space-y-4">
                            {cart.map(item => (
                                <div key={item.id} className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-slate-50 rounded-xl flex-shrink-0 border border-slate-100 p-1">
                                            <img src={item.image_url || 'https://placehold.co/100'} alt="" className="w-full h-full object-contain" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[13px] font-black text-slate-900 truncate max-w-[120px] sm:max-w-[200px]">{item.name}</p>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{Number(item.qty || 1)} x ₹{Number(item.price || 0)}</p>
                                        </div>
                                    </div>
                                    <div className="text-[13px] font-black text-slate-900">₹{(Number(item.price || 0) * Number(item.qty || 1)).toLocaleString()}</div>
                                </div>
                            ))}
                        </div>

                        {/* Detailed Bill */}
                        <div className="space-y-4 pt-4 border-t border-slate-100">
                            <div className="flex justify-between text-sm font-bold text-slate-500">
                                <span>Subtotal</span>
                                <span>₹{subtotal.toLocaleString()}</span>
                            </div>
                            
                            {fittingTotal > 0 && (
                                <div className="flex justify-between text-sm font-bold text-primary">
                                    <span>Fitting Service Total</span>
                                    <span>₹{fittingTotal.toLocaleString()}</span>
                                </div>
                            )}

                            <div className="flex justify-between text-sm font-bold text-slate-500">
                                <span>Delivery Charge</span>
                                {deliveryCharge === 0 ? (
                                    <span className="text-emerald-500 uppercase tracking-widest text-xs font-black">Free</span>
                                ) : (
                                    <span className="text-slate-900">₹{deliveryCharge}</span>
                                )}
                            </div>

                            <div className="flex justify-between text-sm font-bold text-slate-500">
                                <span>Platform Fee</span>
                                <span>₹{platformFee}</span>
                            </div>

                            {/* Final Total */}
                            <div className="flex justify-between items-center pt-4 border-t-2 border-dashed border-slate-100">
                                <span className="text-lg font-black text-slate-900" style={{ fontFamily: 'Manrope, sans-serif' }}>Final Total</span>
                                <span className="text-2xl font-black text-primary tracking-tighter" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                    ₹{finalTotal.toLocaleString()}
                                </span>
                            </div>

                            {/* COD Breakdown */}
                            {paymentMethod === 'COD' && (
                                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 animate-in fade-in zoom-in">
                                    <div className="flex justify-between text-[13px] font-black text-slate-900">
                                        <span className="flex items-center gap-1.5"><Zap size={14} className="text-primary" /> Pay Now (Advance)</span>
                                        <span className="text-primary font-black">₹{payNowAmount.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between text-[12px] font-bold text-slate-500">
                                        <span>Remaining Amount (at Delivery)</span>
                                        <span>₹{remainingCodAmount.toLocaleString()}</span>
                                    </div>
                                </div>
                            )}

                            <div className="pt-2">
                                <button
                                    type="submit"
                                    disabled={!user || isProcessing}
                                    className={`w-full py-5 rounded-[24px] shadow-2xl flex items-center justify-center gap-3 font-black tracking-tighter transition-all ${isProcessing ? 'bg-slate-100 text-slate-400' : 'bg-primary text-white hover:scale-[1.02] active:scale-[0.98]'}`}
                                    style={{ fontFamily: 'Manrope, sans-serif' }}
                                >
                                    {isProcessing ? (
                                        <>
                                            <div className="w-5 h-5 border-[3px] border-slate-300 border-t-primary rounded-full animate-spin"></div>
                                            <span>Processing...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="text-xl">Authorize {paymentMethod === 'COD' ? 'Advance' : 'Payment'}</span>
                                            <ArrowRight size={24} className="opacity-50" />
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Security Trust Signal */}
                        <div className="flex flex-col items-center gap-3 text-center">
                            <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">
                                <ShieldCheck size={14} className="text-emerald-500" />
                                256-BIT SSL SECURE CHECKOUT
                            </div>
                            <div className="flex items-center gap-4 opacity-30 grayscale filter">
                                <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/PayPal.svg/1200px-PayPal.svg.png" alt="Paypal" className="h-3" />
                                <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Visa_Inc._logo.svg/2560px-Visa_Inc._logo.svg.png" alt="Visa" className="h-2" />
                                <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Mastercard-logo.svg/1280px-Mastercard-logo.svg.png" alt="Mastercard" className="h-4" />
                            </div>
                        </div>
                    </div>
                </div>
            </form>

            {showPicker && (
                <AddressPicker
                    onClose={() => setShowPicker(false)}
                    onSelect={(addr) => {
                        setFormData(prev => ({ ...prev, address: addr.address }));
                        setCoords({ latitude: addr.latitude, longitude: addr.longitude });
                        const token = localStorage.getItem('token');
                        fetch(`${API_BASE_URL}/address/user`, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        })
                            .then(res => res.json())
                            .then(data => {
                                setSavedAddresses(data);
                                if (data.length > 0) {
                                    const latest = data[0];
                                    setSelectedAddressId(latest.id);
                                }
                            });
                    }}
                />
            )}
        </div>
    )
}

export default Checkout
