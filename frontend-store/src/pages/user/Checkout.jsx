import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { CheckCircle2, Navigation, MapPin, Plus, Trash2, ChevronRight, ShieldCheck, Truck, ShoppingBag, Info, BadgePercent, Lock } from 'lucide-react'
import { API_BASE_URL } from '../../config'
import AddressPicker from '../../components/AddressPicker'

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
    const [paymentMethod, setPaymentMethod] = useState('COD');
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

    useEffect(() => {
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
            .then(data => setAvailability(data))
            .catch(e => console.error('Failed to load availability:', e));
    }, []);

    const checkPincode = () => {
        if (!pincode || pincode.length !== 6) return;
        setCheckingPincode(true);
        // Simulating Shiprocket Serviceability API call
        setTimeout(() => {
            setServiceability({
                status: 'serviceable',
                edd: new Date(Date.now() + (deliveryMode === 'quick' ? 30 * 60000 : 3 * 24 * 60 * 60 * 1000)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
                courier: deliveryMode === 'quick' ? 'JDLX Hyperlocal' : 'Shiprocket Express'
            });
            setCheckingPincode(false);
        }, 800);
    };

    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const fittingTotal = cart.reduce((sum, item) => {
        if (item.fitting) {
            const charge = item.sub_category?.toLowerCase().includes('uv glass') ? 80 : 40;
            return sum + (charge * item.qty);
        }
        return sum;
    }, 0);
    const hasOutOfStockItems = cart.some(item => (item.stock ?? 0) <= 0);
    
    const freeThreshold = availability?.free_delivery_threshold || 199;
    const stdDeliveryFee = availability?.delivery_fee || 49;
    const platformFee = availability?.platform_fee || 7;
    const actualDeliveryFee = totalAmount >= freeThreshold ? 0 : stdDeliveryFee;
    const finalAmount = totalAmount + platformFee + actualDeliveryFee + fittingTotal;

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handlePlaceOrder = async (e) => {
        e.preventDefault();

        // Validate login
        if (!user) {
            alert("Please login via Google before placing an order!");
            navigate('/login');
            return;
        }

        if (hasOutOfStockItems) {
            alert("One or more cart items are out of stock. Remove them before checkout.");
            return;
        }

        const token = useStore.getState().token;
        setIsProcessing(true);

        try {
            // 1. Create Order (Status will be PENDING_PAYMENT)
            const orderPayload = {
                items: cart.map(item => ({ 
                    id: item.id, 
                    qty: item.qty, 
                    price: item.price, 
                    device_model: item.device_model || null,
                    fitting_charge: item.fitting ? (item.sub_category?.toLowerCase().includes('uv glass') ? 80 : 40) : 0
                })),
                address: `${formData.address}${formData.landmark ? `, ${formData.landmark}` : ''}${formData.pincode ? `, ${formData.pincode}` : ''}`,
                address_id: selectedAddressId,
                phone: formData.phone,
                total_amount: totalAmount,
                fitting_charge: fittingTotal,
                latitude: coords.latitude,
                longitude: coords.longitude,
                email: formData.email,
                delivery_type: useStore.getState().deliveryMode,
                customer_name: formData.name
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

            // 2. Handle Payment Flow
            if (paymentMethod === 'COD') {
                // Verify COD directly
                const verifyRes = await fetch(`${API_BASE_URL}/payment/verify`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ order_id: orderId, payment_method: 'COD' })
                });
                if (!verifyRes.ok) throw new Error("COD verification failed");
            } else {
                // Razorpay Flow (Simulated)
                const paymentRes = await fetch(`${API_BASE_URL}/payment/create`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ order_id: orderId, payment_method: paymentMethod })
                });
                const paymentData = await paymentRes.json();
                if (!paymentRes.ok) throw new Error(paymentData.error || "Payment initialization failed");

                // Simulate Razorpay Modal Interaction
                console.log("Opening Razorpay Modal for:", paymentData.id);
                await new Promise(resolve => setTimeout(resolve, 2000));

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
                        razorpay_signature: "simulated_signature"
                    })
                });
                if (!verifyRes.ok) throw new Error("Payment verification failed");
            }

            setOrderPlaced(true);
            setTimeout(() => {
                clearCart();
                navigate(`/track/${orderId}`);
            }, 3000);
        } catch (error) {
            console.error('Checkout Error:', error);
            alert(error.message);
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
            <h1 className="text-3xl font-black tracking-tighter text-[var(--color-on-surface)] px-2" style={{ fontFamily: 'Manrope, sans-serif' }}>Checkout Details</h1>

            {!user && (
                <div className="glass-card border-none bg-amber-500/10 text-amber-500 p-5 flex flex-col items-center gap-3 text-center">
                    <p className="font-bold text-sm">You must be logged in to place an order.</p>
                    <button onClick={() => navigate('/login')} className="btn-primary w-full sm:w-auto px-10">Login with Google</button>
                </div>
            )}

            <form onSubmit={handlePlaceOrder} className="flex flex-col gap-4">
                <div className="glass-card p-6 shadow-xl">
                    {hasOutOfStockItems && (
                        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-[13px] font-black text-red-700">
                            ⚠️ Some items in your cart are out of stock. Remove them to continue.
                        </div>
                    )}
                {/* Shiprocket Pincode & Logistics Section */}
                <div className="glass-card p-6 shadow-xl space-y-5">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-black text-[var(--color-on-surface)] flex items-center gap-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
                            <Navigation className="w-5 h-5 text-primary" /> Delivery Logistics
                        </h3>
                        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Shiprocket_Logo.svg/1200px-Shiprocket_Logo.svg.png" alt="Shiprocket" className="h-4 grayscale opacity-50" />
                    </div>

                    <div className="space-y-4">
                        <div className="relative group">
                            <input
                                type="text"
                                maxLength="6"
                                value={pincode}
                                onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
                                placeholder="Enter Pincode for Shiprocket Check"
                                className="w-full rounded-[24px] border-2 border-slate-100 bg-white px-6 py-5 text-sm font-black text-slate-900 outline-none focus:border-primary transition-all pr-32"
                            />
                            <button 
                                onClick={checkPincode}
                                disabled={checkingPincode || pincode.length !== 6}
                                className="absolute right-3 top-3 bottom-3 px-6 rounded-full bg-primary text-white text-[10px] font-black uppercase tracking-widest hover:shadow-lg disabled:opacity-50 disabled:shadow-none transition-all"
                            >
                                {checkingPincode ? 'Checking...' : 'Check'}
                            </button>
                        </div>

                        {serviceability && (
                            <div className={`p-4 rounded-3xl border-2 flex items-center gap-4 animate-in slide-in-from-top duration-300 ${serviceability.status === 'serviceable' ? 'border-emerald-100 bg-emerald-50/50' : 'border-red-100 bg-red-50/50'}`}>
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${serviceability.status === 'serviceable' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
                                    {serviceability.status === 'serviceable' ? <CheckCircle2 size={20} /> : <Info size={20} />}
                                </div>
                                <div className="flex-1">
                                    <p className="text-[13px] font-black text-slate-900 leading-none" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                        {serviceability.status === 'serviceable' ? `Delivering via ${serviceability.courier}` : 'Area not serviceable'}
                                    </p>
                                    <p className="text-[10px] font-bold text-slate-500 mt-1 uppercase tracking-tight">
                                        {serviceability.status === 'serviceable' ? `Estimated Arrival: ${serviceability.edd}` : 'Try a different pincode'}
                                    </p>
                                </div>
                                {serviceability.status === 'serviceable' && (
                                    <div className="px-3 py-1 bg-white rounded-full border border-emerald-100 text-[9px] font-black text-emerald-600 uppercase tracking-widest">Available</div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                    <div className="flex items-center justify-between mb-6">
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
                        <div className="flex flex-col gap-4 mb-8">
                            {savedAddresses.map(addr => (
                                <div
                                    key={addr.id}
                                    onClick={() => {
                                        setSelectedAddressId(addr.id);
                                        setFormData(prev => ({ ...prev, address: addr.address_text }));
                                        setCoords({ latitude: addr.latitude, longitude: addr.longitude });
                                    }}
                                    className={`p-5 rounded-[24px] border-2 transition-all cursor-pointer flex items-center justify-between gap-4 ${selectedAddressId === addr.id ? 'border-primary bg-primary/[0.03] shadow-lg shadow-primary/5' : 'border-[var(--color-surface-high)] bg-[var(--color-surface-low)]/50 hover:bg-white dark:hover:bg-slate-800'}`}
                                >
                                    <div className="flex items-center gap-4">
                                        <div className={`p-3 rounded-2xl ${selectedAddressId === addr.id ? 'bg-primary text-white' : 'bg-[var(--color-surface-high)] text-[var(--color-on-surface-variant)]'}`}>
                                            <MapPin size={18} />
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                            <p className={`text-[15px] font-black tracking-tight ${selectedAddressId === addr.id ? 'text-[var(--color-on-surface)]' : 'text-[var(--color-on-surface-variant)]'}`} style={{ fontFamily: 'Manrope, sans-serif' }}>{addr.address_text}</p>
                                            <p className="text-[10px] text-[var(--color-on-surface-variant)] font-black uppercase tracking-widest opacity-60">Verified Store Location</p>
                                        </div>
                                    </div>
                                    {selectedAddressId === addr.id && <CheckCircle2 size={22} className="text-primary" />}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="p-8 text-center bg-gray-50 rounded-2xl border-2 border-dashed border-gray-100 mb-6">
                            <p className="text-sm text-gray-400 font-medium">No saved addresses yet.</p>
                        </div>
                    )}

                    <div className="flex flex-col gap-5">
                        <div className="space-y-2 opacity-80">
                            <label className="text-[10px] font-black text-[var(--color-on-surface-variant)] uppercase tracking-[0.2em] px-1">Customer Profile</label>
                            <div className="grid grid-cols-2 gap-4">
                                <input type="text" name="name" value={formData.name} disabled className="bg-[var(--color-surface-low)] border border-[var(--color-surface-high)] rounded-[18px] px-5 py-4 text-sm w-full font-bold opacity-70" placeholder="Name" />
                                <input type="email" name="email" value={formData.email} disabled className="bg-[var(--color-surface-low)] border border-[var(--color-surface-high)] rounded-[18px] px-5 py-4 text-sm w-full font-bold opacity-70" placeholder="Email" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-[var(--color-on-surface-variant)] uppercase tracking-[0.2em] px-1">Active Contact Number</label>
                            <input
                                type="tel"
                                name="phone"
                                value={formData.phone}
                                onChange={handleChange}
                                required
                                pattern="[0-9]{10}"
                                className="bg-white border-2 border-slate-200 rounded-[18px] px-5 py-4 shadow-sm focus:outline-none focus:border-primary/40 w-full text-slate-900 text-[15px] font-black tracking-tight transition-all"
                                placeholder="10-digit Mobile Number"
                            />
                        </div>

                        {!selectedAddressId && (
                            <div className="space-y-2 animate-in slide-in-from-top-2">
                                <label className="text-[10px] font-black text-[var(--color-on-surface-variant)] uppercase tracking-[0.2em] px-1">Manual Delivery Layout</label>
                                <textarea
                                    name="address"
                                    value={formData.address}
                                    onChange={handleChange}
                                    required
                                    rows="2"
                                    className="bg-white border-2 border-slate-200 rounded-[18px] px-5 py-4 shadow-sm focus:outline-none focus:border-primary/40 w-full text-slate-900 text-[15px] font-black tracking-tight transition-all"
                                    placeholder="Flat NO, Building, Street, Landmark"
                                />
                            </div>
                        )}
                    </div>
                </div>

                {showPicker && (
                    <AddressPicker
                        onClose={() => setShowPicker(false)}
                        onSelect={(addr) => {
                            setFormData(prev => ({ ...prev, address: addr.address }));
                            setCoords({ latitude: addr.latitude, longitude: addr.longitude });
                            // Re-fetch addresses to show the newly saved one
                            const token = localStorage.getItem('token');
                            fetch(`${API_BASE_URL}/address/user`, {
                                headers: { 'Authorization': `Bearer ${token}` }
                            })
                                .then(res => res.json())
                                .then(data => {
                                    setSavedAddresses(data);
                                    if (data.length > 0) setSelectedAddressId(data[0].id);
                                });
                        }}
                    />
                )}

                <div className="glass-card p-6 shadow-xl">
                    <h3 className="text-lg font-black text-[var(--color-on-surface)] mb-5 flex items-center gap-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
                        <Lock className="w-5 h-5 text-emerald-500" /> Payment Gateway
                    </h3>
                    <div className="flex flex-col gap-3">
                        <div className="relative group opacity-60 grayscale-[0.5] cursor-not-allowed">
                            <label className="flex items-center justify-between p-5 rounded-[24px] border-2 border-slate-100 bg-slate-50 transition-all">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-slate-200 text-slate-400">
                                        <ShieldCheck size={20} />
                                    </div>
                                    <div>
                                        <p className="font-black text-[15px] text-slate-400" style={{ fontFamily: 'Manrope, sans-serif' }}>Credit / Debit Card</p>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Temporarily Unavailable</p>
                                    </div>
                                </div>
                                <div className="w-5 h-5 rounded-full border-2 border-slate-200"></div>
                            </label>
                        </div>

                        <div className="relative group opacity-60 grayscale-[0.5] cursor-not-allowed">
                            <label className="flex items-center justify-between p-5 rounded-[24px] border-2 border-slate-100 bg-slate-50 transition-all">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-slate-200 text-slate-400">
                                        <BadgePercent size={20} />
                                    </div>
                                    <div>
                                        <p className="font-black text-[15px] text-slate-400" style={{ fontFamily: 'Manrope, sans-serif' }}>UPI (GPay, PhonePe, Paytm)</p>
                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Under Maintenance</p>
                                    </div>
                                </div>
                                <div className="w-5 h-5 rounded-full border-2 border-slate-200"></div>
                            </label>
                        </div>

                        <label className={`flex items-center justify-between p-5 rounded-[24px] border-2 transition-all cursor-pointer border-primary bg-primary/[0.03] shadow-md ring-2 ring-primary/10`}>
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary text-white">
                                    <Truck size={20} />
                                </div>
                                <div>
                                    <p className="font-black text-[15px] text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>Cash on Delivery</p>
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Pay at Doorstep • Recommended</p>
                                </div>
                            </div>
                            <input type="radio" name="payment" value="COD" checked={true} readOnly className="w-5 h-5 text-primary focus:ring-primary" />
                        </label>
                    </div>
                </div>

                {/* Detailed Bill Summary & Cart Items */}
                <div className="glass-card p-6 shadow-xl space-y-6">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                        <h3 className="text-lg font-black text-[var(--color-on-surface)] flex items-center gap-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
                            <ShoppingBag className="w-5 h-5 text-primary" /> Order Summary
                        </h3>
                        <span className="text-[11px] font-black bg-slate-100 px-3 py-1 rounded-full uppercase tracking-widest text-slate-500">{cart.length} Items</span>
                    </div>

                    <div className="max-h-60 overflow-y-auto no-scrollbar space-y-4">
                        {cart.map(item => (
                            <div key={item.id} className="flex flex-col gap-2">
                                <div className="flex items-center justify-between gap-4 group">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 bg-slate-50 rounded-xl flex-shrink-0 border border-slate-100 p-1">
                                            <img src={item.image_url || 'https://placehold.co/100'} alt="" className="w-full h-full object-contain" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-black text-slate-900 truncate max-w-[150px] sm:max-w-[300px]">{item.name}</p>
                                            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-tighter">{item.qty} Unit{item.qty > 1 ? 's' : ''} • ₹{item.price}</p>
                                            {item.device_model && (
                                                <p className="text-[10px] font-black text-primary uppercase tracking-tighter">Device: {item.device_model}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-sm font-black text-slate-900">₹{(item.price * item.qty).toLocaleString()}</div>
                                </div>
                                {item.category_id === 7 && deliveryMode === 'quick' && !item.fitting && (
                                    <div className="ml-15 pl-15 flex items-center justify-between bg-amber-50 p-3 rounded-2xl border border-amber-100 animate-pulse hover:animate-none transition-all">
                                        <div className="flex items-center gap-2">
                                            <Truck size={14} className="text-amber-600" />
                                            <span className="text-[10px] font-black text-amber-700 uppercase tracking-tight">Add Pro Fitting? (₹{item.sub_category?.toLowerCase().includes('uv glass') ? 80 : 40})</span>
                                        </div>
                                        <button 
                                            type="button"
                                            onClick={() => useStore.getState().toggleFittingService(item.id)}
                                            className="text-[10px] font-black text-white bg-amber-600 px-3 py-1 rounded-full shadow-sm hover:bg-amber-700"
                                        >
                                            Add Service
                                        </button>
                                    </div>
                                )}
                                {item.fitting && (
                                    <div className="ml-15 pl-15 flex items-center justify-between bg-emerald-50 p-2 rounded-2xl border border-emerald-100">
                                        <div className="flex items-center gap-2">
                                            <CheckCircle2 size={14} className="text-emerald-600" />
                                            <span className="text-[10px] font-black text-emerald-700 uppercase tracking-tight">Fitting Service Added</span>
                                        </div>
                                        <span className="text-[10px] font-black text-emerald-700">₹{(item.sub_category?.toLowerCase().includes('uv glass') ? 80 : 40) * item.qty}</span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="space-y-3 pt-4 border-t border-slate-100">
                        <div className="flex justify-between text-sm font-bold text-slate-500">
                            <span>Subtotal</span>
                            <span>₹{totalAmount.toLocaleString()}</span>
                        </div>
                        {fittingTotal > 0 && (
                            <div className="flex justify-between text-sm font-bold text-primary">
                                <span>Fitting Service Total</span>
                                <span>₹{fittingTotal.toLocaleString()}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-sm font-bold text-slate-500">
                            <span>Delivery Fee</span>
                            {totalAmount >= (availability?.free_delivery_threshold || 199) ? (
                                <span className="text-emerald-500 uppercase tracking-widest text-xs font-black">Free</span>
                            ) : (
                                <span className="text-slate-900">₹{availability?.delivery_fee || 49}</span>
                            )}
                        </div>
                        {totalAmount < (availability?.free_delivery_threshold || 199) && (
                            <div className="flex items-center gap-2 text-[10px] font-bold text-amber-600 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-100">
                                <Info size={12} />
                                Add ₹{(availability?.free_delivery_threshold || 199) - totalAmount} more for FREE delivery
                            </div>
                        )}
                        <div className="flex justify-between text-sm font-bold text-slate-500">
                            <span>Platform Fee</span>
                            <span>₹{availability?.platform_fee || 7}</span>
                        </div>
                        {deliveryMode === 'quick' && (
                            <div className="flex items-start gap-3 p-3 bg-primary/5 rounded-2xl border border-primary/10">
                                <Truck className="w-4 h-4 text-primary mt-0.5" />
                                <div className="text-[11px] font-bold text-primary leading-relaxed">
                                    Your order will be dispatched from our nearest Dark Store for <span className="font-black uppercase">Quick Delivery</span>.
                                </div>
                            </div>
                        )}
                        <div className="flex justify-between items-center pt-4 border-t-2 border-dashed border-slate-100">
                            <span className="text-lg font-black text-slate-900" style={{ fontFamily: 'Manrope, sans-serif' }}>Amount Payable</span>
                            <span className="text-2xl font-black text-primary tracking-tighter" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                ₹{finalAmount.toLocaleString()}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Trust Signal */}
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                        <ShieldCheck size={14} className="text-emerald-500" />
                        Secure Checkout Powered by Stitch
                    </div>
                    <p className="text-[10px] text-slate-400 px-10 max-w-sm leading-relaxed">
                        By authorizing payment, you agree to our Terms of Service. Your data is encrypted and managed via JDLX Warehouse Node.
                    </p>
                </div>

                <button
                    type="submit"
                    disabled={!user || isProcessing}
                    className="btn-primary w-full mt-4 text-xl py-5 shadow-2xl flex items-center justify-center gap-3 font-black tracking-tighter"
                    style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                    {isProcessing ? (
                        <>
                            <div className="w-6 h-6 border-[3px] border-white/30 border-t-white rounded-full animate-spin"></div>
                            <span>Finalizing Payment...</span>
                        </>
                    ) : (
                        <>
                            <span>Authorize Payment</span>
                            <span className="opacity-40">|</span>
                            <span>₹{finalAmount.toLocaleString()}</span>
                        </>
                    )}
                </button>
            </form>
        </div>
    )
}

export default Checkout
