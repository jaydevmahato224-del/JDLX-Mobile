import { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowRight, Minus, Plus, Trash2, AlertCircle, LogIn, X, Info } from 'lucide-react'
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

    const availableItems = cart.filter(item => !item.removedFromInventory && (item.stock ?? 0) > 0);
    const hasUnavailableItems = cart.some(item => item.removedFromInventory || (item.stock ?? 0) <= 0);
    const hasStickerMissingDevice = cart.some(item => isStickerProduct(item) && !getDeviceModelValue(item.device_model));
    const totalAmount = availableItems.reduce((sum, item) => sum + (Number(item.price || 0) * item.qty), 0);
    const fittingTotal = availableItems.reduce((sum, item) => {
        if (item.fitting) {
            const charge = item.sub_category?.toLowerCase().includes('uv glass') ? 80 : 40;
            return sum + (charge * item.qty);
        }
        return sum;
    }, 0);

    const removeUnavailable = () => {
        const unavailableIds = cart.filter(item => item.removedFromInventory || (item.stock ?? 0) <= 0).map(i => i.id);
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
                <Link to="/" className="btn-primary px-8">Start Shopping</Link>
            </div>
        )
    }

    const deliveryFee = totalAmount >= (availability?.free_delivery_threshold || 199) ? 0 : (availability?.delivery_fee || 49);
    const platformFee = availability?.platform_fee || 7;
    const finalToPay = totalAmount + fittingTotal + deliveryFee + platformFee;

    return (
        <div className="container-standard py-6 flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <div className="flex items-center justify-between px-2">
                <h1 className="text-3xl font-black tracking-tighter text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>Your Cart</h1>
                <div className="flex items-center gap-4">
                    {hasUnavailableItems && (
                        <button onClick={removeUnavailable} className="text-[11px] font-black text-red-500 hover:text-red-600 bg-red-50 px-3 py-1.5 rounded-full border border-red-100 transition-colors">
                            Clear Unavailable
                        </button>
                    )}
                    {isSyncing && <div className="text-xs font-bold text-primary animate-pulse">Syncing Inventory...</div>}
                </div>
            </div>

            <div className="glass-card overflow-hidden divide-y divide-[var(--color-surface-high)]">
                {cart.map(item => {
                    const isRemoved = item.removedFromInventory;
                    const isSoldOut = !isRemoved && (item.stock ?? 0) <= 0;
                    const isUnavailable = isRemoved || isSoldOut;

                    return (
                        <div key={item.id} className={`p-5 flex gap-5 items-center transition-colors ${isUnavailable ? 'bg-red-50/10' : 'hover:bg-primary/[0.02]'}`}>
                            <div className={`w-20 h-20 rounded-2xl bg-[var(--color-surface-low)] overflow-hidden flex-shrink-0 border border-[var(--color-surface-high)] ${isUnavailable ? 'grayscale opacity-60' : ''}`}>
                                <img src={getProductImage(item)} alt={item.name} className="w-full h-full object-contain p-2 transition-transform hover:scale-110" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className={`font-bold text-[var(--color-on-surface)] text-[15px] leading-tight truncate ${isUnavailable ? 'opacity-50' : ''}`} style={{ fontFamily: 'Manrope, sans-serif' }}>{item.name}</h3>
                                <div className="flex items-center gap-3 mt-1">
                                    <p className={`font-black text-primary text-[16px] ${isUnavailable ? 'opacity-50' : ''}`}>₹{item.price}</p>
                                    
                                    {!isUnavailable && (item.stock ?? 0) > 0 && (item.stock ?? 0) <= 3 && (
                                        <div className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-full">
                                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                            <span className="text-[10px] font-black text-amber-600 uppercase tracking-tight">
                                                Only {(item.stock ?? 0)} Left
                                            </span>
                                        </div>
                                    )}
                                </div>
                                
                                {isRemoved && (
                                    <div className="mt-2 flex items-center gap-1.5 text-[11px] font-black text-red-600 bg-red-100/50 px-3 py-1 rounded-lg w-fit">
                                        <AlertCircle className="w-3.5 h-3.5" />
                                        This item has been removed from inventory
                                    </div>
                                )}
                                
                                {isSoldOut && (
                                    <div className="mt-2 flex items-center gap-1.5 text-[11px] font-black text-amber-600 bg-amber-100/50 px-3 py-1 rounded-lg w-fit">
                                        <AlertCircle className="w-3.5 h-3.5" />
                                        Sold out, this item cannot be purchased
                                    </div>
                                )}

                                {isStickerProduct(item) && (
                                    <DeviceModelSelector
                                        compact
                                        value={item.device_model || ''}
                                        onChange={(value) => updateDeviceModel(item.id, value)}
                                        required
                                    />
                                )}

                                {/* Fitting Service Logic for Screen Protectors */}
                                {item.category_id === 7 && deliveryMode === 'quick' && (
                                    <div className="mt-3 p-3 rounded-2xl bg-primary/5 border border-primary/10 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm">
                                                    <Truck className="w-4 h-4 text-primary" />
                                                </div>
                                                <div>
                                                    <p className="text-[11px] font-black text-slate-900 uppercase tracking-tight">Professional Fitting</p>
                                                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Doorstep Installation</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[12px] font-black text-primary">₹{item.sub_category?.toLowerCase().includes('uv glass') ? 80 : 40}</span>
                                                <button
                                                    onClick={() => toggleFittingService(item.id)}
                                                    className={`w-10 h-6 rounded-full transition-all relative ${item.fitting ? 'bg-primary' : 'bg-slate-200'}`}
                                                >
                                                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${item.fitting ? 'right-1' : 'left-1'}`} />
                                                </button>
                                            </div>
                                        </div>
                                        {item.fitting && (
                                            <p className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full w-fit">
                                                ✓ Expert technician will apply this at your home
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-col items-center gap-1">
                                <div className="flex items-center gap-4 bg-[var(--color-surface-low)] rounded-2xl p-1.5 border border-[var(--color-surface-high)] shadow-sm">
                                    <button
                                        onClick={() => item.qty > 1 ? updateQuantity(item.id, item.qty - 1) : removeFromCart(item.id)}
                                        className="w-9 h-9 flex items-center justify-center text-[var(--color-on-surface-variant)] hover:bg-white dark:hover:bg-slate-800 rounded-xl transition-all hover:shadow-md"
                                    >
                                        {item.qty === 1 ? <Trash2 className="w-4 h-4 text-red-500" /> : <Minus className="w-4 h-4" />}
                                    </button>
                                    <span className="w-5 text-center text-[14px] font-black">{item.qty}</span>
                                    <button
                                        onClick={() => updateQuantity(item.id, item.qty + 1)}
                                        className="w-9 h-9 flex items-center justify-center text-primary hover:bg-white dark:hover:bg-slate-800 rounded-xl transition-all hover:shadow-md disabled:opacity-20"
                                        disabled={isUnavailable || item.qty >= (item.stock ?? 0)}
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                </div>
                                {item.qty >= (item.stock ?? 0) && !isUnavailable && (
                                    <span className="text-[9px] font-black text-amber-600 uppercase tracking-tighter">Max Stock reached</span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="glass-card p-6 mt-2 mb-20 md:mb-0 shadow-xl">
                {hasUnavailableItems && (
                    <div className="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-[13px] font-bold flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                        <div>
                            Some products are currently unavailable. Please remove them from your cart to proceed with checkout.
                        </div>
                    </div>
                )}
                {hasStickerMissingDevice && (
                    <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-[13px] font-bold flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                        <div>Select Your Device Model for every sticker item before checkout.</div>
                    </div>
                )}
                
                <h3 className="text-lg font-black text-[var(--color-on-surface)] mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>Order Summary</h3>
                <div className="space-y-3">
                    <div className="flex justify-between text-[14px] font-medium text-[var(--color-on-surface-variant)]">
                        <span>Items Subtotal (Available)</span>
                        <span className="font-bold text-[var(--color-on-surface)]">₹{totalAmount.toLocaleString()}</span>
                    </div>

                    {fittingTotal > 0 && (
                        <div className="flex justify-between text-[14px] font-medium text-[var(--color-on-surface-variant)]">
                            <span>Fitting Service Total</span>
                            <span className="font-bold text-primary">₹{fittingTotal.toLocaleString()}</span>
                        </div>
                    )}
                    
                    <div className="flex justify-between text-[14px] font-medium text-[var(--color-on-surface-variant)]">
                        <span>Delivery Fee</span>
                        {deliveryFee === 0 ? (
                            <span className="text-emerald-500 font-black uppercase tracking-widest text-[10px]">Free</span>
                        ) : (
                            <span className="text-slate-900 font-bold">₹{deliveryFee}</span>
                        )}
                    </div>
                    
                    {totalAmount < (availability?.free_delivery_threshold || 199) && totalAmount > 0 && (
                        <div className="flex items-center gap-2 text-[10px] font-bold text-amber-600 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-100">
                            <Info size={12} />
                            Add ₹{(availability?.free_delivery_threshold || 199) - totalAmount} more for FREE delivery
                        </div>
                    )}

                    <div className="flex justify-between text-[14px] font-medium text-[var(--color-on-surface-variant)] pb-4 border-b border-[var(--color-surface-high)]">
                        <span>Platform Fee</span>
                        <span className="text-slate-900 font-bold">₹{platformFee}</span>
                    </div>

                    <div className="flex justify-between items-center pt-2">
                        <span className="text-[17px] font-black text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>To Pay</span>
                        <span className="text-2xl font-black text-primary tracking-tighter" style={{ fontFamily: 'Manrope, sans-serif' }}>
                            ₹{finalToPay.toLocaleString()}
                        </span>
                    </div>
                </div>

                <button
                    disabled={isSyncing || totalAmount <= 0 || hasStickerMissingDevice}
                    onClick={async () => {
                        if (totalAmount <= 0) return;
                        
                        // LOGIN CHECK
                        if (!token) {
                            setShowLoginModal(true);
                            return;
                        }

                        setIsSyncing(true);
                        await syncCartWithInventory();
                        setIsSyncing(false);
                        
                        // Check after sync
                        const state = useStore.getState();
                        const stillHasUnavailable = state.cart.some(item => item.removedFromInventory || (item.stock ?? 0) <= 0);
                        const stillMissingDevice = state.cart.some(item => isStickerProduct(item) && !getDeviceModelValue(item.device_model));
                        if (stillHasUnavailable) {
                            alert("Some items in your cart are no longer available. Please remove them before proceeding.");
                        } else if (stillMissingDevice) {
                            alert("Select Your Device Model for every sticker item before checkout.");
                        } else {
                            navigate('/checkout');
                        }
                    }}
                    className={`w-full mt-6 flex justify-between items-center group h-14 rounded-2xl px-6 transition-all active:scale-[0.98] ${totalAmount <= 0 || isSyncing || hasStickerMissingDevice
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                        : 'bg-slate-900 text-white shadow-xl shadow-slate-900/20 hover:bg-slate-800'
                    }`}
                >
                    <span className="font-black uppercase tracking-widest text-[12px]">{isSyncing ? 'Verifying...' : 'Proceed to Checkout'}</span>
                    <div className="flex items-center gap-3">
                        <span className="text-lg font-black">
                            ₹{finalToPay.toLocaleString()}
                        </span>
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </div>
                </button>
                
                {totalAmount <= 0 && cart.length > 0 && (
                    <p className="mt-4 text-center text-[12px] font-bold text-red-500">
                        At least one available item is required for checkout.
                    </p>
                )}
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

                        <div className="w-20 h-20 bg-primary/10 text-primary rounded-3xl flex items-center justify-center mb-6 shadow-inner rotate-3">
                            <LogIn className="w-10 h-10" />
                        </div>

                        <h2 className="text-2xl font-black tracking-tighter text-slate-900 mb-3" style={{ fontFamily: 'Manrope, sans-serif' }}>
                            Login Required
                        </h2>
                        <p className="text-sm font-medium text-slate-500 leading-relaxed mb-8 px-2">
                            Please sign in to experience our <span className="text-primary font-bold">Better Experience</span> and continue with your order process.
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
                                className="h-14 w-full text-sm font-black text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-widest"
                            >
                                Maybe Later
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Cart
