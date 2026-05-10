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

  const deliveryType = deliveryMode === 'quick' ? 'quick delivery' : 'secure fulfillment';
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
    <div className="reveal-staggered">
      <section className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr] animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="space-y-6">
          <div className="md:glass-card overflow-hidden md:p-1.5 -mx-4 md:mx-0">
            <div className="relative overflow-hidden md:rounded-[28px] bg-[var(--color-surface-low)] md:bg-transparent">
              {/* Badge Row - Hidden on mobile, shown on desktop */}
              <div className="absolute inset-x-0 top-0 z-10 hidden md:flex items-center justify-between gap-4 p-6 pointer-events-none">
                <span className="rounded-full bg-[var(--color-secondary)] px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white shadow-lg backdrop-blur-md">
                  {product.category || 'Accessory'}
                </span>
                <span
                  className={`rounded-full px-4 py-2 text-[10px] font-black tracking-tight shadow-lg backdrop-blur-md ${stock <= 0
                      ? (Number(product.is_featured) === 1 || product.is_featured === true ? 'bg-primary text-slate-950 animate-pulse' : 'bg-red-500 text-white')
                      : stock <= LOW_STOCK_LIMIT
                        ? 'bg-primary text-slate-950'
                        : 'bg-emerald-500 text-white'
                    }`}
                >
                  {stock <= 0 
                    ? (Number(product.is_featured) === 1 || product.is_featured === true ? 'COMING SOON' : 'SOLD OUT') 
                    : stock <= LOW_STOCK_LIMIT ? `ONLY ${stock} LEFT` : `${stock} AVAILABLE`}
                </span>
              </div>

              {/* Mobile Badges - Overlaid on image */}
              <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 md:hidden">
                <span className="bg-slate-900/90 backdrop-blur-md text-white text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest border border-white/10">
                  {product.category || 'General'}
                </span>
                {stock <= LOW_STOCK_LIMIT && stock > 0 && (
                   <span className="bg-primary text-slate-900 text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest border border-amber-500/20 shadow-lg">
                      Only {stock} Left
                   </span>
                )}
                {stock <= 0 && (
                   <span className="bg-red-500 text-white text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest border border-red-600 shadow-lg animate-pulse">
                      Sold Out
                   </span>
                )}
              </div>

              <div className="overflow-hidden">
                <img
                  src={getProductImages(product)[activeImageIndex]}
                  alt={product.name}
                  className="h-[380px] w-full object-contain transition-all duration-700 sm:h-[540px] md:rounded-[28px]"
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
                        className={`relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl border-2 transition-all ${activeImageIndex === idx ? 'border-amber-400 scale-105' : 'border-transparent opacity-60 hover:opacity-100'
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
            {/* Trust & Social Proof Strip */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {rating > 0 && (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-primary border border-amber-400/20">
                  <Star className="h-3 w-3 fill-amber-400" />
                  {Number(rating).toFixed(1)} Rating
                </div>
              )}
              <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-primary border border-amber-400/20">
                <Zap className="h-3 w-3 fill-amber-400" />
                Popular Choice
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-600 border border-emerald-500/20">
                <ShieldCheck className="h-3 w-3" />
                Quality Checked
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-900/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-900 border border-slate-900/10">
                <Clock className="h-3 w-3" />
                Secure Checkout
              </div>
            </div>

            <h1 className="text-3xl font-black tracking-tighter text-[var(--color-on-surface)] md:text-5xl leading-[1.1] mb-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
              {product.name}
            </h1>
            <p className="text-sm font-bold text-[var(--color-on-surface-variant)]/60 uppercase tracking-[0.2em] mb-6">
              {product.category || 'Premium Accessory'}
            </p>
            
            <div className="mt-6 flex items-baseline gap-4 p-6 rounded-[2.5rem] bg-[var(--color-surface-low)] border border-[var(--color-surface-high)] shadow-inner">
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-[var(--color-on-surface)]/40 uppercase tracking-widest mb-1">Current Price</span>
                <div className="text-4xl md:text-5xl font-black tracking-tighter text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>₹{product.price}</div>
              </div>
              {product.mrp > product.price && (
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1">MRP</span>
                  <div className="text-xl md:text-2xl text-[var(--color-on-surface)]/30 line-through font-bold">₹{product.mrp}</div>
                </div>
              )}
              <div className="ml-auto">
                <div className="inline-flex items-center gap-2 rounded-2xl bg-[#00E676] px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white shadow-lg shadow-[#00E676]/30 animate-pulse">
                  <BadgePercent className="h-4 w-4" />
                  Best Deal
                </div>
              </div>
            </div>

            <div className="mt-8 space-y-4">
              <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400">Description</h3>
              <p className="text-[16px] md:text-lg font-medium leading-relaxed text-[var(--color-on-surface-variant)]">
                {product.description ||
                  'Premium edge-to-edge protection with smooth touch response and durable daily protection.'}
              </p>
            </div>

            {product.category_note && (
              <div className="mt-8 flex items-start gap-4 rounded-[2rem] bg-primary/5 p-5 border border-amber-400/10">
                <div className="mt-1 p-2 rounded-xl bg-primary/20 text-primary">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-[11px] font-black uppercase tracking-widest text-primary mb-1">Pro Tip</h4>
                  <p className="text-[14px] font-bold text-amber-900/70 leading-relaxed italic">
                    {product.category_note}
                  </p>
                </div>
              </div>
            )}

            {/* Improved Return Policy Section */}
            <div className="mt-8 overflow-hidden rounded-[2.5rem] border border-[var(--color-surface-high)] bg-[var(--color-surface-low)] shadow-sm transition-all hover:shadow-md">
              <div className="flex items-center justify-between bg-[var(--color-surface-white)] px-6 py-5 border-b border-[var(--color-surface-high)]">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-emerald-500/10 p-2.5 text-emerald-600 shadow-sm">
                    <Undo2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-[12px] font-black uppercase tracking-[0.1em] text-slate-900">Return Policy</h4>
                    <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest">Verified Terms</p>
                  </div>
                </div>
                <button 
                   onClick={() => setShowPolicyModal(true)}
                   className="rounded-full bg-slate-900 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white shadow-lg shadow-slate-900/20 active:scale-95 transition-all"
                >
                  View Details
                </button>
              </div>
              
              <div className="p-6">
                <div className="grid gap-3">
                  {(product.final_return_policy || '7 Days Return Policy')
                    .split('\n')
                    .filter(p => p.trim())
                    .slice(0, 3)
                    .map((point, i) => {
                      const cleanPoint = point.replace(/\*\*/g, '').replace(/^\s*[\*\-]\s*/, '').trim();
                      return (
                        <div key={i} className="flex items-center gap-3 p-3 rounded-2xl bg-[var(--color-surface-white)] border border-[var(--color-surface-high)]">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                          <p className="text-[12px] font-bold text-slate-700 leading-tight truncate">{cleanPoint}</p>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-4">
              <div className="rounded-[2rem] bg-primary p-6 text-slate-950 shadow-xl shadow-primary/20">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck size={16} className="text-slate-900/40" />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-900/40">Inventory Status</span>
                </div>
                <div className="text-xl font-black tracking-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>
                  {stock <= 0 ? 'Out of Stock' : stock <= LOW_STOCK_LIMIT ? `Only ${stock} Left` : 'Fully Stocked'}
                </div>
                <p className="mt-1 text-[11px] font-medium opacity-70">
                   {stock > 0 ? 'Ready for secure fulfillment' : 'Check back soon for restock'}
                </p>
              </div>
              
              <div className="rounded-[2rem] bg-slate-900 p-6 text-white shadow-xl shadow-slate-900/20">
                <div className="flex items-center gap-2 mb-3">
                  <Zap size={16} className="text-amber-400" />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Dispatch Speed</span>
                </div>
                <div className="text-xl font-black tracking-tight" style={{ fontFamily: 'Manrope, sans-serif' }}>
                  {deliveryTimeDisplay}
                </div>
                <p className="mt-1 text-[11px] font-medium opacity-70">
                   {deliveryMode === 'quick' ? 'Fast Darkstore Pick' : 'Standard Fulfillment'}
                </p>
              </div>
            </div>

            <div className="mt-10 md:block hidden">
              {quantity > 0 ? (
                <div className="flex items-center gap-4">
                  <div className="flex h-16 items-center gap-8 rounded-3xl bg-slate-900 px-8 shadow-2xl shadow-slate-900/30">
                    <button
                      type="button"
                      onClick={() => {
                        if (quantity > 1) {
                          updateQuantity(product.id, quantity - 1);
                        } else {
                          removeFromCart(product.id);
                        }
                      }}
                      className="flex h-10 w-10 items-center justify-center rounded-full text-white hover:bg-white/10 active:scale-90 transition-all"
                    >
                      <Minus className="h-6 w-6" />
                    </button>
                    <span className="min-w-[30px] text-center text-2xl font-black text-white">
                      {quantity}
                    </span>
                    <button
                      type="button"
                      disabled={quantity >= stock}
                      onClick={() => updateQuantity(product.id, quantity + 1)}
                      className="flex h-10 w-10 items-center justify-center rounded-full text-white hover:bg-white/10 active:scale-90 disabled:opacity-30 transition-all"
                    >
                      <Plus className="h-6 w-6" />
                    </button>
                  </div>
                  <Link
                    to="/cart"
                    className="inline-flex flex-1 items-center justify-center rounded-3xl h-16 text-sm font-black uppercase tracking-widest text-slate-950 bg-primary shadow-xl shadow-primary/20 hover:bg-primary/90 transition-all hover:-translate-y-1 active:scale-95"
                  >
                    View in Cart
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {requiresDeviceModel && (
                    <div className="p-6 rounded-[2rem] bg-[var(--color-surface-low)] border border-[var(--color-surface-high)]">
                       <DeviceModelSelector
                         value={deviceModel}
                         onChange={setDeviceModel}
                         required
                       />
                       
                       {/* Compatibility Chips */}
                       <div className="mt-4">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Compatible With</p>
                          <div className="flex flex-wrap gap-2">
                             {['iPhone 15 Pro', 'iPhone 14', 'S24 Ultra', 'OnePlus 12'].map(model => (
                                <span key={model} className="px-3 py-1 rounded-full bg-white border border-slate-100 text-[10px] font-bold text-slate-600">✓ {model}</span>
                             ))}
                          </div>
                       </div>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-4">
                    {canAdd ? (
                      <>
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
                          className="flex-[2] btn-primary h-16 rounded-[2rem] shadow-2xl shadow-primary/30 active:scale-95 transition-all text-sm uppercase tracking-widest flex items-center justify-center gap-3 bg-gradient-to-r from-slate-900 to-slate-800 border-none"
                        >
                          <ShoppingCart className="h-5 w-5" />
                          Add to Cart
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const selectedDeviceModel = getDeviceModelValue(deviceModel);
                            if (requiresDeviceModel && !selectedDeviceModel) {
                              toast.error('Select Your Device Model');
                              return;
                            }
                            addToCart({ ...product, device_model: selectedDeviceModel || null, fitting: fitting });
                            navigate('/cart');
                          }}
                          className="flex-1 h-16 rounded-[2rem] bg-primary text-slate-950 font-black text-sm uppercase tracking-widest shadow-xl shadow-primary/20 hover:bg-primary/90 transition-all active:scale-95 flex items-center justify-center"
                        >
                          Buy Now
                        </button>
                        <button 
                          onClick={() => {
                              toggleWishlist(product);
                              toast.success(isInWishlist ? 'Removed from wishlist' : 'Added to wishlist');
                          }}
                          className={`h-16 w-16 flex-shrink-0 flex items-center justify-center rounded-[2rem] border-2 transition-all active:scale-90 ${
                              isInWishlist ? 'bg-red-50 border-red-100 text-red-500' : 'bg-slate-50 border-slate-100 text-slate-400 hover:text-red-500'
                          }`}
                        >
                          <Heart className="h-7 w-7" fill={isInWishlist ? 'currentColor' : 'none'} />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={isNotified}
                        onClick={async () => {
                          if (isNotified) return;
                          const res = await useStore.getState().registerForNotification(product.id, useStore.getState().user?.email);
                          if (res.success) {
                            toast.success(res.message);
                            setIsNotified(true);
                          }
                        }}
                        className={`h-16 w-full rounded-[2rem] font-black text-sm uppercase tracking-widest shadow-xl transition-all flex items-center justify-center gap-3 active:scale-95 ${
                          isNotified 
                            ? 'bg-emerald-500 text-white shadow-emerald-500/20' 
                            : 'bg-primary text-slate-950 shadow-primary/20 hover:bg-amber-500'
                        }`}
                      >
                         {isNotified ? <CheckCircle2 size={24} /> : <Bell size={24} />}
                         {isNotified ? 'Notification Active' : 'Notify Me on Restock'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Mobile-only Customization & Compatibility Section */}
            <div className="md:hidden space-y-6">
               {requiresDeviceModel && (
                 <div className="p-6 rounded-[2.5rem] bg-[var(--color-surface-low)] border border-[var(--color-surface-high)] space-y-4">
                    <div id="device-model-selector">
                       <DeviceModelSelector
                         value={deviceModel}
                         onChange={setDeviceModel}
                         required
                       />
                    </div>
                    <div>
                       <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Certified Compatibility</p>
                       <div className="flex flex-wrap gap-1.5">
                          {['iPhone 15 Pro', 'iPhone 14', 'S24 Ultra'].map(model => (
                             <span key={model} className="px-3 py-1 rounded-full bg-white border border-slate-100 text-[9px] font-bold text-slate-500">{model}</span>
                          ))}
                       </div>
                    </div>
                 </div>
               )}
               {product.category_id === 7 && deliveryMode === 'quick' && (
                  <div className="p-5 rounded-[2rem] bg-amber-50 border border-amber-100 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center shadow-sm text-primary">
                        <Truck className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-[13px] font-black text-slate-900 uppercase tracking-tight">Expert Fitting</p>
                        <p className="text-[10px] font-bold text-primary uppercase tracking-widest">Doorstep Installation</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                       <span className="text-sm font-black text-slate-900">₹{product.sub_category?.toLowerCase().includes('uv glass') ? 80 : 40}</span>
                        <button
                          type="button"
                          onClick={toggleFitting}
                          className={`w-14 h-8 rounded-full transition-all relative ${fitting ? 'bg-primary' : 'bg-slate-200'}`}
                        >
                          <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-sm transition-all ${fitting ? 'right-1' : 'left-1'}`} />
                        </button>
                    </div>
                  </div>
               )}
             </div>
           </div>

           <div className="glass-card p-4 md:p-8 rounded-[2.5rem]">
            <div className="flex p-1.5 bg-slate-100 rounded-full gap-1 mb-8">
              {['overview', 'highlights', 'reviews'].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 rounded-full py-3 text-[11px] font-black uppercase tracking-[0.2em] transition-all duration-300 ${
                    activeTab === tab 
                      ? 'bg-slate-900 text-white shadow-lg' 
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === 'overview' && (
              <div className="space-y-8 animate-in fade-in duration-500">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="rounded-[2rem] p-6 bg-primary/5 border border-amber-400/10">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                        <Truck size={20} />
                      </div>
                      <h4 className="text-xs font-black uppercase tracking-widest text-primary">Fulfillment</h4>
                    </div>
                    <p className="text-sm font-bold text-slate-800 leading-relaxed">
                      Safe & trusted order fulfillment dispatched directly to your location.
                    </p>
                  </div>
                  <div className="rounded-[2rem] p-6 bg-emerald-500/5 border border-emerald-500/10">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-600">
                        <ShieldCheck size={20} />
                      </div>
                      <h4 className="text-xs font-black uppercase tracking-widest text-emerald-600">Quality Checked</h4>
                    </div>
                    <p className="text-sm font-bold text-slate-800 leading-relaxed">
                      Inspected before dispatch for quality assurance and premium protection.
                    </p>
                  </div>
                </div>

                <div className="p-8 rounded-[2rem] bg-slate-50 border border-slate-100">
                   <p className="text-[15px] font-medium leading-relaxed text-slate-600">
                     {product.description || `A premium daily essential from the JDLX collection, designed for ${deliveryMode === 'quick' ? 'hyperlocal delivery' : 'reliable fulfillment'} and high-end reorders.`}
                   </p>
                </div>
              </div>
            )}

            {activeTab === 'highlights' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in fade-in duration-500">
                {highlights.map((highlight) => (
                  <div key={highlight} className="flex items-center gap-4 p-5 rounded-3xl bg-white border border-slate-100 shadow-sm hover:border-primary/20 transition-all group">
                    <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center text-white shrink-0 group-hover:scale-110 transition-transform">
                      <CheckCircle2 size={14} />
                    </div>
                    <span className="text-[13px] font-bold text-slate-700">{highlight}</span>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'reviews' && (
              <div className="animate-in fade-in duration-500">
                <ProductReviews productId={product.id} />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Policy Details Modal */}
      {showPolicyModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
          <div 
            className="absolute inset-0 bg-slate-900/90 backdrop-blur-md animate-in fade-in duration-300"
            onClick={() => setShowPolicyModal(false)}
          />
          <div className="relative w-full max-w-lg bg-white rounded-[2.5rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="bg-slate-900 p-8 text-white relative">
                <button 
                    onClick={() => setShowPolicyModal(false)}
                    className="absolute top-6 right-6 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                >
                    <X size={20} />
                </button>
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-white/10 rounded-2xl">
                        <ShieldCheck size={24} className="text-emerald-400" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-black tracking-tight">Purchase Protection</h3>
                        <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Verified by JDLX Mobile</p>
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
                            <div className="w-2 h-2 rounded-full bg-slate-900 mt-1.5 shrink-0" />
                            <p className="text-[13px] font-bold text-slate-700 leading-relaxed">{cleanPoint}</p>
                          </div>
                        );
                      })}
                </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100">
                <button 
                    onClick={() => setShowPolicyModal(false)}
                    className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl active:scale-95 transition-all"
                >
                    Got it, Proceed
                </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Sticky Bottom Action Bar */}
      <div className="fixed bottom-[90px] inset-x-0 z-[100] px-4 md:hidden">
         <div className="bg-slate-950/90 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-3 shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-full duration-700">
            {quantity > 0 ? (
               <div className="flex items-center gap-3 flex-1">
                  <div className="flex items-center justify-between bg-white/10 rounded-full p-1 gap-4">
                     <button
                        onClick={() => {
                          if (quantity > 1) {
                            updateQuantity(product.id, quantity - 1);
                          } else {
                            removeFromCart(product.id);
                          }
                        }}
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-90 transition-all"
                     >
                        <Minus size={18} />
                     </button>
                     <span className="text-xl font-black text-white">{quantity}</span>
                     <button
                        disabled={quantity >= stock}
                        onClick={() => updateQuantity(product.id, quantity + 1)}
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-90 disabled:opacity-30 transition-all"
                     >
                        <Plus size={18} />
                     </button>
                  </div>
                  <Link to="/cart" className="flex-1 h-12 flex items-center justify-center gap-2 bg-primary text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg shadow-primary/30 active:scale-95 transition-all">
                    View Cart
                    <ArrowRight size={14} />
                  </Link>
               </div>
            ) : (
               <div className="flex items-center gap-2 flex-1">
                  {canAdd ? (
                    <button
                      onClick={() => {
                        const selectedDeviceModel = getDeviceModelValue(deviceModel);
                        if (requiresDeviceModel && !selectedDeviceModel) {
                          toast.error('Select Model First');
                          const el = document.getElementById('device-model-selector');
                          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          return;
                        }
                        addToCart({ ...product, device_model: selectedDeviceModel || null, fitting: fitting });
                        toast.success('Added to cart');
                      }}
                      className="flex-1 h-12 flex items-center justify-center gap-2 bg-white text-slate-950 rounded-full text-[11px] font-black uppercase tracking-widest shadow-lg active:scale-95 transition-all"
                    >
                      <ShoppingCart size={16} />
                      Add to Cart
                    </button>
                  ) : (
                    <button
                      disabled={isNotified}
                      onClick={async () => {
                        if (isNotified) return;
                        const user = useStore.getState().user;
                        let email = user?.email || window.prompt("Enter email for notification:");
                        if (email && email.includes('@')) {
                           const res = await useStore.getState().registerForNotification(product.id, email);
                           if (res.success) {
                              setIsNotified(true);
                              toast.success('We will notify you!');
                           }
                        }
                      }}
                      className={`flex-1 h-12 flex items-center justify-center gap-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
                         isNotified ? 'bg-emerald-500 text-white' : 'bg-primary text-slate-950'
                      }`}
                    >
                      <Bell size={14} />
                      {isNotified ? 'Notified' : 'Notify Me'}
                    </button>
                  )}
               </div>
            )}
          </div>
        </div>

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
