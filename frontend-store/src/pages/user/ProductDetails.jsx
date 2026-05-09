import { AlertCircle, ArrowLeft, ArrowRight, BadgePercent, Bell, CheckCircle2, ChevronRight, Clock, Heart, Minus, Plus, ShieldCheck, ShoppingCart, Star, Store, Truck, Zap, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useStore } from '../../store/useStore';
import { resolveMediaUrl, API_BASE_URL } from '../../config';
import ProductReviews from '../../components/ProductReviews';
import DeviceModelSelector from '../../components/DeviceModelSelector';
import { getDeviceModelValue, isStickerProduct } from '../../utils/stickerCustomization';

const LOW_STOCK_LIMIT = 2;
const PRODUCT_ENDPOINTS = ['/api/products', 'http://127.0.0.1:5000/api/products'];

function normalizeProductsPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.products)) {
    return payload.products;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  return [];
}

function getStockCount(product) {
  return product?.stock ?? 0;
}

function getProductImages(product) {
  let images = 
    product?.image_url ||
    product?.images ||
    product?.image ||
    product?.thumbnail ||
    product?.photo ||
    []

  if (!images || (Array.isArray(images) && images.length === 0)) {
    return ['https://placehold.co/800x800/f8fafc/0f172a?text=JDLX']
  }

  // Handle JSON string of images (array)
  if (typeof images === 'string' && images.startsWith('[')) {
    try {
      const parsed = JSON.parse(images)
      if (Array.isArray(parsed) && parsed.length > 0) {
        images = parsed
      }
    } catch (e) {
      // Not valid JSON, treat as single string
      images = [images]
    }
  } else if (typeof images === 'string') {
    images = [images]
  }

  // Use resolveMediaUrl from config
  return images.map(img => typeof img === 'string' ? resolveMediaUrl(img) : 'https://placehold.co/800x800/f8fafc/0f172a?text=JDLX');
}

function getProductImage(product) {
  const allImages = getProductImages(product);
  return allImages[0];
}

function getHighlights(product, deliveryMode, deliveryTime) {
  if (Array.isArray(product?.highlights) && product.highlights.length) {
    return product.highlights;
  }

  const deliveryType = deliveryMode === 'quick' ? 'quick delivery' : 'scheduled fulfillment';
  const dispatchSource = deliveryMode === 'quick' ? 'Dark-store packed for hyperlocal delivery' : 'Central warehouse dispatched for reliable fulfillment';

  return [
    `${product?.category || 'Accessory'} essential ready for ${deliveryType}`,
    `Available quantity: ${getStockCount(product)}`,
    `Dispatch window: ${deliveryTime}`,
    dispatchSource,
  ];
}

