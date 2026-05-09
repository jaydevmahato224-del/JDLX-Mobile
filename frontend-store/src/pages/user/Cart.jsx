import { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowRight, Minus, Plus, Trash2, AlertCircle, LogIn, X, Info, Truck, CheckCircle2 } from 'lucide-react'
import { resolveMediaUrl, API_BASE_URL } from '../../config'
import DeviceModelSelector from '../../components/DeviceModelSelector'
import { getDeviceModelValue, isStickerProduct } from '../../utils/stickerCustomization'

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
    const [isSyncing, setIsSyncing] = useState(false);
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [availability, setAvailability] = useState(null);

    useEffect(() => {
        fetch(`${API_BASE_URL}/warehouse/availability`)
            .then(res => res.json())
            .then(data => setAvailability(data))
            .catch(e => console.error('Failed to load availability:', e));
    }, []);

    useEffect(() => {
        const sync = async () => {
            setIsSyncing(true);
            await syncCartWithInventory();
            setIsSyncing(false);
        };
        sync();
    }, [syncCartWithInventory]);

    // Robust ID matching and numeric conversions
    const availableItems = cart.filter(item => !item.removedFromInventory && Number(item.stock || 0) > 0);
    const hasUnavailableItems = cart.some(item => item.removedFromInventory || Number(item.stock || 0) <= 0);
    const hasStickerMissingDevice = cart.some(item => isStickerProduct(item) && !getDeviceModelValue(item.device_model));
    
    const subtotal = availableItems.reduce((sum, item) => sum + (Number(item.price || 0) * item.qty), 0);
    const fittingTotal = availableItems.reduce((sum, item) => {
        if (item.fitting) {
            const charge = item.sub_category?.toLowerCase().includes('uv glass') ? 80 : 40;
            return sum + (charge * item.qty);
        }
        return sum;
    }, 0);

    const freeDeliveryThreshold = Number(availability?.free_delivery_threshold || 199);
    const deliveryFee = subtotal >= freeDeliveryThreshold ? 0 : Number(availability?.delivery_fee || 49);
    const platformFee = Number(availability?.platform_fee || 7);
    const finalToPay = subtotal + fittingTotal + deliveryFee + platformFee;

    const removeUnavailable = () => {
        const unavailableIds = cart.filter(item => item.removedFromInventory || Number(item.stock || 0) <= 0).map(i => i.id);
        unavailableIds.forEach(id => removeFromCart(id));
    };

    if (cart.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 animate-in fade-in zoom-in duration-500">
                <div className="w-28 h-28 bg-[var(--color-surface-low)] rounded-full flex items-center justify-center text-[var(--color-on-surface-variant)] shadow-inner">
                    <Trash2 className="w-12 h-12 opacity-20" />
                </div>
                <div className="text-center">
                    <h2 className="text-3xl font-black tracking-tighter text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>Your cart is empty</h2>
                    <p className="mt-2 text-sm text-[var(--color-on-surface-variant)]">Add some essentials to see them here!</p>
                </div>
                <Link to="/" className="btn-primary px-8 shadow-xl shadow-primary/20">Start Shopping</Link>
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

            <div className="grid lg:grid-cols-[1fr,380px] gap-8 items-start">
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
                                                
                                                {/* Smart Stock Badge - Merged and improved logic */}
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
                                                onClick={() => item.qty > 1 ? updateQuantity(item.id, item.qty - 1) : removeFromCart(item.id)}
                                                className="w-10 h-10 flex items-center justify-center text-[var(--color-on-surface-variant)] hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                            >
                                                {item.qty === 1 ? <Trash2 className="w-5 h-5" /> : <Minus className="w-5 h-5" />}
                                            </button>
                                            <span className="w-6 text-center text-[16px] font-black text-[var(--color-on-surface)]">{item.qty}</span>
                                            <button
                                                onClick={() => updateQuantity(item.id, item.qty + 1)}
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

                {/* Sidebar Summary */}
                <aside className="sticky top-24 space-y-6">
                    <div className="glass-card p-8 shadow-2xl relative overflow-hidden">
                        {/* Decorative background element */}
                        <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/5 rounded-full blur-3xl" />
                        
                        <h3 className="text-xl font-black text-[var(--color-on-surface)] mb-6 flex items-center gap-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
                            Order Summary
                        </h3>

                        <div className="space-y-4">
                            <div className="flex justify-between text-sm font-bold text-[var(--color-on-surface)]/80">
                                <span>Items Subtotal</span>
                                <span className="text-[var(--color-on-surface)]">₹{subtotal.toLocaleString()}</span>
                            </div>

                            {fittingTotal > 0 && (
                                <div className="flex justify-between text-sm font-bold text-[var(--color-on-surface)]/80">
                                    <span>Fitting Service</span>
                                    <span className="text-primary">₹{fittingTotal.toLocaleString()}</span>
                                </div>
                            )}
                            
                            <div className="flex justify-between text-sm font-bold text-[var(--color-on-surface)]/80">
                                <span>Delivery Fee</span>
                                {deliveryFee === 0 ? (
                                    <span className="text-[#00E676] flex items-center gap-1.5 font-black uppercase tracking-widest text-[10px]"><CheckCircle2 size={14} /> FREE</span>
                                ) : (
                                    <span className="text-[var(--color-on-surface)]">₹{deliveryFee}</span>
                                )}
                            </div>
                            
                            {subtotal < freeDeliveryThreshold && subtotal > 0 && (
                                <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-[10px] font-black text-amber-500 flex items-center gap-2">
                                    <Info size={14} /> ADD ₹{freeDeliveryThreshold - subtotal} MORE FOR FREE DELIVERY
                                </div>
                            )}

                            <div className="flex justify-between text-sm font-bold text-[var(--color-on-surface)]/80 pb-6 border-b border-[var(--color-surface-high)]">
                                <span>Platform Fee</span>
                                <span className="text-[var(--color-on-surface)]">₹{platformFee}</span>
                            </div>

                            <div className="flex justify-between items-center pt-2">
                                <span className="text-lg font-black text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>Total Amount</span>
                                <div className="text-right">
                                    <span className="text-3xl font-black text-primary tracking-tighter block" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                        ₹{finalToPay.toLocaleString()}
                                    </span>
                                    <p className="text-[9px] font-bold text-[var(--color-on-surface-variant)] uppercase tracking-widest">All taxes included</p>
                                </div>
                            </div>
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
                                    alert("Some items in your cart are no longer available.");
                                } else if (state.cart.some(item => isStickerProduct(item) && !getDeviceModelValue(item.device_model))) {
                                    alert("Please select a device model for all stickers.");
                                } else {
                                    navigate('/checkout');
                                }
                            }}
                            className={`w-full mt-8 flex justify-between items-center group h-16 rounded-2xl px-6 transition-all active:scale-[0.98] ${subtotal <= 0 || isSyncing || hasStickerMissingDevice
                                ? 'bg-slate-100 text-slate-300 cursor-not-allowed border border-slate-200' 
                                : 'bg-slate-900 text-white shadow-2xl shadow-slate-900/20 hover:bg-slate-800'
                            }`}
                        >
                            <span className="font-black uppercase tracking-[0.2em] text-[11px]">{isSyncing ? 'Verifying...' : 'Checkout'}</span>
                            <div className="flex items-center gap-3">
                                <span className="text-xl font-black">₹{finalToPay.toLocaleString()}</span>
                                <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
                            </div>
                        </button>
                        
                        {hasStickerMissingDevice && !isSyncing && (
                            <p className="mt-4 text-center text-[10px] font-black text-red-500 uppercase tracking-widest flex items-center justify-center gap-2">
                                <AlertCircle size={12} /> Select Device Model(s) to proceed
                            </p>
                        )}
                        
                        {subtotal <= 0 && !isSyncing && cart.length > 0 && (
                            <p className="mt-4 text-center text-[10px] font-black text-red-500 uppercase tracking-widest flex items-center justify-center gap-2">
                                <AlertCircle size={12} /> Add available items to proceed
                            </p>
                        )}
                    </div>

                    <div className="glass-card p-6 bg-primary/[0.02] border-primary/5">
                        <div className="flex gap-4 items-start">
                            <div className="w-12 h-12 rounded-2xl bg-white shadow-sm flex items-center justify-center flex-shrink-0 text-primary">
                                <CheckCircle2 />
                            </div>
                            <div>
                                <h4 className="font-black text-sm text-slate-900 mb-1">Safe & Secure</h4>
                                <p className="text-xs font-medium text-slate-500 leading-relaxed">Your order is protected by our super-fast hyperlocal delivery network and 100% genuine product guarantee.</p>
                            </div>
                        </div>
                    </div>
                </aside>
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
