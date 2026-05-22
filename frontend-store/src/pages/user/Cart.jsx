import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useStore } from '../../store/useStore'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowRight, ShoppingBag, Minus, Plus, Trash2, AlertCircle, LogIn, X, Info, Truck, CheckCircle2, ShieldCheck } from 'lucide-react'
import { resolveMediaUrl, API_BASE_URL } from '../../config'
import { trackRemoveFromCart } from '../../utils/analytics'
import DeviceModelSelector from '../../components/DeviceModelSelector'
import PageLoader from '../../components/PageLoader'
import { getDeviceModelValue, isStickerProduct } from '../../utils/stickerCustomization'
import { useAnalyticsContext } from '../../context/AnalyticsContext'

function getProductImage(item) {
    let images = item.images;
    if (!images) return 'https://placehold.co/800x800/f8fafc/0f172a?text=JDLX';
    
    if (typeof images === 'string' && images.startsWith('[')) {
        try {
            const parsed = JSON.parse(images);
            if (Array.isArray(parsed) && parsed.length > 0) {
                images = parsed[0];
            }
        } catch (e) {
            // Not valid JSON
        }
    }
    
    if (Array.isArray(images) && images.length > 0) {
        images = images[0];
    }
    
    return resolveMediaUrl(images);
}

function Cart() {
    const navigate = useNavigate();
    const cart = useStore(state => state.cart);
    const updateQuantity = useStore(state => state.updateQuantity);
    const updateDeviceModel = useStore(state => state.updateDeviceModel);
    const removeFromCart = useStore(state => state.removeFromCart);
    const syncCartWithInventory = useStore(state => state.syncCartWithInventory);
    const toggleFittingService = useStore(state => state.toggleFittingService);
    const deliveryMode = useStore(state => state.deliveryMode);
    const token = useStore(state => state.token);
    const isCartLoaded = useStore(state => state.isCartLoaded);
    const { trackEvent } = useAnalyticsContext();
    const [isSyncing, setIsSyncing] = useState(false);
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [availability, setAvailability] = useState(null);

    useEffect(() => {
        fetch(`${API_BASE_URL}/warehouse/availability`)
            .then(res => res.json())
            .then(data => setAvailability(data))
            .catch(e => console.error('Failed to load availability:', e));
    }, []);

    if (!isCartLoaded) {
        return <PageLoader />;
    }

    // Robust ID matching and numeric conversions
    const availableItems = cart.filter(item => !item.removedFromInventory && Number(item.stock || 0) > 0);
    const hasUnavailableItems = cart.some(item => item.removedFromInventory || Number(item.stock || 0) <= 0);
    const hasStickerMissingDevice = cart.some(item => isStickerProduct(item) && !getDeviceModelValue(item.device_model));
    
    const subtotal = availableItems.reduce((sum, item) => {
        const price = Number(item.price || 0);
        const qty = Number(item.qty || 1);
        return sum + (price * qty);
    }, 0);
    const fittingTotal = availableItems.reduce((sum, item) => {
        if (item.fitting) {
            const charge = item.sub_category?.toLowerCase().includes('uv glass') ? 80 : 40;
            const qty = Number(item.qty || 1);
            return sum + (charge * qty);
        }
        return sum;
    }, 0);

    const freeDeliveryThreshold = Number(availability?.free_delivery_threshold || 499);
    const deliveryFee = subtotal >= freeDeliveryThreshold ? 0 : Number(availability?.delivery_fee || 49);
    const platformFee = Number(availability?.platform_fee || 7);
    const finalToPay = subtotal + fittingTotal + deliveryFee + platformFee;

    const removeUnavailable = () => {
        const unavailableIds = cart.filter(item => item.removedFromInventory || Number(item.stock || 0) <= 0).map(i => i.id);
        unavailableIds.forEach(id => removeFromCart(id));
    };

    if (cart.length === 0) {
        return (
            <div className="relative flex flex-col items-center justify-center min-h-[70vh] px-6 overflow-hidden">
                {/* Background Decoration */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
                
                <div className="relative glass-card max-w-sm w-full py-12 flex flex-col items-center gap-8 animate-in fade-in zoom-in slide-in-from-bottom-10 duration-700 shadow-2xl border-white/10">
                    {/* Icon with Glow */}
                    <div className="relative group">
                        <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full scale-150 group-hover:scale-110 transition-transform duration-700" />
                        <div className="relative w-24 h-24 bg-gradient-to-br from-primary to-primary-container rounded-[32px] flex items-center justify-center text-slate-950 shadow-2xl rotate-3 group-hover:rotate-6 transition-transform duration-500">
                            <ShoppingBag className="w-10 h-10" strokeWidth={2.5} />
                            {/* Floating decorative dots */}
                            <div className="absolute -top-2 -right-2 w-4 h-4 bg-red-500 rounded-full border-4 border-white dark:border-slate-900 animate-bounce" />
                        </div>
                    </div>

                    <div className="text-center space-y-3 px-4">
                        <h2 className="text-3xl font-black tracking-tighter text-[var(--color-on-surface)] leading-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>
                            Your cart feels <span className="text-primary">too light</span>
                        </h2>
                        <p className="text-sm font-medium text-[var(--color-on-surface-variant)] leading-relaxed">
                            Looks like you haven't added any premium accessories yet. Let's find something perfect for you!
                        </p>
                    </div>

                    <div className="w-full px-8 flex flex-col gap-3">
                        <Link 
                            to="/" 
                            className="btn-primary h-14 w-full text-[11px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/30 flex items-center justify-center gap-2"
                        >
                            Explore Essentials
                            <ArrowRight size={16} />
                        </Link>
                        <button 
                            onClick={() => navigate(-1)}
                            className="h-12 w-full text-[10px] font-black text-[var(--color-on-surface-variant)] uppercase tracking-[0.2em] hover:text-[var(--color-on-surface)] transition-colors"
                        >
                            Go Back
                        </button>
                    </div>
                </div>

                {/* Trust Signal */}
                <div className="mt-12 text-[10px] font-black text-[var(--color-on-surface-variant)]/40 uppercase tracking-[0.3em] flex items-center gap-3">
                    <div className="h-px w-8 bg-current opacity-20" />
                    JDLX Premium {deliveryMode === 'quick' ? 'Hyperlocal' : 'Essentials'}
                    <div className="h-px w-8 bg-current opacity-20" />
                </div>
            </div>
        )
    }

    return (
        <div className="container-standard py-8 flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 px-2">
                <div>
                    <h1 className="text-4xl font-black tracking-tighter text-[var(--color-on-surface)] mb-1" style={{ fontFamily: 'Manrope, sans-serif' }}>Your Cart</h1>
                    <p className="text-sm font-bold text-[var(--color-on-surface-variant)] flex items-center gap-2">
                        {availableItems.length} items available {isSyncing && <span className="inline-flex items-center gap-1 text-primary animate-pulse ml-2"><Info size={14} /> Syncing prices...</span>}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {hasUnavailableItems && (
                        <button onClick={removeUnavailable} className="text-[11px] font-black text-red-500 hover:text-white hover:bg-red-500 bg-red-50 px-4 py-2 rounded-xl border border-red-100 transition-all flex items-center gap-2">
                            <Trash2 size={14} /> Clear Unavailable
                        </button>
                    )}
                </div>
            </header>

            <div className="flex flex-col gap-8">
                {/* Cart Items List */}
                <div className="space-y-4">
                    {cart.map(item => {
                        const isRemoved = item.removedFromInventory;
                        const stockCount = Number(item.stock || 0);
                        const isSoldOut = !isRemoved && stockCount <= 0;
                        const isUnavailable = isRemoved || isSoldOut;
                        const atMaxStock = item.qty >= stockCount && !isUnavailable;

                        return (
                            <div key={item.id} className={`group relative glass-card p-0 overflow-hidden transition-all duration-500 hover:shadow-2xl hover:scale-[1.01] ${isUnavailable ? 'bg-red-50/20' : ''}`}>
                                <div className="p-4 md:p-6 flex flex-col md:flex-row gap-6 items-start md:items-center">
                                    {/* Image Section */}
                                    <div className={`relative w-24 h-24 md:w-32 md:h-32 rounded-3xl bg-white p-3 flex-shrink-0 border border-[var(--color-surface-high)] shadow-sm transition-transform group-hover:rotate-2 ${isUnavailable ? 'grayscale opacity-60' : ''}`}>
                                        <img src={getProductImage(item)} alt={item.name} className="w-full h-full object-contain transition-transform group-hover:scale-110 duration-500" />
                                        {isUnavailable && (
                                            <div className="absolute inset-0 bg-red-900/5 backdrop-blur-[2px] rounded-3xl flex items-center justify-center">
                                                <X className="text-red-600 w-8 h-8" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Content Section */}
                                    <div className="flex-1 min-w-0 py-1">
                                        <div className="flex flex-col gap-1">
                                            <h3 className={`font-black text-[17px] md:text-xl text-[var(--color-on-surface)] leading-tight tracking-tight ${isUnavailable ? 'opacity-50' : ''}`} style={{ fontFamily: 'Manrope, sans-serif' }}>
                                                {item.name}
                                            </h3>
                                            <div className="flex items-center gap-3">
                                                <p className={`font-black text-xl text-primary ${isUnavailable ? 'opacity-50' : ''}`}>₹{item.price}</p>
                                                
                                                {!isUnavailable && stockCount > 0 && stockCount <= 3 && (
                                                    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border transition-colors ${atMaxStock ? 'bg-red-50 border-red-100 text-red-600' : 'bg-amber-50 border-amber-100 text-amber-600'}`}>
                                                        <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${atMaxStock ? 'bg-red-500' : 'bg-amber-500'}`} />
                                                        <span className="text-[10px] font-black uppercase tracking-wider">
                                                            {atMaxStock ? 'Max Stock Reached' : `Only ${stockCount} Left`}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {isRemoved && (
                                            <p className="mt-3 text-[11px] font-black text-red-600 bg-red-100/50 px-3 py-1.5 rounded-xl w-fit flex items-center gap-2">
                                                <AlertCircle className="w-4 h-4" /> This item is no longer in inventory
                                            </p>
                                        )}
                                        {isSoldOut && (
                                            <p className="mt-3 text-[11px] font-black text-amber-600 bg-amber-100/50 px-3 py-1.5 rounded-xl w-fit flex items-center gap-2">
                                                <AlertCircle className="w-4 h-4" /> Sold out and currently unavailable
                                            </p>
                                        )}

                                        {isStickerProduct(item) && (
                                            <div className="mt-4">
                                                <DeviceModelSelector
                                                    compact
                                                    value={item.device_model || ''}
                                                    onChange={(value) => updateDeviceModel(item.id, value)}
                                                    required
                                                />
                                            </div>
                                        )}

                                        {item.category_id === 7 && deliveryMode === 'quick' && (
                                            <div className="mt-4 p-4 rounded-[24px] bg-[var(--color-surface-low)] border border-[var(--color-surface-high)] flex items-center justify-between group/fitting transition-all hover:bg-[var(--color-surface-white)] hover:shadow-md">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all ${item.fitting ? 'bg-primary text-[var(--color-on-primary)] scale-110 shadow-lg shadow-primary/20' : 'bg-[var(--color-surface-white)] text-[var(--color-on-surface-variant)]'}`}>
                                                        <Truck className="w-5 h-5" />
                                                    </div>
                                                    <div>
                                                        <p className="text-[12px] font-black text-[var(--color-on-surface)] uppercase tracking-tight">Professional Fitting</p>
                                                        <p className="text-[10px] font-bold text-[var(--color-on-surface-variant)] uppercase tracking-widest">₹{item.sub_category?.toLowerCase().includes('uv glass') ? 80 : 40}</p>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => toggleFittingService(item.id)}
                                                    className={`w-12 h-7 rounded-full transition-all relative p-1 ${item.fitting ? 'bg-primary' : 'bg-[var(--color-surface-highest)]'}`}
                                                >
                                                    <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-all transform ${item.fitting ? 'translate-x-5' : 'translate-x-0'}`} />
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Action Section */}
                                    <div className="flex flex-col items-center gap-2 self-stretch justify-center md:border-l border-[var(--color-surface-high)] md:pl-8">
                                        <div className="flex items-center gap-4 bg-[var(--color-surface-white)] rounded-2xl p-1 border border-[var(--color-surface-high)] shadow-sm">
                                            <button
                                                onClick={() => {
                                                    const qtyToRemove = 1;
                                                    if (item.qty === 1) {
                                                        trackRemoveFromCart(item, 1);
                                                        removeFromCart(item.id);
                                                    } else {
                                                        trackRemoveFromCart(item, 1);
                                                        updateQuantity(item.id, item.qty - 1);
                                                    }
                                                }}
                                                className="w-10 h-10 flex items-center justify-center text-[var(--color-on-surface-variant)] hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                            >
                                                {item.qty === 1 ? <Trash2 className="w-5 h-5" /> : <Minus className="w-5 h-5" />}
                                            </button>
                                            <span className="w-6 text-center text-[16px] font-black text-[var(--color-on-surface)]">{Number(item.qty || 1)}</span>
                                            <button
                                                onClick={() => {
                                                  updateQuantity(item.id, item.qty + 1);
                                                  trackEvent('add_to_cart', 'product', item.name, item.id);
                                                }}
                                                className="w-10 h-10 flex items-center justify-center text-primary hover:bg-[var(--color-surface-low)] rounded-xl transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                                                disabled={isUnavailable || atMaxStock}
                                            >
                                                <Plus className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Streamlined Checkout Footer */}
                <div className="mt-8 mb-12 flex flex-col items-center gap-6 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                    <div className="w-full max-w-lg glass-card p-8 shadow-2xl border-primary/10 flex flex-col items-center gap-6">
                        <div className="text-center space-y-1">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Estimated Subtotal</p>
                            <h3 className="text-4xl font-black text-primary tracking-tighter" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                ₹{subtotal.toLocaleString()}
                            </h3>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Delivery & Taxes calculated at checkout</p>
                        </div>

                        <button
                            disabled={isSyncing || subtotal <= 0 || hasStickerMissingDevice}
                            onClick={async () => {
                                if (subtotal <= 0) return;
                                if (!token) { setShowLoginModal(true); return; }

                                setIsSyncing(true);
                                await syncCartWithInventory();
                                setIsSyncing(false);
                                
                                const state = useStore.getState();
                                if (state.cart.some(item => item.removedFromInventory || Number(item.stock || 0) <= 0)) {
                                    toast.error("Some items in your cart are no longer available.");
                                } else if (state.cart.some(item => isStickerProduct(item) && !getDeviceModelValue(item.device_model))) {
                                    toast.error("Please select a device model for all stickers.");
                                } else {
                                    navigate('/checkout');
                                }
                            }}
                            className={`w-full group h-16 rounded-2xl px-8 flex items-center justify-between transition-all active:scale-[0.98] ${subtotal <= 0 || isSyncing || hasStickerMissingDevice
                                ? 'bg-slate-100 text-slate-300 cursor-not-allowed border border-slate-200' 
                                : 'bg-primary text-slate-950 shadow-2xl shadow-primary/30 hover:bg-primary/90'
                            }`}
                        >
                            <span className="font-black uppercase tracking-[0.2em] text-[12px]">{isSyncing ? 'Verifying...' : 'Proceed to Checkout'}</span>
                            <ArrowRight className="w-6 h-6 group-hover:translate-x-2 transition-transform" />
                        </button>

                        {hasStickerMissingDevice && !isSyncing && (
                            <p className="text-[10px] font-black text-red-500 uppercase tracking-widest flex items-center gap-2">
                                <AlertCircle size={12} /> Select Device Model(s) to proceed
                            </p>
                        )}
                    </div>

                    <div className="flex items-center gap-6 opacity-30 grayscale pointer-events-none">
                        <ShieldCheck size={20} />
                        <span className="text-[10px] font-black uppercase tracking-[0.3em]">Secure 256-Bit SSL Checkout</span>
                    </div>
                </div>
            </div>

            {/* Login Required Modal */}
            {showLoginModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div 
                        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300"
                        onClick={() => setShowLoginModal(false)}
                    />
                    <div className="relative glass-card w-full max-w-sm p-8 flex flex-col items-center text-center animate-in zoom-in slide-in-from-bottom-8 duration-500 shadow-2xl">
                        <button 
                            onClick={() => setShowLoginModal(false)}
                            className="absolute top-4 right-4 p-2 hover:bg-slate-100 rounded-full transition-colors"
                        >
                            <X className="w-5 h-5 text-slate-400" />
                        </button>

                        <div className="w-20 h-20 bg-primary/10 text-primary rounded-[32px] flex items-center justify-center mb-6 shadow-inner rotate-3">
                            <LogIn className="w-10 h-10" />
                        </div>

                        <h2 className="text-2xl font-black tracking-tighter text-slate-900 mb-3" style={{ fontFamily: 'Manrope, sans-serif' }}>
                            Login Required
                        </h2>
                        <p className="text-sm font-medium text-slate-500 leading-relaxed mb-8 px-2">
                            Please sign in to continue with your premium checkout experience.
                        </p>

                        <div className="flex flex-col w-full gap-3">
                            <button 
                                onClick={() => navigate('/login')}
                                className="btn-primary h-14 w-full shadow-xl shadow-primary/20"
                            >
                                Login to Continue
                            </button>
                            <button 
                                onClick={() => setShowLoginModal(false)}
                                className="h-14 w-full text-[11px] font-black text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-widest"
                            >
                                Maybe Later
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Bottom spacing for mobile nav */}
            <div className="h-20 lg:hidden" />
        </div>
    )
}

export default Cart