export default function ProductDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const productsState = useStore((state) => state.products);
  const fetchProducts = useStore((state) => state.fetchProducts);
  const storeProducts = Array.isArray(productsState)
    ? productsState
    : Array.isArray(productsState?.items)
      ? productsState.items
      : Array.isArray(productsState?.products)
        ? productsState.products
        : [];
  const [remoteProducts, setRemoteProducts] = useState([]);
  const products = storeProducts.length ? storeProducts : remoteProducts;
  const addToCart = useStore((state) => state.addToCart);
  const cart = useStore((state) => state.cart);
  const wishlist = useStore((state) => state.wishlist);
  const toggleWishlist = useStore((state) => state.toggleWishlist);
  const updateQuantity = useStore((state) => state.updateQuantity);
  const removeFromCart = useStore((state) => state.removeFromCart);
  const deliveryMode = useStore((state) => state.deliveryMode);
  const nearestStoreId = useStore((state) => state.nearestStoreId);
  const [activeTab, setActiveTab] = useState('overview');
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [deviceModel, setDeviceModel] = useState('');
  const [isNotified, setIsNotified] = useState(false);
  const [fitting, setFitting] = useState(false);
  
  const toggleFitting = () => setFitting(!fitting);

  const cartItem = cart.find((item) => String(item.id) === String(id));
  const quantity = cartItem ? cartItem.qty : 0;
  
  const isInWishlist = wishlist.some(item => String(item.id) === String(id));

  useEffect(() => {
    if (!storeProducts.length && typeof fetchProducts === 'function') {
      fetchProducts();
    }
  }, [fetchProducts, storeProducts.length]);

  const [availability, setAvailability] = useState(null);

  useEffect(() => {
    // Primary fetch: Availability
    fetch(`${API_BASE_URL}/warehouse/availability?cb=${Date.now()}`)
      .then((r) => r.json())
      .then((res) => {
        const availabilityData = res.data || res;
        setAvailability(prev => ({ ...prev, ...availabilityData }));
      })
      .catch((e) => console.error('Failed to load availability:', e))

    // Secondary fetch: Global Settings (Backup for delivery times)
    fetch(`${API_BASE_URL}/settings?cb=${Date.now()}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.data) {
          setAvailability(prev => ({ ...prev, ...res.data }));
        }
      })
      .catch((e) => console.error('Failed to load settings:', e))
  }, []);



  useEffect(() => {
    let cancelled = false;

    async function loadProducts() {
      if (storeProducts.length) {
        return;
      }

      for (const endpoint of PRODUCT_ENDPOINTS) {
        try {
          const response = await fetch(endpoint);
          if (!response.ok) {
            continue;
          }

          const payload = await response.json();
          const normalized = normalizeProductsPayload(payload);
          if (normalized.length) {
            if (!cancelled) {
              setRemoteProducts(normalized);
            }
            return;
          }
        } catch {
          // Try the next endpoint.
        }
      }
    }

    loadProducts();

    return () => {
      cancelled = true;
    };
  }, [storeProducts.length]);

  const product = useMemo(
    () => products.find((item) => String(item.id) === String(id)),
    [id, products],
  );

  useEffect(() => {
    setDeviceModel(cartItem?.device_model || '');
  }, [cartItem?.device_model, id]);

  const deliveryTimeDisplay = useMemo(() => {
    if (deliveryMode === 'quick' && nearestStoreId) {
      // Use the actual delivery time from product if available, otherwise a tighter 12-20 min window
      return product?.delivery_time || product?.deliveryTime || '12-20 mins';
    }
    return availability?.scheduled_delivery_time || 'Today / Tomorrow';
  }, [deliveryMode, nearestStoreId, product, availability]);

  const deliveryNoteDisplay = useMemo(() => {
    if (deliveryMode === 'quick' && nearestStoreId) {
      return availability?.quick_delivery_note || 'Hyperlocal dispatch from the active dark store.';
    }
    return availability?.scheduled_delivery_note || 'Reliable fulfillment from our central warehouse.';
  }, [deliveryMode, nearestStoreId, availability]);

  if (!product) {
    return (
      <div className="container-standard py-20 text-center">
        <div className="glass-card px-6 py-20 animate-in fade-in zoom-in duration-500">
          <div className="text-4xl font-black tracking-tighter text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Product not found
          </div>
          <p className="mt-4 text-base text-[var(--color-on-surface-variant)]">This item is missing from the current catalog feed.</p>
          <Link
            to="/"
            className="btn-primary mt-8 inline-flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  const stock = getStockCount(product);
  const rating = product.average_rating || 0;
  const canAdd = stock > 0;
  const requiresDeviceModel = isStickerProduct(product);
  const highlights = getHighlights(product, deliveryMode, deliveryTimeDisplay);

  return (
    <div className="container-standard py-6">
      <div className="md:hidden h-2" /> {/* Subtle spacer for mobile where title is centered */}

      <section className="mt-8 grid gap-8 xl:grid-cols-[1.1fr_0.9fr] animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="space-y-6">
          <div className="glass-card overflow-hidden p-1.5">
            <div className="relative overflow-hidden rounded-[28px] bg-[var(--color-surface-low)]">
              {/* Badge Row */}
              <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-4 p-6 pointer-events-none">
                <span className="rounded-full bg-[var(--color-secondary)] px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white shadow-lg backdrop-blur-md">
                  {product.category || 'Accessory'}
                </span>
                <span
                  className={`rounded-full px-4 py-2 text-[10px] font-black tracking-tight shadow-lg backdrop-blur-md ${stock <= 0
                      ? (Number(product.is_featured) === 1 || product.is_featured === true ? 'bg-indigo-600 text-white animate-pulse' : 'bg-red-500 text-white')
                      : stock <= LOW_STOCK_LIMIT
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-emerald-500 text-white'
                    }`}
                >
                  {stock <= 0 
                    ? (Number(product.is_featured) === 1 || product.is_featured === true ? 'COMING SOON' : 'SOLD OUT') 
                    : stock <= LOW_STOCK_LIMIT ? `ONLY ${stock} LEFT` : `${stock} AVAILABLE`}
                </span>
              </div>

              <div className="overflow-hidden bg-[var(--color-surface-low)]">
                <img
                  src={getProductImages(product)[activeImageIndex]}
                  alt={product.name}
                  className="h-[440px] w-full object-contain transition-all duration-700 sm:h-[540px]"
                />
              </div>

              {/* Multi-Image Thumbnails */}
              {getProductImages(product).length > 1 && (
                <div className="absolute inset-x-0 bottom-6 z-20 flex justify-center gap-2 px-6">
                  <div className="flex gap-2 overflow-x-auto no-scrollbar p-1 rounded-2xl bg-[var(--color-surface)]/10 backdrop-blur-md border border-[var(--color-surface-high)]">
                    {getProductImages(product).map((img, idx) => (
                      <button
                        key={idx}
                        onClick={() => setActiveImageIndex(idx)}
                        className={`relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl border-2 transition-all ${activeImageIndex === idx ? 'border-primary scale-105' : 'border-transparent opacity-60 hover:opacity-100'
                          }`}
                      >
                        <img src={img} alt={`Thumb ${idx}`} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="glass-card p-6 transition-transform hover:-translate-y-1">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-primary/10 text-primary">
                  <Truck className="h-5 w-5" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-on-surface)]/60" style={{ fontFamily: 'Inter, sans-serif' }}>Delivery</span>
              </div>
              <div className="mt-4 text-[17px] font-black tracking-tight text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>
                {deliveryTimeDisplay}
              </div>
              <p className="mt-2 text-[13px] font-medium leading-relaxed text-[var(--color-on-surface)]/60">{deliveryNoteDisplay}</p>
            </div>

            <div className="glass-card p-6 transition-transform hover:-translate-y-1">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-500">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-on-surface)]/60" style={{ fontFamily: 'Inter, sans-serif' }}>Quality</span>
              </div>
              <div className="mt-4 text-[17px] font-black tracking-tight text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>Freshly packed</div>
              <p className="mt-2 text-[13px] font-medium leading-relaxed text-[var(--color-on-surface)]/60">Stored and packed from managed inventory batches.</p>
            </div>

            <div className="glass-card p-6 transition-transform hover:-translate-y-1">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-sky-500/10 text-sky-500">
                  <Store className="h-5 w-5" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-on-surface)]/60" style={{ fontFamily: 'Inter, sans-serif' }}>Availability</span>
              </div>
              <div className="mt-4 text-[17px] font-black tracking-tight text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>{stock} units</div>
              <p className="mt-2 text-[13px] font-medium leading-relaxed text-[var(--color-on-surface)]/60">Exact inventory shown before cart and checkout.</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="glass-card p-8 sm:p-10">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-primary text-white px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-primary/20">
                Featured Product
              </span>
              {rating > 0 ? (
                <button 
                  onClick={() => setActiveTab('reviews')}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--color-surface-high)] px-4 py-2 text-xs font-black tracking-tight text-[var(--color-on-surface)] hover:bg-slate-50 transition-colors"
                >
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  {Number(rating).toFixed(1)} Rating
                </button>
              ) : (
                <button 
                  onClick={() => setActiveTab('reviews')}
                  className="inline-flex items-center gap-2 rounded-full border border-dashed border-primary/30 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary/5 transition-colors"
                >
                  <Star className="h-3.5 w-3.5" />
                  Rate Product
                </button>
              )}
            </div>

            <h1 className="mt-6 text-3xl font-black tracking-tighter text-[var(--color-on-surface)] md:text-5xl" style={{ fontFamily: 'Manrope, sans-serif' }}>{product.name}</h1>
            <p className="mt-5 text-[16px] font-medium leading-relaxed text-[var(--color-on-surface-variant)]">
              {product.description ||
                'A premium daily essential from the JDLX collection, designed for hyperlocal delivery and high-end reorders.'}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-5">
              <div className="text-4xl font-black tracking-tighter text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>₹{product.price}</div>
              <div className="inline-flex items-center gap-2 rounded-full bg-[#00E676]/10 px-4 py-1.5 text-[11px] font-black uppercase tracking-wider text-[#00E676] border border-[#00E676]/20">
                <BadgePercent className="h-4 w-4" />
                Best Local Pricing
              </div>
            </div>

            {product.category_note && (
              <div className="mt-6 flex items-start gap-3 rounded-2xl bg-primary/5 p-4 border border-primary/10">
                <div className="mt-1 p-1.5 rounded-lg bg-primary/10 text-primary">
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div className="text-[13px] font-bold text-primary/80 leading-relaxed uppercase tracking-tight italic">
                  {product.category_note}
                </div>
              </div>
            )}

            {/* Improved Return Policy Section */}
            <div className="mt-6 overflow-hidden rounded-[2rem] border border-[var(--color-surface-high)] bg-[var(--color-surface-low)] shadow-sm transition-all hover:shadow-md">
              <div className="flex items-center justify-between bg-[var(--color-surface)] px-6 py-4 border-b border-[var(--color-surface-high)]">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-[var(--color-surface-white)] p-2 text-emerald-500 shadow-sm">
                    <Undo2 className="w-4 h-4" />
                  </div>
                  <h4 className="text-[11px] font-black uppercase tracking-[0.1em] text-[var(--color-on-surface)]/80">Return & Replacement</h4>
                </div>
                <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-[9px] font-black uppercase text-emerald-500">Verified</span>
              </div>
              
              <div className="p-6">
                <div className="space-y-3">
                  {(product.final_return_policy || '7 Days Return Policy')
                    .split('\n')
                    .filter(p => p.trim())
                    .slice(0, 4) // Show only first 4 points initially
                    .map((point, i) => {
                      const cleanPoint = point.replace(/\*\*/g, '').replace(/^\s*[\*\-]\s*/, '').trim();
                      return (
                        <div key={i} className="flex items-start gap-3">
                          <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                          <p className="text-[13px] font-bold leading-snug text-emerald-900/80">{cleanPoint}</p>
                        </div>
                      );
                    })}
                  
                  {(product.final_return_policy || '').split('\n').filter(p => p.trim()).length > 2 && (
                    <div className="pt-2">
                      <button 
                        onClick={() => setShowPolicyModal(true)}
                        className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-emerald-600 hover:text-emerald-700 group"
                      >
                        See Policy Details
                        <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-1" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-8 overflow-hidden rounded-[28px] bg-[var(--color-secondary)] p-6 text-white shadow-xl shadow-secondary/10">
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-300">Inventory Status</div>
              <div className="mt-3 text-2xl font-black tracking-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>
                {stock <= 0 ? 'Currently unavailable' : stock <= LOW_STOCK_LIMIT ? `Only ${stock} left in stock` : `${stock} units in stock now`}
              </div>
              <div className="mt-2 text-[13px] font-medium opacity-70">
                Low stock alerts occur when quantity drops to 2 or below.
              </div>
            </div>

            <div className="mt-8">
              {quantity > 0 ? (
                <div className="flex items-center gap-4">
                  <div className="flex h-14 items-center gap-6 rounded-2xl bg-slate-900 px-6 shadow-xl shadow-slate-900/20">
                    <button
                      type="button"
                      onClick={() => {
                        if (quantity > 1) {
                          updateQuantity(product.id, quantity - 1);
                        } else {
                          removeFromCart(product.id);
                        }
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-white hover:bg-white/10 active:scale-90 transition-all"
                    >
                      <Minus className="h-5 w-5" />
                    </button>
                    <span className="min-w-[24px] text-center text-xl font-black text-white">
                      {quantity}
                    </span>
                    <button
                      type="button"
                      disabled={quantity >= stock}
                      onClick={() => updateQuantity(product.id, quantity + 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-white hover:bg-white/10 active:scale-90 disabled:opacity-30 transition-all"
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  </div>
                  <Link
                    to="/cart"
                    className="glass-icon-btn inline-flex flex-1 items-center justify-center rounded-2xl h-14 text-sm font-black tracking-tight text-[var(--color-on-surface)] transition hover:bg-[var(--color-surface-high)]"
                  >
                    View in Cart
                  </Link>
                  <button 
                    onClick={() => {
                        toggleWishlist(product);
                        toast.success(isInWishlist ? 'Removed from wishlist' : 'Added to wishlist');
                    }}
                    className={`h-14 w-14 flex-shrink-0 flex items-center justify-center rounded-2xl border transition-all ${
                        isInWishlist ? 'bg-red-50 border-red-100 text-red-500' : 'bg-slate-50 border-slate-100 text-slate-400 hover:text-red-500'
                    }`}
                  >
                    <Heart className="h-6 w-6" fill={isInWishlist ? 'currentColor' : 'none'} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <div className="grid flex-1 gap-4 sm:grid-cols-2">
                    {canAdd ? (
                      <>
                        {requiresDeviceModel && (
                          <div className="sm:col-span-2">
                            <DeviceModelSelector
                              value={deviceModel}
                              onChange={setDeviceModel}
                              required
                            />
                          </div>
                        )}
                        {product.category_id === 7 && deliveryMode === 'quick' && (
                          <div className="sm:col-span-2 mb-4 p-4 rounded-3xl bg-primary/5 border border-primary/10 space-y-3 animate-in fade-in slide-in-from-top-4 duration-500">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center shadow-sm">
                                  <Truck className="w-5 h-5 text-primary" />
                                </div>
                                <div>
                                  <p className="text-[13px] font-black text-slate-900 uppercase tracking-tight">Professional Fitting</p>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Doorstep Installation</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-[15px] font-black text-primary">₹{product.sub_category?.toLowerCase().includes('uv glass') ? 80 : 40}</span>
                                <button
                                  type="button"
                                  onClick={toggleFitting}
                                  className={`w-12 h-7 rounded-full transition-all relative ${fitting ? 'bg-primary' : 'bg-slate-200'}`}
                                >
                                  <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${fitting ? 'right-1' : 'left-1'}`} />
                                </button>
                              </div>
                            </div>
                            {fitting && (
                              <p className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full w-fit flex items-center gap-2">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Expert technician will apply this at your home
                              </p>
                            )}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const selectedDeviceModel = getDeviceModelValue(deviceModel);
                            if (requiresDeviceModel && !selectedDeviceModel) {
                              toast.error('Select Your Device Model');
                              return;
                            }
                            addToCart({ ...product, device_model: selectedDeviceModel || null, fitting: fitting });
                            toast.success('Added to cart');
                          }}
                          className="btn-primary h-14 w-full shadow-xl shadow-primary/20 active:scale-95 transition-all"
                        >
                          <ShoppingCart className="h-5 w-5" />
                          Add to Cart
                        </button>
                        <Link
                          to="/cart"
                          className="glass-icon-btn inline-flex items-center justify-center rounded-2xl h-14 text-sm font-black tracking-tight text-[var(--color-on-surface)] transition hover:bg-[var(--color-surface-high)]"
                        >
                          Go to Cart
                        </Link>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={isNotified}
                          onClick={async () => {
                            if (isNotified) return;
                            
                            const user = useStore.getState().user;
                            let email = user?.email;
                            
                            if (!email) {
                              email = window.prompt("Enter your email to get notified when this is back in stock:");
                              if (!email || !email.includes('@')) {
                                toast.error("Valid email is required");
                                return;
                              }
                            }
                            
                            const res = await useStore.getState().registerForNotification(product.id, email);
                            if (res.success) {
                              toast.success(res.message);
                              setIsNotified(true);
                            } else {
                              toast.error(res.message);
                              if (res.message.includes('already')) {
                                setIsNotified(true);
                              }
                            }
                          }}
                          className={`h-14 w-full rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl transition-all flex items-center justify-center gap-3 active:scale-95 ${
                            isNotified 
                              ? 'bg-emerald-500 text-white shadow-emerald-500/20 cursor-default' 
                              : 'bg-amber-400 text-slate-950 shadow-amber-400/20 hover:bg-amber-500'
                          }`}
                        >
                          {isNotified ? (
                            <>
                              <CheckCircle2 className="h-5 w-5" />
                              Notified Successfully
                            </>
                          ) : (
                            <>
                              <Bell className="h-5 w-5" />
                              Notify Me When Available
                            </>
                          )}
                        </button>
                        <Link
                          to="/"
                          className="glass-icon-btn inline-flex items-center justify-center rounded-2xl h-14 text-sm font-black tracking-tight text-[var(--color-on-surface)] transition hover:bg-[var(--color-surface-high)] gap-2 group"
                        >
                          Browse More
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </Link>
                      </>
                    )}
                  </div>
                  <button 
                    onClick={() => {
                        toggleWishlist(product);
                        toast.success(isInWishlist ? 'Removed from wishlist' : 'Added to wishlist');
                    }}
                    className={`h-14 w-14 flex-shrink-0 flex items-center justify-center rounded-2xl border transition-all ${
                        isInWishlist ? 'bg-red-50 border-red-100 text-red-500' : 'bg-slate-50 border-slate-100 text-slate-400 hover:text-red-500'
                    }`}
                  >
                    <Heart className="h-6 w-6" fill={isInWishlist ? 'currentColor' : 'none'} />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="glass-card p-8">
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {['overview', 'highlights', 'reviews'].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-full px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.15em] transition-all ${activeTab === tab ? 'bg-[var(--color-secondary)] text-white shadow-lg' : 'bg-[var(--color-surface-low)] text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-high)]'
                    }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === 'overview' ? (
              <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                <div className="rounded-[2rem] p-6 bg-emerald-500/5 border border-emerald-500/10 flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 shadow-sm">
                       <Undo2 className="w-5 h-5" />
                    </div>
                    <h4 className="text-[11px] font-black text-emerald-500 uppercase tracking-widest">Return Policy</h4>
                  </div>
                  <div className="space-y-2">
                    {(product.final_return_policy || '7 Days Return Policy')
                      .split('\n')
                      .filter(p => p.trim())
                      .slice(0, 2)
                      .map((point, i) => {
                        const cleanPoint = point.replace(/\*\*/g, '').replace(/^\s*[\*\-]\s*/, '').trim();
                        return (
                          <div key={i} className="flex items-start gap-2.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                            <p className="text-[13px] font-bold text-[var(--color-on-surface)]/70 leading-tight line-clamp-1">{cleanPoint}</p>
                          </div>
                        );
                      })}
                    <button 
                        onClick={() => setShowPolicyModal(true)}
                        className="mt-2 text-[10px] font-black uppercase tracking-widest text-emerald-500 hover:underline"
                    >
                        + See More Details
                    </button>
                  </div>
                </div>
                
                <div className="rounded-[2rem] p-6 bg-blue-500/5 border border-blue-500/10 flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 shadow-sm">
                       <Truck className="w-5 h-5" />
                    </div>
                    <h4 className="text-[11px] font-black text-blue-500 uppercase tracking-widest">Delivery Time</h4>
                  </div>
                  <p className="text-sm font-black text-[var(--color-on-surface)] bg-[var(--color-surface-white)] px-4 py-2 rounded-xl border border-[var(--color-surface-high)] inline-block">
                    {deliveryTimeDisplay}
                  </p>
                  <p className="text-[11px] font-bold text-blue-500/60 leading-relaxed uppercase tracking-tight italic">
                    {deliveryMode === 'quick' ? 'Hyperlocal dispatch from the active dark store.' : 'Reliable fulfillment from our central warehouse.'}
                  </p>
                </div>
              </div>
            ) : null}

            {activeTab === 'overview' ? (
              <div className="mt-8 space-y-4 text-[14px] font-medium leading-relaxed text-[var(--color-on-surface-variant)]">
                <p>
                  This product page is part of our Luxury Grade interface, designed to provide absolute clarity on stock levels and delivery speed before purchase.
                </p>
                <div className="flex flex-col gap-2 pt-4 border-t border-[var(--color-surface-high)]">
                  <div className="flex justify-between">
                    <span className="font-bold">Category</span>
                    <span className="text-[var(--color-on-surface)]">{product.category || 'Accessory'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-bold">Delivery Time</span>
                    <span className="text-[var(--color-on-surface)]">{deliveryTimeDisplay}</span>
                  </div>
                  {product.category_note && (
                    <div className="mt-4 pt-4 border-t border-[var(--color-surface-high)]">
                      <span className="font-bold block mb-1">Important Note</span>
                      <p className="text-primary/70 font-bold italic">{product.category_note}</p>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {activeTab === 'highlights' ? (
              <ul className="mt-8 space-y-3">
                {highlights.map((highlight) => (
                  <li key={highlight} className="flex items-center gap-3 rounded-2xl bg-[var(--color-surface-low)] px-5 py-4 text-[13px] font-bold text-[var(--color-on-surface-variant)]">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    {highlight}
                  </li>
                ))}
              </ul>
            ) : null}

            {activeTab === 'reviews' ? (
              <div className="mt-8">
                <ProductReviews productId={product.id} />
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* Policy Details Modal */}
      {showPolicyModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
          <div 
            className="absolute inset-0 bg-slate-900/80 backdrop-blur-md animate-in fade-in duration-300"
            onClick={() => setShowPolicyModal(false)}
          />
          <div className="relative w-full max-w-lg bg-white rounded-[2.5rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="bg-emerald-500 p-8 text-white relative">
                <button 
                    onClick={() => setShowPolicyModal(false)}
                    className="absolute top-6 right-6 p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                >
                    <X size={20} />
                </button>
                <div className="flex items-center gap-4 mb-2">
                    <div className="p-3 bg-white/20 rounded-2xl">
                        <Undo2 size={24} />
                    </div>
                    <div>
                        <h3 className="text-2xl font-black tracking-tight">Return Policy</h3>
                        <p className="text-emerald-100 text-xs font-bold uppercase tracking-widest">Transparency Commitment</p>
                    </div>
                </div>
            </div>
            <div className="p-8 max-h-[60vh] overflow-y-auto no-scrollbar bg-white">
                <div className="space-y-4">
                    {(product.final_return_policy || '7 Days Return Policy')
                      .split('\n')
                      .filter(p => p.trim())
                      .map((point, i) => {
                        const cleanPoint = point.replace(/\*\*/g, '').replace(/^\s*[\*\-]\s*/, '').trim();
                        return (
                          <div key={i} className="flex items-start gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0 shadow-sm shadow-emerald-500/50" />
                            <p className="text-sm font-bold text-slate-700 leading-relaxed">{cleanPoint}</p>
                          </div>
                        );
                      })}
                </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100 text-center">
                <button 
                    onClick={() => setShowPolicyModal(false)}
                    className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-slate-900/20 active:scale-95 transition-all"
                >
                    I Understand
                </button>
            </div>
          </div>
        </div>
      )}

      {/* Recommendations Section */}
      <ProductRecommendationScroller currentProduct={product} allProducts={products} />
    </div>
  );
}

function ProductRecommendationScroller({ currentProduct, allProducts }) {
  const recommendations = allProducts
    .filter(p => p.id !== currentProduct.id && p.category === currentProduct.category)
    .slice(0, 6);

  if (recommendations.length === 0) return null;

  return (
    <div className="mt-20 border-t border-[var(--color-surface-high)] pt-16">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
        <div>
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-primary mb-3 block">From the same aisle</span>
          <h2 className="text-3xl font-black tracking-tighter text-slate-900" style={{ fontFamily: 'Manrope, sans-serif' }}>You May Also Like</h2>
        </div>
        <Link to="/" className="text-sm font-bold text-primary flex items-center gap-2 group">
          View Collection <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
        </Link>
      </div>

      <div className="flex gap-6 overflow-x-auto pb-8 no-scrollbar reveal-staggered">
        {recommendations.map(p => (
          <Link
            key={p.id}
            to={`/product/${p.id}`}
            className="flex-shrink-0 w-64 glass-card rounded-[32px] overflow-hidden group hover:-translate-y-2 transition-all duration-500"
          >
            <div className="aspect-square bg-slate-50 overflow-hidden">
              <img
                src={getProductImage(p)}
                alt={p.name}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
              />
            </div>
            <div className="p-6">
              <h4 className="font-bold text-slate-900 truncate mb-1">{p.name}</h4>
              
              {p.average_rating > 0 && (
                <div className="mb-3 flex items-center gap-1.5">
                  <div className="flex items-center gap-0.5 text-amber-400">
                    <Star size={12} fill="currentColor" />
                  </div>
                  <span className="text-[11px] font-black text-slate-700">
                    {Number(p.average_rating).toFixed(1)}
                  </span>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">
                    ({p.total_reviews})
                  </span>
                </div>
              )}

              <div className="text-lg font-black text-primary">₹{p.price}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
