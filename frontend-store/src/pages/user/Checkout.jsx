import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { 
    CheckCircle2, Navigation, MapPin, Plus, Trash2, ChevronRight, 
    ShieldCheck, Truck, ShoppingBag, Info, BadgePercent, Lock, 
    Zap, CreditCard, Wallet, AlertTriangle, ArrowRight 
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { loadRazorpay } from '../../utils/loadRazorpay'
import { trackBeginCheckout, trackPurchase } from '../../utils/analytics'
import { useAnalyticsContext } from '../../context/AnalyticsContext'
import AddressPicker from '../../components/AddressPicker'
import WalletCheckout from '../../components/WalletCheckout'
import { toast } from 'react-hot-toast'

function Checkout() {
    const navigate = useNavigate();
    const cart = useStore(state => state.cart);
    const user = useStore(state => state.user);
    const clearCart = useStore(state => state.clearCart);
    const { trackEvent } = useAnalyticsContext();

    const [formData, setFormData] = useState({
        name: user?.name || '',
        email: user?.email || '',
        phone: '',
        address: '', // Stores final selected address string
        flatNo: '',
        area: '',
        landmark: '',
        pincode: '',
        city: '',
        state: ''
    });

    const [coords, setCoords] = useState({ latitude: 28.6139, longitude: 77.2090 });
    const [orderPlaced] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState('PREPAID'); // Default to Prepaid as recommended
    const [isProcessing, setIsProcessing] = useState(false);
    const [savedAddresses, setSavedAddresses] = useState([]);
    const [selectedAddressId, setSelectedAddressId] = useState(null);
    const [showPicker, setShowPicker] = useState(false);
    const [availability, setAvailability] = useState(null);
    const [pincodeStatus, setPincodeStatus] = useState('idle'); // 'idle', 'checking', 'serviceable', 'unserviceable', 'invalid'
    const [pincodeMessage, setPincodeMessage] = useState('');
    const syncCartWithInventory = useStore(state => state.syncCartWithInventory);

    // Derived values
    const subtotal = useMemo(() => cart.reduce((sum, item) => {
        const price = Number(item.price || 0);
        const qty = Number(item.qty || 1);
        return sum + (price * qty);
    }, 0), [cart]);

    const productIds = useMemo(() => cart.map(item => item.id), [cart]);

    // Per-item prices so multi-vendor offers only discount their own products
    // (Store A's offer never discounts Store B's items).
    const cartItems = useMemo(() => cart.map(item => ({
        product_id: item.id,
        price: Number(item.price || 0),
        quantity: Number(item.qty || 1)
    })), [cart]);

    // Offers & Discounts
    const appliedOffer = useStore(state => state.appliedOffer);
    const applyAutomaticOffers = useStore(state => state.applyAutomaticOffers);
    const applyCoupon = useStore(state => state.applyCoupon);
    const removeOffer = useStore(state => state.removeOffer);
    const [couponCode, setCouponCode] = useState('');
    const [couponLoading, setCouponLoading] = useState(false);
    const [walletAmount, setWalletAmount] = useState(0);

    useEffect(() => {
        if (cart && cart.length > 0) {
            trackBeginCheckout(cart, subtotal);
        }
    }, [cart, subtotal]); // Include cart and subtotal for accuracy

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
                () => {
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
                    const addresses = Array.isArray(data) ? data : [];
                    setSavedAddresses(addresses);
                    const defaultAddr = addresses.find(a => a.is_default);
                    if (defaultAddr) {
                        setSelectedAddressId(defaultAddr.id);
                        const pinMatch = defaultAddr.address_text.match(/\b\d{6}\b/);
                        const extractedPin = pinMatch ? pinMatch[0] : '';
                        setFormData(prev => ({ 
                            ...prev, 
                            address: defaultAddr.address_text,
                            pincode: extractedPin
                        }));
                        setCoords({ latitude: defaultAddr.latitude, longitude: defaultAddr.longitude });
                    }
                }
            } catch {
                console.error("Failed to fetch addresses");
            }
        };
        fetchAddresses();

        // Fetch availability for delivery time context
        fetch(`${API_BASE_URL}/warehouse/availability`)
            .then(r => r.json())
            .then(data => {
                // Handle both flat response (from blueprint) and wrapped response (from success_response)
                const avail = data.data || data;
                if (avail && (avail.success !== false)) {
                    setAvailability(avail);
                }
            })
            .catch(e => console.error('Failed to load availability:', e));
    }, [syncCartWithInventory]);

    useEffect(() => {
        if (subtotal > 0 && user) {
            applyAutomaticOffers(subtotal, productIds, cartItems);
        } else {
            removeOffer();
        }
    }, [subtotal, user, productIds, cartItems, applyAutomaticOffers, removeOffer]);

    const handleApplyCoupon = async () => {
        if (!couponCode.trim()) return;
        setCouponLoading(true);
        const res = await applyCoupon(couponCode, subtotal, productIds, cartItems);
        if (res.valid) {
            toast.success(`Coupon applied: ₹${res.discount_amount} off`);
        } else {
            toast.error(res.message);
        }
        setCouponLoading(false);
        setCouponCode('');
    };

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
    // NOTE: `??` (not `||`) for these numeric fallbacks — admin can set any of
    // them to 0 (e.g. COD advance ₹0) and `0 || default` would wrongly fall back
    // to the default. `??` only falls back when the API omits the key entirely.
    const freeThreshold = Number(availability?.free_delivery_threshold ?? 499);
    const isFreeDeliveryEnabled = availability?.free_delivery_enabled !== false; // Default true
    const platformFee = Number(availability?.platform_fee ?? 7);
    const prepaidFee = Number(availability?.prepaid_delivery_charge ?? 49);
    const codFee = Number(availability?.cod_delivery_charge ?? 99);
    const codAdvance = Number(availability?.cod_advance_amount ?? 49);
    const minOrderCod = Number(availability?.min_order_cod ?? 0);
    const codEnabled = availability?.cod_enabled !== false;
    const showPrepaidRecommendation = availability?.prepaid_recommendation_enabled !== false;
    const showPriorityBadge = availability?.priority_dispatch_enabled !== false;
    const codAlertText = availability?.cod_alert_text || 'Save more with prepaid orders! FREE delivery on orders above ₹499.';

    // Quick delivery is retired system-wide: every order uses standard
    // Shiprocket fulfillment, so this is always true (previously derived from
    // the now-removed availability.quick_mode_enabled flag).
    const isShiprocket = true;
    const codEnabledShiprocket = availability ? availability.cod_enabled_shiprocket === true : false;

    // Delivery Charge Calculation
    // Free delivery applies to standard fulfillment.
    const deliveryCharge = (isFreeDeliveryEnabled && subtotal >= freeThreshold)
        ? 0
        : (paymentMethod === 'PREPAID' ? prepaidFee : codFee);

    const discountAmount = appliedOffer ? appliedOffer.discount_amount : 0;
    const finalTotal = Math.max(0, (subtotal - discountAmount) + platformFee + deliveryCharge + fittingTotal - walletAmount);
    const payNowAmount = paymentMethod === 'COD' ? codAdvance : finalTotal;
    const remainingCodAmount = paymentMethod === 'COD' ? (finalTotal - codAdvance) : 0;
    const isCodDisabledByAmount = subtotal < minOrderCod;

    // Free delivery progress
    const progressPercent = Math.min((subtotal / freeThreshold) * 100, 100);
    const amountToFree = freeThreshold - subtotal;

    const fetchCityStateFromPincode = async (pin, updateStateFn) => {
        setPincodeStatus('checking');
        setPincodeMessage('Checking pincode validity and serviceability...');
        try {
            const res = await fetch(`${API_BASE_URL}/pincode/check/${pin}`);
            if (res.ok) {
                const checkData = await res.json();
                const details = checkData.data || checkData;
                
                if (details.invalid) {
                    setPincodeStatus('invalid');
                    setPincodeMessage('❌ Invalid Pincode! Please enter a valid Indian pincode.');
                    toast.error("Invalid Pincode. Please enter a valid 6-digit Indian postal code.");
                    return;
                }
                
                if (details.city && details.state) {
                    updateStateFn(prev => ({
                        ...prev,
                        city: details.city,
                        state: details.state
                    }));
                }
                
                if (details.serviceable) {
                    setPincodeStatus('serviceable');
                    if (!details.cod_allowed) {
                        setPincodeMessage('⚠️ Only PREPAID delivery available for this location.');
                        setPaymentMethod('PREPAID'); // Auto force Prepaid
                        toast.success(`Pincode serviceable! Only Prepaid payments accepted here.`);
                    } else {
                        setPincodeMessage('✓ Serviceable by Shiprocket Express! COD & Prepaid available.');
                        if (details.city && details.state) {
                            toast.success(`Location detected: ${details.city}, ${details.state}`);
                        } else {
                            toast.success("Pincode verified successfully.");
                        }
                    }
                } else {
                    setPincodeStatus('unserviceable');
                    setPincodeMessage('⚠️ Courier service is not available for this location.');
                    toast.error("Shiprocket does not deliver to this pincode. Please enter a different one.");
                }
            } else {
                setPincodeStatus('invalid');
                setPincodeMessage('❌ Pincode check failed. Please check manually.');
            }
        } catch (err) {
            console.warn("Failed to auto-fetch pincode details:", err);
            setPincodeStatus('invalid');
            setPincodeMessage('❌ Connection error checking pincode.');
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        if (name === 'pincode') {
            const digits = value.replace(/\D/g, '').slice(0, 6);
            setFormData(prev => ({ ...prev, pincode: digits }));
            if (digits.length === 6) {
                fetchCityStateFromPincode(digits, setFormData);
            }
        } else {
            setFormData(prev => ({ ...prev, [name]: value }));
        }
    };

    const handlePayment = async (orderId) => {
        try {
            setIsProcessing(true);
            const token = localStorage.getItem('token');

            // Step 1: Create Razorpay order
            const res = await fetch(`${API_BASE_URL}/payment/create-order`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ order_id: orderId })
            });

            let data;
            try {
                data = await res.json();
            } catch {
                throw new Error('Server returned an invalid response. Please try again.');
            }

            if (!res.ok) throw new Error(data?.message || data?.error || 'Payment initiation failed');

            // Lazy-load the Razorpay SDK on the first payment attempt (it was
            // removed from index.html so it no longer blocks every page load).
            // The loader resolves only after the SDK is ready.
            await loadRazorpay();

            // Step 2: Open Razorpay checkout
            const paymentData = data.data || {};
            const options = {
                key: paymentData.key_id,
                amount: paymentData.amount,
                currency: paymentData.currency,
                name: 'JDLX Mobile',
                description: `Order #${orderId}`,
                order_id: paymentData.razorpay_order_id,
                prefill: {
                    name: user?.name || '',
                    email: user?.email || '',
                    contact: formData.phone || user?.phone || ''
                },
                theme: { color: '#6366f1' },
                handler: async (response) => {
                    try {
                        // Step 3: Verify payment
                        const verifyRes = await fetch(`${API_BASE_URL}/payment/verify`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify({
                                order_id: orderId,
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature: response.razorpay_signature
                            })
                        });
                        
                        if (verifyRes.ok) {
                            // GA4 Purchase Tracking
                            trackPurchase(orderId, finalTotal, cart);
                            trackEvent('purchase', 'order', String(orderId), finalTotal);

                            // Record offer usage if applied
                            if (appliedOffer) {
                                try {
                                    await fetch(`${API_BASE_URL}/offers/record-usage`, {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'Authorization': `Bearer ${token}`
                                        },
                                        body: JSON.stringify({
                                            offer_id: appliedOffer.offer_id,
                                            order_id: orderId,
                                            discount_applied: discountAmount
                                        })
                                    });
                                } catch (e) {
                                    console.error('Failed to record offer usage', e);
                                }
                            }

                            toast.success('Payment successful!');
                            clearCart();
                            navigate(`/order-success/${orderId}`);
                        } else {
                            let verifyData;
                            try { verifyData = await verifyRes.json(); } catch { verifyData = {}; }
                            toast.error(verifyData?.message || 'Payment verification failed');
                            setIsProcessing(false);
                        }
                    } catch (verifyErr) {
                        console.error('Payment verification error:', verifyErr);
                        toast.error('Payment verification encountered an error. Please check your orders.');
                        setIsProcessing(false);
                    }
                },
                modal: {
                    ondismiss: () => {
                        setIsProcessing(false);
                        toast.error('Payment cancelled');
                    }
                }
            };

            const rzp = new window.Razorpay(options);
            rzp.on('payment.failed', (response) => {
                toast.error(`Payment failed: ${response.error?.description || 'Unknown error'}`);
                setIsProcessing(false);
            });
            rzp.open();

        } catch (err) {
            console.error('Payment error:', err);
            toast.error(err.message || 'Something went wrong with payment');
            setIsProcessing(false);
        }
    };

    const handlePlaceOrder = async (e) => {
        if (isProcessing) return;
        setIsProcessing(true);
        e.preventDefault();

        if (!user) {
            toast.error("Please login via Google before placing an order!");
            setIsProcessing(false);
            navigate('/login');
            return;
        }

        if (hasOutOfStockItems) {
            toast.error("One or more cart items are out of stock. Remove them before checkout.");
            setIsProcessing(false);
            return;
        }

        if (!formData.phone || formData.phone.length !== 10) {
            toast.error("Please enter a valid 10-digit phone number");
            setIsProcessing(false);
            return;
        }

        if (!selectedAddressId) {
            if (!formData.flatNo.trim()) {
                toast.error("Please enter Flat/House No. or Building name");
                setIsProcessing(false);
                return;
            }
            if (!formData.area.trim()) {
                toast.error("Please enter Street, Sector, or Colony");
                setIsProcessing(false);
                return;
            }
            if (!formData.city.trim()) {
                toast.error("Please enter your City");
                setIsProcessing(false);
                return;
            }
            if (!formData.state.trim()) {
                toast.error("Please enter your State");
                setIsProcessing(false);
                return;
            }
            if (!formData.pincode || formData.pincode.length !== 6 || !/^\d{6}$/.test(formData.pincode)) {
                toast.error("Please enter a valid 6-digit Pincode");
                setIsProcessing(false);
                return;
            }
            if (pincodeStatus === 'unserviceable') {
                toast.error("Courier service is not available for this location.");
                setIsProcessing(false);
                return;
            }
            if (pincodeStatus === 'invalid') {
                toast.error("Invalid Pincode. Please enter a valid Indian pincode.");
                setIsProcessing(false);
                return;
            }
        }

        const token = useStore.getState().token;

        try {
            const manualAddressText = `${formData.flatNo}, ${formData.area}${formData.landmark ? `, Near ${formData.landmark}` : ''}, ${formData.city}, ${formData.state} - ${formData.pincode}`;
            
            const orderPayload = {
                items: cart.map(item => ({ 
                    id: item.id, 
                    qty: item.qty, 
                    price: item.price, 
                    device_model: item.device_model || null,
                    fitting_charge: item.fitting ? (item.sub_category?.toLowerCase().includes('uv glass') ? 80 : 40) : 0
                })),
                address: selectedAddressId ? formData.address : manualAddressText,
                pincode: formData.pincode,
                address_id: selectedAddressId,
                phone: formData.phone,
                total_amount: subtotal,
                fitting_charge: fittingTotal,
                latitude: coords.latitude,
                longitude: coords.longitude,
                email: formData.email,
                delivery_type: 'scheduled',
                customer_name: formData.name,
                payment_type: paymentMethod,
                offer_id: appliedOffer ? appliedOffer.offer_id : null,
                discount_applied: discountAmount,
                wallet_amount: walletAmount
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

            // No online payment is needed when the server's pay-now amount is ₹0:
            // COD orders with advance set to 0 (and PREPAID orders fully covered
            // by the wallet) are already confirmed by the backend. Skipping the
            // gateway here avoids the "Payment amount must be greater than zero"
            // failure from /payment/create-order.
            // Default to a positive value when the server omits the summary so a
            // missing field never skips payment for an order that still needs it.
            const serverPayNow = Number(orderData?.summary?.pay_now_amount ?? 1);
            if (serverPayNow <= 0) {
                clearCart();
                navigate(`/order-success/${orderId}`);
                return;
            }

            // Start Razorpay Payment Flow
            await handlePayment(orderId);

        } catch (error) {
            console.error('Checkout Error:', error);
            toast.error(error?.message || 'Order placement failed. Please try again.');
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
        <div className="container-standard py-6 pb-24 lg:pb-6 space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
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
                                <span className="text-[10px] font-black text-[var(--color-on-surface-variant)] uppercase tracking-widest">{Math.round(progressPercent)}%</span>
                            </div>
                            <div className="w-full h-3 bg-[var(--color-surface-container)] rounded-full overflow-hidden border border-[var(--color-surface-high)]/50">
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
                                            const pinMatch = addr.address_text.match(/\b\d{6}\b/);
                                            const extractedPin = pinMatch ? pinMatch[0] : '';
                                            setFormData(prev => ({ 
                                                ...prev, 
                                                address: addr.address_text,
                                                pincode: extractedPin
                                            }));
                                            setCoords({ latitude: addr.latitude, longitude: addr.longitude });
                                        }}
                                        className={`p-4 rounded-[20px] border-2 transition-all cursor-pointer flex items-center justify-between gap-4 ${selectedAddressId === addr.id ? 'border-primary bg-primary/[0.03] shadow-lg shadow-primary/5' : 'border-[var(--color-surface-high)] bg-[var(--color-surface-low)]/50 hover:bg-[var(--color-surface-low)]'}`}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`p-2.5 rounded-xl ${selectedAddressId === addr.id ? 'bg-primary text-white' : 'bg-[var(--color-surface-container)] text-[var(--color-on-surface-variant)]'}`}>
                                                <MapPin size={16} />
                                            </div>
                                            <div className="flex flex-col">
                                                <p className="text-[14px] font-black tracking-tight text-[var(--color-on-surface)] truncate max-w-[200px] sm:max-w-md">{addr.address_text}</p>
                                                <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Verified Location</p>
                                            </div>
                                        </div>
                                        {selectedAddressId === addr.id && <CheckCircle2 size={20} className="text-primary" />}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-8 text-center bg-[var(--color-surface-low)] rounded-2xl border-2 border-dashed border-[var(--color-surface-high)]">
                                <p className="text-sm text-[var(--color-on-surface-variant)] font-medium">No saved addresses yet.</p>
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
                                    className="bg-[var(--color-surface-card)] border-2 border-[var(--color-surface-high)] rounded-[18px] px-5 py-4 shadow-sm focus:outline-none focus:border-primary w-full text-[var(--color-on-surface)] text-[15px] font-black tracking-tight transition-all"
                                    placeholder="10-digit Mobile Number"
                                />
                            </div>

                            {!selectedAddressId && (
                                <div className="space-y-4 animate-in slide-in-from-top-2 border-t border-slate-100 pt-4">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-1">Manual Address Entry</label>
                                    
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Flat / House No. *</label>
                                            <input
                                                type="text"
                                                name="flatNo"
                                                value={formData.flatNo}
                                                onChange={handleChange}
                                                required
                                                className="bg-[var(--color-surface-card)] border-2 border-[var(--color-surface-high)] rounded-[18px] px-4 py-3.5 shadow-sm focus:outline-none focus:border-primary w-full text-[var(--color-on-surface)] text-[14px] font-black tracking-tight transition-all"
                                                placeholder="e.g. 202, 2nd Floor"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Street / Colony *</label>
                                            <input
                                                type="text"
                                                name="area"
                                                value={formData.area}
                                                onChange={handleChange}
                                                required
                                                className="bg-[var(--color-surface-card)] border-2 border-[var(--color-surface-high)] rounded-[18px] px-4 py-3.5 shadow-sm focus:outline-none focus:border-primary w-full text-[var(--color-on-surface)] text-[14px] font-black tracking-tight transition-all"
                                                placeholder="e.g. Rohini Sec 15"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Landmark</label>
                                            <input
                                                type="text"
                                                name="landmark"
                                                value={formData.landmark}
                                                onChange={handleChange}
                                                className="bg-[var(--color-surface-card)] border-2 border-[var(--color-surface-high)] rounded-[18px] px-4 py-3.5 shadow-sm focus:outline-none focus:border-primary w-full text-[var(--color-on-surface)] text-[14px] font-black tracking-tight transition-all"
                                                placeholder="e.g. Near Metro Station"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Pincode *</label>
                                            <input
                                                type="tel"
                                                name="pincode"
                                                value={formData.pincode}
                                                onChange={handleChange}
                                                required
                                                maxLength="6"
                                                className="bg-[var(--color-surface-card)] border-2 border-[var(--color-surface-high)] rounded-[18px] px-4 py-3.5 shadow-sm focus:outline-none focus:border-primary w-full text-[var(--color-on-surface)] text-[14px] font-black tracking-tight transition-all"
                                                placeholder="6-digit Pincode"
                                            />
                                            {pincodeMessage && (
                                                <p className={`text-[10px] font-bold px-1 mt-1 transition-all duration-300 ${
                                                    pincodeStatus === 'serviceable' ? 'text-emerald-600' :
                                                    pincodeStatus === 'checking' ? 'text-blue-500' : 'text-red-500 animate-pulse'
                                                }`}>
                                                    {pincodeMessage}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">City *</label>
                                            <input
                                                type="text"
                                                name="city"
                                                value={formData.city}
                                                onChange={handleChange}
                                                required
                                                className="bg-[var(--color-surface-card)] border-2 border-[var(--color-surface-high)] rounded-[18px] px-4 py-3.5 shadow-sm focus:outline-none focus:border-primary w-full text-[var(--color-on-surface)] text-[14px] font-black tracking-tight transition-all"
                                                placeholder="City"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">State *</label>
                                            <input
                                                type="text"
                                                name="state"
                                                value={formData.state}
                                                onChange={handleChange}
                                                required
                                                className="bg-[var(--color-surface-card)] border-2 border-[var(--color-surface-high)] rounded-[18px] px-4 py-3.5 shadow-sm focus:outline-none focus:border-primary w-full text-[var(--color-on-surface)] text-[14px] font-black tracking-tight transition-all"
                                                placeholder="State"
                                            />
                                        </div>
                                    </div>
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
                                className={`relative p-5 rounded-[24px] border-2 transition-all cursor-pointer overflow-hidden group ${paymentMethod === 'PREPAID' ? 'border-primary bg-primary/[0.03] shadow-lg ring-4 ring-primary/5' : 'border-[var(--color-surface-high)] bg-[var(--color-surface-card)] hover:border-primary/30'}`}
                            >
                                {paymentMethod === 'PREPAID' && showPrepaidRecommendation && (
                                    <div className="absolute top-0 right-0 bg-primary text-white text-[10px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-widest animate-in slide-in-from-right">Recommended</div>
                                )}
                                <div className="flex flex-col gap-3">
                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${paymentMethod === 'PREPAID' ? 'bg-primary text-white shadow-lg' : 'bg-[var(--color-surface-container)] text-[var(--color-on-surface-variant)]'}`}>
                                        <CreditCard size={24} />
                                    </div>
                                    <div>
                                        <p className="font-black text-[16px] text-[var(--color-on-surface)]">Prepaid</p>
                                        <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-tight flex items-center gap-1 mt-1">
                                            {showPriorityBadge && <Zap size={10} className="fill-emerald-500" />} Lower Fees • Priority Dispatch
                                        </p>
                                    </div>
                                </div>
                                <div className={`absolute bottom-4 right-4 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${paymentMethod === 'PREPAID' ? 'border-primary bg-primary scale-110' : 'border-[var(--color-surface-high)]'}`}>
                                    {paymentMethod === 'PREPAID' && <CheckCircle2 size={14} className="text-white" />}
                                </div>
                            </div>

                            {/* COD Card */}
                            {codEnabled && (!isShiprocket || codEnabledShiprocket) && (
                                <div 
                                    onClick={() => !isCodDisabledByAmount && setPaymentMethod('COD')}
                                    className={`relative p-5 rounded-[24px] border-2 transition-all cursor-pointer group ${isCodDisabledByAmount ? 'opacity-50 grayscale cursor-not-allowed' : ''} ${paymentMethod === 'COD' ? 'border-amber-500 bg-amber-500/[0.03] shadow-lg ring-4 ring-amber-500/5' : 'border-[var(--color-surface-high)] bg-[var(--color-surface-card)] hover:border-amber-500/30'}`}
                                >
                                    <div className="flex flex-col gap-3">
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${paymentMethod === 'COD' ? 'bg-amber-500 text-white shadow-lg' : 'bg-[var(--color-surface-container)] text-[var(--color-on-surface-variant)]'}`}>
                                            <Truck size={24} />
                                        </div>
                                        <div>
                                            <p className="font-black text-[16px] text-[var(--color-on-surface)]">Cash on Delivery</p>
                                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight mt-1">
                                                {isCodDisabledByAmount
                                                    ? `Min. ₹${minOrderCod} required`
                                                    : codAdvance > 0
                                                        ? `₹${codAdvance} Advance Confirmation`
                                                        : 'No Advance Required'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className={`absolute bottom-4 right-4 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${paymentMethod === 'COD' ? 'border-amber-500 bg-amber-500 scale-110' : 'border-[var(--color-surface-high)]'}`}>
                                        {paymentMethod === 'COD' && <CheckCircle2 size={14} className="text-white" />}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Prepaid Benefits Message */}
                        {paymentMethod === 'PREPAID' && (
                            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex gap-3 animate-in slide-in-from-top-4 duration-500">
                                <Zap className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                                <div className="space-y-1">
                                    <p className="text-[13px] font-black text-emerald-500">{showPriorityBadge ? 'Priority Dispatch Active' : 'Prepaid Benefits Active'}</p>
                                    <p className="text-[11px] font-medium text-emerald-500 leading-relaxed">
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
                                        <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Choose Prepaid for:</p>
                                        <ul className="space-y-1.5">
                                            {[isFreeDeliveryEnabled ? `FREE delivery above ₹${freeThreshold}` : 'Faster processing', 'Lower delivery fees', 'Priority dispatch'].map((item, i) => (
                                                <li key={i} className="flex items-center gap-1.5 text-[11px] font-black text-[var(--color-on-surface-variant)]">
                                                    <CheckCircle2 size={12} className="text-emerald-500" /> {item}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">COD Orders include:</p>
                                        <ul className="space-y-1.5">
                                            {[`₹${codFee} delivery fee`, ...(codAdvance > 0 ? [`₹${codAdvance} advance payment`] : [])].map((item, i) => (
                                                <li key={i} className="flex items-center gap-1.5 text-[11px] font-black text-[var(--color-on-surface-variant)]">
                                                    <Info size={12} className="text-amber-500" /> {item}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                                <div className="pt-2 border-t border-amber-200/50">
                                    <p className="text-[11px] font-black text-amber-500 text-center">
                                        {codAdvance > 0
                                            ? `₹${codAdvance} advance payment is required to confirm Cash on Delivery orders.`
                                            : 'No advance required — pay the full amount when your order arrives.'}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column: Order Summary */}
                <div className="lg:col-span-5 w-full sticky top-24">
                    <div className="glass-card p-6 shadow-2xl border-none space-y-6">
                        <div className="flex items-center justify-between border-b border-[var(--color-surface-high)] pb-4">
                            <h3 className="text-lg font-black text-[var(--color-on-surface)] flex items-center gap-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                <ShoppingBag className="w-5 h-5 text-primary" /> Order Summary
                            </h3>
                            <span className="text-[11px] font-black bg-[var(--color-surface-container)] px-3 py-1 rounded-full uppercase tracking-widest text-[var(--color-on-surface-variant)]">{cart.length} Items</span>
                        </div>

                        {/* Cart Items List */}
                        <div className="max-h-40 overflow-y-auto no-scrollbar space-y-4">
                            {cart.map(item => (
                                <div key={item.id} className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-[var(--color-surface-low)] rounded-xl flex-shrink-0 border border-[var(--color-surface-high)] p-1">
                                            <img src={item.image_url || 'https://placehold.co/100'} alt="" loading="lazy" decoding="async" className="w-full h-full object-contain" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[13px] font-black text-[var(--color-on-surface)] truncate max-w-[120px] sm:max-w-[200px]">{item.name}</p>
                                            <p className="text-[10px] font-bold text-[var(--color-on-surface-variant)] uppercase tracking-tighter">{Number(item.qty || 1)} x ₹{Number(item.price || 0)}</p>
                                        </div>
                                    </div>
                                    <div className="text-[13px] font-black text-[var(--color-on-surface)]">₹{(Number(item.price || 0) * Number(item.qty || 1)).toLocaleString()}</div>
                                </div>
                            ))}
                        </div>

                        {/* Coupon Input */}
                        <div className="pt-4 border-t border-[var(--color-surface-high)]">
                            {appliedOffer && appliedOffer.code ? (
                                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <BadgePercent className="text-emerald-500 w-5 h-5" />
                                        <div>
                                            <p className="text-sm font-black text-emerald-500 tracking-tight">{appliedOffer.code}</p>
                                            <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest">{appliedOffer.title || 'Coupon Applied'}</p>
                                        </div>
                                    </div>
                                    <button 
                                        type="button"
                                        onClick={removeOffer}
                                        className="text-xs font-bold text-red-500 hover:text-red-700"
                                    >
                                        Remove
                                    </button>
                                </div>
                            ) : appliedOffer ? (
                                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center gap-3">
                                    <BadgePercent className="text-emerald-500 w-5 h-5" />
                                    <div>
                                        <p className="text-sm font-black text-emerald-800 tracking-tight">{appliedOffer.title}</p>
                                        <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest">Offer Auto-Applied</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-nowrap w-full overflow-hidden" style={{ gap: '8px' }}>
                                    <input 
                                        type="text" 
                                        value={couponCode}
                                        onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                                        placeholder="Enter Coupon Code" 
                                        className="bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-3 font-bold focus:outline-none focus:border-primary uppercase transition-colors"
                                        style={{ flex: '1 1 0%', minWidth: 0, width: 0 }}
                                    />
                                    <button 
                                        type="button"
                                        onClick={handleApplyCoupon}
                                        disabled={couponLoading || !couponCode.trim()}
                                        className="transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-bold"
                                        style={{ 
                                            flex: '0 0 auto', 
                                            whiteSpace: 'nowrap', 
                                            padding: '0 16px', 
                                            height: '48px', 
                                            borderRadius: '12px', 
                                            background: '#1B2341', 
                                            color: 'white', 
                                            fontSize: '14px' 
                                        }}
                                    >
                                        {couponLoading ? '...' : 'Apply'}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Wallet Section */}
                        <div className="pt-4 border-t border-slate-100">
                            <WalletCheckout 
                                totalAmount={subtotal - discountAmount + platformFee + deliveryCharge + fittingTotal} 
                                onApply={(amt) => setWalletAmount(amt)} 
                            />
                        </div>

                        {/* Detailed Bill */}
                        <div className="space-y-4 pt-4 border-t border-slate-100">
                            <div className="flex justify-between text-sm font-bold text-slate-500">
                                <span>Subtotal</span>
                                <span>₹{subtotal.toLocaleString()}</span>
                            </div>
                            
                            {discountAmount > 0 && (
                                <div className="flex justify-between text-sm font-bold text-emerald-500">
                                    <span>Discount ({appliedOffer?.code || 'Offer'})</span>
                                    <span>-₹{discountAmount.toLocaleString()}</span>
                                </div>
                            )}

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
                                    <span className="text-[var(--color-on-surface)]">₹{deliveryCharge}</span>
                                )}
                            </div>

                            <div className="flex justify-between text-sm font-bold text-slate-500">
                                <span>Platform Fee</span>
                                <span>₹{platformFee}</span>
                            </div>

                            {walletAmount > 0 && (
                                <div className="flex justify-between text-sm font-black text-[#D48A12] bg-orange-50 px-2.5 py-2 rounded-xl border border-orange-100 animate-in fade-in slide-in-from-right-4">
                                    <span className="flex items-center gap-1.5"><Wallet size={14} /> Wallet Deduction</span>
                                    <span>-₹{walletAmount.toFixed(0)}</span>
                                </div>
                            )}

                            {/* Final Total */}
                            <div className="flex justify-between items-center pt-4 border-t-2 border-dashed border-slate-100">
                                <span className="text-lg font-black text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>Final Total</span>
                                <span className="text-2xl font-black text-primary tracking-tighter" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                    ₹{finalTotal.toLocaleString()}
                                </span>
                            </div>

                            {/* COD Breakdown / Shiprocket Info */}
                            {paymentMethod === 'COD' ? (
                                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 animate-in fade-in zoom-in">
                                    {codAdvance > 0 ? (
                                        <>
                                            <div className="flex justify-between text-[13px] font-black text-[var(--color-on-surface)]">
                                                <span className="flex items-center gap-1.5"><Zap size={14} className="text-primary" /> Pay Now (Advance)</span>
                                                <span className="text-primary font-black">₹{payNowAmount.toLocaleString()}</span>
                                            </div>
                                            <div className="flex justify-between text-[12px] font-bold text-slate-500">
                                                <span>Remaining Amount (at Delivery)</span>
                                                <span>₹{remainingCodAmount.toLocaleString()}</span>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="flex justify-between text-[13px] font-black text-slate-900">
                                            <span className="flex items-center gap-1.5"><Zap size={14} className="text-emerald-500" /> Full Amount at Delivery</span>
                                            <span className="text-emerald-600 font-black">₹{finalTotal.toLocaleString()}</span>
                                        </div>
                                    )}
                                    {isShiprocket && (
                                        <div className="text-[10px] text-blue-600 font-bold border-t border-slate-100 pt-2 flex items-center gap-1">
                                            <Truck size={12} /> Standard courier shipping (3-5 business days)
                                        </div>
                                    )}
                                </div>
                            ) : isShiprocket ? (
                                <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100 space-y-2 animate-in fade-in zoom-in">
                                    <div className="flex items-center gap-3">
                                        <Truck className="w-5 h-5 text-blue-500 flex-shrink-0" />
                                        <div className="space-y-0.5">
                                            <p className="text-[13px] font-black text-blue-800">Standard Logistics</p>
                                            <p className="text-[11px] font-medium text-blue-600">
                                                Delivery via Shiprocket courier (3-5 business days)
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : null}

                            <div className="fixed bottom-0 left-0 w-full bg-[var(--color-surface-card)] p-4 shadow-[0_-8px_30px_rgb(0,0,0,0.12)] z-[100] lg:relative lg:p-0 lg:shadow-none lg:z-auto lg:mt-2">
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
                                            <span className="text-xl">
                                                {paymentMethod === 'COD'
                                                    ? (codAdvance > 0 ? 'Authorize Advance' : 'Place COD Order')
                                                    : (isShiprocket ? 'Pay Now' : 'Authorize Payment')}
                                            </span>
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
                        const pinMatch = addr.address.match(/\b\d{6}\b/);
                        const extractedPin = pinMatch ? pinMatch[0] : '';
                        setFormData(prev => ({ 
                            ...prev, 
                            address: addr.address,
                            pincode: extractedPin 
                        }));
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
