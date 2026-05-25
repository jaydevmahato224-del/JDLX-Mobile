import { AlertCircle, ArrowLeft, ArrowRight, BadgePercent, Bell, CheckCircle2, ChevronRight, Clock, Heart, Minus, Plus, Share2, ShieldCheck, ShoppingCart, Star, Store, Truck, Zap, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useStore } from '../../store/useStore';
import { resolveMediaUrl, API_BASE_URL } from '../../config';
import { trackViewItem, trackAddToCart } from '../../utils/analytics';
import { shareProduct } from '../../utils/share';
import SEO from '../../components/SEO';
import ProductReviews from '../../components/ProductReviews';
import ShareModal from '../../components/ShareModal';
import DeviceModelSelector from '../../components/DeviceModelSelector';
import { getDeviceModelValue, isStickerProduct } from '../../utils/stickerCustomization';

import { getProductUrl } from '../../utils/productSlug';
import { useAnalyticsContext } from '../../context/AnalyticsContext';

const LOW_STOCK_LIMIT = 2;
const FALLBACK_IMAGE = 'https://placehold.co/800x800/f8fafc/0f172a?text=JDLX';

function normalizeProductsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.products || payload?.items || payload?.data || [];
}

function getProductImages(product) {
  let images = product?.image_url || product?.images || product?.image || product?.thumbnail || product?.photo || [];
  if (!images || (Array.isArray(images) && images.length === 0)) return [FALLBACK_IMAGE];
  if (typeof images === 'string') {
    if (images.startsWith('[')) {
      try {
        const parsed = JSON.parse(images);
        images = Array.isArray(parsed) && parsed.length ? parsed : [images];
      } catch { images = [images]; }
    } else { images = [images]; }
  }
  return images.map(img => typeof img === 'string' ? resolveMediaUrl(img) : FALLBACK_IMAGE);
}

export default function ProductDetails() {
  const { id, token, slugToken } = useParams();
  const navigate = useNavigate();
  const { products: storeProducts, fetchProducts, addToCart, cart, wishlist, toggleWishlist, updateQuantity, removeFromCart, deliveryMode, nearestStoreId, user, registerForNotification } = useStore();
  const { trackEvent } = useAnalyticsContext();
  
  const [remoteProducts, setRemoteProducts] = useState([]);
  const [tokenProduct, setTokenProduct] = useState(null);
  const [loadingToken, setLoadingToken] = useState(!!(token || slugToken));
  const [activeTab, setActiveTab] = useState('overview');
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [deviceModel, setDeviceModel] = useState('');
  const [isNotified, setIsNotified] = useState(false);
  const [fitting, setFitting] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [showShareModal, setShowShareModal] = useState(false);

  // Extract token from either :token or :slugToken (e.g. iphone-15-Ag9Kx2Pq7R -> Ag9Kx2Pq7R)
  const resolvedToken = useMemo(() => {
    const rawToken = token || slugToken;
    if (!rawToken) return null;
    
    // Handle slugified tokens by taking the last part after the last dash
    if (rawToken.includes('-')) {
      const parts = rawToken.split('-');
      const lastPart = parts[parts.length - 1];
      
      // If last part is numeric, it's an ID fallback
      if (lastPart && /^\d+$/.test(lastPart)) return lastPart;
      
      // If last part looks like a share_token (length >= 8), return it
      if (lastPart && lastPart.length >= 8) return lastPart;
      
      // Otherwise return the whole thing as a possible seo_slug
      return rawToken;
    }
    return rawToken;
  }, [token, slugToken]);

  const products = useMemo(() => (storeProducts?.length ? storeProducts : remoteProducts), [storeProducts, remoteProducts]);
  
  const product = useMemo(() => {
    if (id) return products.find((p) => String(p.id) === String(id));
    if (resolvedToken) {
      console.log('[DEBUG] Resolving Token:', resolvedToken);
      // 1. Match by share_token
      let p = products.find((p) => p.share_token === resolvedToken);
      // 2. Match by seo_slug
      if (!p) p = products.find((p) => p.seo_slug === resolvedToken);
      // 3. Match by numeric ID (fallback)
      if (!p && /^\d+$/.test(resolvedToken)) {
        p = products.find((p) => String(p.id) === String(resolvedToken));
      }
      // 4. Match by full slugToken if different
      const rawToken = token || slugToken;
      if (!p && rawToken && rawToken !== resolvedToken) {
         p = products.find((p) => p.seo_slug === rawToken);
      }
      
      if (p) console.log('[DEBUG] Found Product:', p.name, '(ID:', p.id, ')');
      return p || tokenProduct;
    }
    return null;
  }, [id, resolvedToken, token, slugToken, products, tokenProduct]);

  // TASK 5: Redirect from /product/:id to secure slug route
  // Aggressive replacement to ensure browser bar updates instantly
  useEffect(() => {
    if (id && product && !loadingToken) {
      const secureUrl = getProductUrl(product);
      if (!window.location.pathname.includes('/p/')) {
        console.log('[DEBUG] Aggressive Redirect to:', secureUrl);
        window.history.replaceState(null, '', secureUrl);
        navigate(secureUrl, { replace: true });
      }
    }
  }, [id, product, loadingToken, navigate]);

  // If we have a token but product is not in local list, fetch it directly
  useEffect(() => {
    const rawToken = token || slugToken;
    if (!rawToken || product) {
      if (product) setLoadingToken(false);
      return;
    }

    setLoadingToken(true);
    console.log('[DEBUG] Remote Fetching for Token:', rawToken);
    
    // Try resolving with the raw token (whole slug) - backend handles the split logic
    fetch(`${API_BASE_URL}/products/s/${rawToken}`)
      .then(r => r.json())
      .then(p => {
        if (p.id) {
          console.log('[DEBUG] Remote matched Product:', p.name, '(ID:', p.id, ')');
          setTokenProduct(p);
        } else {
          console.error('[DEBUG] Remote resolution failed for:', rawToken);
        }
      })
      .catch(e => console.error('Token resolution failed:', e))
      .finally(() => setLoadingToken(false));
  }, [token, slugToken, product]);

  const cartItem = useMemo(() => cart.find((item) => String(item.id) === String(product?.id)), [cart, product?.id]);
  const quantity = Number(cartItem?.qty || 0);
  const isInWishlist = useMemo(() => wishlist.some(item => String(item.id) === String(product?.id)), [wishlist, product?.id]);

  useEffect(() => {
    if (!storeProducts?.length) fetchProducts();
    const fetchMeta = async () => {
      try {
        const [availRes, settingsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/warehouse/availability?cb=${Date.now()}`).then(r => r.json()),
          fetch(`${API_BASE_URL}/settings?cb=${Date.now()}`).then(r => r.json())
        ]);
        setAvailability({ ...(availRes.data || availRes), ...(settingsRes.data || {}) });
      } catch (e) { console.error('Meta fetch failed:', e); }
    };
    fetchMeta();
  }, [fetchProducts, storeProducts?.length]);

  useEffect(() => {
    if (storeProducts?.length) return;
    fetch(`${API_BASE_URL}/products`)
      .then(r => r.json())
      .then(payload => setRemoteProducts(normalizeProductsPayload(payload)))
      .catch(() => {});
  }, [storeProducts?.length]);
  useEffect(() => {
    if (cartItem?.device_model) setDeviceModel(cartItem.device_model);
  }, [cartItem?.device_model]);

  const deliveryTimeDisplay = useMemo(() => {
    if (deliveryMode === 'quick' && nearestStoreId) return product?.delivery_time || '12-20 mins';
    return availability?.scheduled_delivery_time || 'Today / Tomorrow';
  }, [deliveryMode, nearestStoreId, product, availability]);

  const deliveryNoteDisplay = useMemo(() => {
    if (deliveryMode === 'quick' && nearestStoreId) return availability?.quick_delivery_note || 'Hyperlocal dispatch from the active dark store.';
    return availability?.scheduled_delivery_note || 'Reliable fulfillment from our central warehouse.';
  }, [deliveryMode, nearestStoreId, availability]);

  useEffect(() => {
    if (product) {
      trackViewItem(product);
      trackEvent('page_view', 'product', product.name, product.id);
    }
  }, [product, trackEvent]);

  const stock = product?.stock || 0;
  const rating = product?.average_rating || 0;
  const canAdd = stock > 0;
  const requiresDeviceModel = isStickerProduct(product);
  
  const productImages = useMemo(() => getProductImages(product), [product]);
  
  const highlights = useMemo(() => [
    `${product?.category || 'Accessory'} essential ready for ${deliveryMode === 'quick' ? 'quick delivery' : 'secure fulfillment'}`,
    `Available quantity: ${stock}`,
    `Dispatch window: ${deliveryTimeDisplay}`,
    deliveryMode === 'quick' ? 'Dark-store packed for instant express delivery' : 'Central warehouse dispatched for reliable fulfillment',
  ], [product?.category, deliveryMode, stock, deliveryTimeDisplay]);

  const handleAddToCart = useCallback((toCart = false) => {
    if (!product) return;
    const selectedDeviceModel = getDeviceModelValue(deviceModel);
    if (requiresDeviceModel && !selectedDeviceModel) {
      toast.error('Select Device Model');
      document.getElementById('device-model-selector')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    addToCart({ ...product, device_model: selectedDeviceModel || null, fitting });
    trackAddToCart(product, 1);
    trackEvent('add_to_cart', 'product', product.name, product.id);
    if (toCart) navigate('/cart');
    else toast.success('Added to collection');
  }, [addToCart, deviceModel, fitting, navigate, product, requiresDeviceModel, trackEvent]);

  const origin = useMemo(() => (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
    ? window.location.origin 
    : 'https://jdlxmobile.in', []);

  const shareUrl = useMemo(() => getProductUrl(product, origin), [product, origin]);

  const handleShare = useCallback(async () => {
    if (!product) return;
    const success = await shareProduct(product, shareUrl);
    if (!success) setShowShareModal(true);
  }, [product, shareUrl]);

  // Ensure SEO image is always a public production URL (crawlers can't see localhost)
  const seoImage = useMemo(() => {
    const rawImage = productImages[0] || FALLBACK_IMAGE;
    return (rawImage.includes('localhost') || rawImage.includes('127.0.0.1') || rawImage.includes('10.0.2.2'))
      ? rawImage.replace(/https?:\/\/[^\/]+/, 'https://jdlx-mobile.onrender.com')
      : rawImage;
  }, [productImages]);

  if (loadingToken) return (
    <div className="container-standard py-20 text-center">
      <div className="glass-card px-6 py-20">
        <div className="flex justify-center mb-8"><div className="h-16 w-16 rounded-3xl border-4 border-primary/20 border-t-primary animate-spin" /></div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Loading Premium Selection...</p>
      </div>
    </div>
  );

  if (!product) return (
    <div className="container-standard py-20 text-center">
      <div className="glass-card px-6 py-20 animate-in fade-in zoom-in duration-500">
        <h2 className="text-4xl font-black tracking-tighter">Product not found</h2>
        <p className="mt-4 text-slate-500">This item is currently unavailable.</p>
        <Link to="/" className="btn-primary mt-8 inline-flex items-center gap-2"><ArrowLeft size={16} /> Back to home</Link>
      </div>
    </div>
  );

  return (
    <div className="reveal-staggered pb-48 md:pb-0">
      <style>{`
        @keyframes heartPop {
          0% { transform: scale(1); }
          50% { transform: scale(1.35); }
          100% { transform: scale(1); }
        }
      `}</style>
      <SEO 
        title={product.name}
        description={product.description}
        price={product.price}
        image={seoImage}
        url={shareUrl}
      />
      <button onClick={() => navigate(-1)} className="fixed top-4 left-4 z-[110] md:hidden h-10 w-10 flex items-center justify-center rounded-full bg-slate-900/40 backdrop-blur-md text-white border border-white/10 active:scale-90 transition-all shadow-xl"><ArrowLeft size={20} /></button>

      <section className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr] animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="space-y-6">
          <div className="md:glass-card overflow-hidden md:p-1.5 -mx-4 md:mx-0">
            <div className="relative overflow-hidden md:rounded-[28px] bg-white md:bg-transparent">
              <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 md:hidden">
                <span className="bg-slate-900/90 backdrop-blur-md text-white text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest border border-white/10">{product.category || 'General'}</span>
                {stock <= LOW_STOCK_LIMIT && stock > 0 && <span className="bg-primary text-slate-900 text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest border border-amber-500/20 shadow-lg">Only {stock} Left</span>}
                {stock <= 0 && <span className="bg-red-500 text-white text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest border border-red-600 shadow-lg animate-pulse">Sold Out</span>}
              </div>

              {/* Floating Favorite (Heart) Button with Pop Animation */}
              <button 
                onClick={() => { 
                  toggleWishlist(product); 
                  toast.success(isInWishlist ? 'Removed from favorites' : 'Saved to favorites'); 
                }} 
                className={`absolute top-4 right-4 z-20 h-11 w-11 flex items-center justify-center rounded-full backdrop-blur-md border shadow-lg transition-all duration-300 active:scale-75 ${
                  isInWishlist 
                    ? 'bg-rose-500 border-rose-500 text-white hover:bg-rose-600' 
                    : 'bg-white/80 border-slate-100 text-slate-700 hover:text-rose-500 hover:bg-white'
                }`}
                style={{
                  animation: isInWishlist ? 'heartPop 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) both' : 'none'
                }}
                aria-label="Add to Favorites"
              >
                <Heart size={20} fill={isInWishlist ? 'currentColor' : 'none'} className="transition-transform duration-300" />
              </button>
              <div className="overflow-hidden bg-white">
                <img src={productImages[activeImageIndex]} alt={product.name} className="h-[400px] w-full object-contain transition-all duration-700 sm:h-[540px] md:rounded-[28px]" />
              </div>
              {productImages.length > 1 && (
                <div className="absolute inset-x-0 bottom-6 z-20 flex justify-center gap-2 px-6">
                  <div className="flex gap-2 overflow-x-auto no-scrollbar p-1 rounded-2xl bg-white/10 backdrop-blur-md border border-white/10">
                    {productImages.map((img, idx) => (
                      <button key={idx} onClick={() => setActiveImageIndex(idx)} className={`relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl border-2 transition-all ${activeImageIndex === idx ? 'border-amber-400 scale-105' : 'border-transparent opacity-60'}`}><img src={img} alt="" className="h-full w-full object-cover" /></button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[ { icon: Truck, val: deliveryTimeDisplay, note: deliveryNoteDisplay, label: 'Delivery' }, { icon: ShieldCheck, val: 'Quality Checked', note: 'Managed inventory batches.', label: 'Quality' }, { icon: Store, val: `${stock} units`, note: 'Live inventory status.', label: 'Availability' } ].map((item, i) => (
              <div key={i} className="glass-card p-6 transition-transform hover:-translate-y-1">
                <div className="flex items-center gap-3"><div className="p-2.5 rounded-2xl bg-primary/10 text-primary"><item.icon size={20} /></div><span className="ui-label opacity-60">{item.label}</span></div>
                <div className="mt-4 text-[17px] font-black tracking-tight">{item.val}</div>
                <p className="mt-2 text-[13px] font-bold opacity-60">{item.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="glass-card p-8 sm:p-10">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {rating > 0 && <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-primary border border-amber-400/20"><Star size={12} fill="currentColor" /> {Number(rating).toFixed(1)} Rating</div>}
              <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-600"><ShieldCheck size={12} /> Quality Checked</div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-900/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-900"><Clock size={12} /> Secure Checkout</div>
            </div>
            <h1 className="text-3xl font-black tracking-tighter md:text-5xl leading-[1.1] mb-2">{product.name}</h1>
            <p className="ui-label mb-6">{product.category || 'Premium Accessory'}</p>
            <div className="mt-6 flex items-baseline gap-4 p-6 rounded-[2.5rem] bg-slate-50 border border-slate-100 shadow-inner">
              <div className="flex flex-col"><span className="ui-label opacity-40 mb-1">Current Price</span><div className="text-4xl md:text-5xl font-black tracking-tighter">₹{product.price}</div></div>
              {product.mrp > product.price && <div className="flex flex-col"><span className="ui-label text-red-400 opacity-100 mb-1">MRP</span><div className="text-xl md:text-2xl opacity-30 line-through font-bold">₹{product.mrp}</div></div>}
              <div className="ml-auto"><div className="inline-flex items-center gap-2 rounded-2xl bg-[#00E676] px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white shadow-lg animate-pulse"><BadgePercent size={16} /> Best Deal</div></div>
            </div>
            <div className="mt-8 space-y-4">
              <h3 className="ui-label text-slate-400">Description</h3>
              <p className="text-[16px] md:text-lg font-bold opacity-70 leading-relaxed">{product.description || 'Premium daily essential from the JDLX collection.'}</p>
            </div>
            <div className="mt-8 overflow-hidden rounded-[2.5rem] border border-slate-100 bg-slate-50">
              <div className="flex items-center justify-between bg-white px-6 py-5 border-b border-slate-100">
                <div className="flex items-center gap-3"><div className="rounded-2xl bg-emerald-500/10 p-2.5 text-emerald-600"><Undo2 size={20} /></div><div><h4 className="text-[12px] font-black uppercase tracking-[0.1em]">Return Policy</h4><p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Verified</p></div></div>
                <button onClick={() => setShowPolicyModal(true)} className="rounded-full bg-slate-900 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white shadow-lg active:scale-95 transition-all">View Details</button>
              </div>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-4">
              <div className="rounded-[2rem] bg-primary p-6 text-slate-950 shadow-xl shadow-primary/20">
                <div className="flex items-center gap-2 mb-3"><ShieldCheck size={16} className="opacity-40" /><span className="ui-label opacity-40">Inventory</span></div>
                <div className="text-xl font-black tracking-tight">{stock <= 0 ? 'Out of Stock' : stock <= LOW_STOCK_LIMIT ? `Only ${stock} Left` : 'Fully Stocked'}</div>
                <p className="mt-1 text-[11px] font-bold opacity-60">{stock > 0 ? 'Ready for fulfillment' : 'Restocking soon'}</p>
              </div>
              <div className="rounded-[2rem] bg-slate-900 p-6 text-white shadow-xl shadow-slate-900/20">
                <div className="flex items-center gap-2 mb-3"><Zap size={16} className="text-amber-400" /><span className="ui-label text-slate-400">Dispatch</span></div>
                <div className="text-xl font-black tracking-tight">{deliveryTimeDisplay}</div>
                <p className="mt-1 text-[11px] font-bold text-slate-400">{deliveryMode === 'quick' ? 'Hyperlocal' : 'Standard'}</p>
              </div>
            </div>

            <div className="mt-10 md:block hidden">
              {quantity > 0 ? (
                <div className="flex items-center gap-4">
                  <div className="flex h-16 items-center gap-8 rounded-3xl bg-slate-900 px-8 shadow-2xl">
                    <button onClick={() => quantity > 1 ? updateQuantity(product.id, quantity - 1) : removeFromCart(product.id)} className="text-white active:scale-75 transition-all"><Minus size={24} /></button>
                    <span className="text-2xl font-black text-white">{quantity}</span>
                    <button disabled={quantity >= stock} onClick={() => updateQuantity(product.id, quantity + 1)} className="text-white active:scale-75 transition-all disabled:opacity-20"><Plus size={24} /></button>
                  </div>
                  <Link to="/cart" className="flex-1 h-16 rounded-3xl bg-primary text-slate-950 font-black text-sm uppercase tracking-widest shadow-xl flex items-center justify-center active:scale-95 transition-all">View in Cart</Link>
                  <button onClick={handleShare} className="h-16 w-16 flex items-center justify-center rounded-3xl border-2 border-slate-100 bg-slate-50 text-slate-400 hover:text-primary hover:border-primary/20 hover:shadow-lg active:scale-90 transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] group"><Share2 size={24} className="group-hover:rotate-12 transition-transform" /></button>
                </div>
              ) : (
                <div className="space-y-4">
                  {requiresDeviceModel && <div className="p-6 rounded-[2rem] bg-slate-50 border border-slate-100"><DeviceModelSelector value={deviceModel} onChange={setDeviceModel} required /></div>}
                  <div className="flex items-center gap-4">
                    {canAdd ? (
                      <><button onClick={() => handleAddToCart()} className="flex-[2] h-16 rounded-[2rem] bg-slate-900 text-white font-black text-sm uppercase tracking-widest shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all"><ShoppingCart size={20} /> Add to Cart</button>
                        <button onClick={() => handleAddToCart(true)} className="flex-1 h-16 rounded-[2rem] bg-primary text-slate-950 font-black text-sm uppercase tracking-widest shadow-xl active:scale-95 transition-all">Buy Now</button>
                        <button onClick={() => { toggleWishlist(product); toast.success(isInWishlist ? 'Removed' : 'Saved'); }} className={`h-16 w-16 flex items-center justify-center rounded-[2rem] border-2 transition-all active:scale-90 ${isInWishlist ? 'bg-red-50 border-red-100 text-red-500' : 'bg-slate-50 border-slate-100 text-slate-400 hover:text-red-500'}`}><Heart size={28} fill={isInWishlist ? 'currentColor' : 'none'} /></button>
                        <button onClick={handleShare} className="h-16 w-16 flex items-center justify-center rounded-[2rem] border-2 border-slate-100 bg-slate-50 text-slate-400 hover:text-primary hover:border-primary/20 hover:shadow-lg active:scale-90 transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] group"><Share2 size={24} className="group-hover:rotate-12 transition-transform" /></button></>
                    ) : (
                      <div className="flex items-center gap-4 w-full">
                        <button disabled={isNotified} onClick={async () => { if (!isNotified) { const res = await registerForNotification(product.id, user?.email); if (res.success) { toast.success(res.message); setIsNotified(true); } } }} className={`h-16 flex-1 rounded-[2rem] font-black text-sm uppercase tracking-widest shadow-xl flex items-center justify-center gap-3 transition-all ${isNotified ? 'bg-emerald-500 text-white' : 'bg-primary text-slate-950'}`}>
                          {isNotified ? <CheckCircle2 size={24} /> : <Bell size={24} />} {isNotified ? 'Notified' : 'Notify on Restock'}
                        </button>
                        <button onClick={handleShare} className="h-16 w-16 flex items-center justify-center rounded-[2rem] border-2 border-slate-100 bg-slate-50 text-slate-400 hover:text-primary hover:border-primary/20 hover:shadow-lg active:scale-90 transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] group"><Share2 size={24} className="group-hover:rotate-12 transition-transform" /></button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Mobile-only Customization */}
            <div className="md:hidden space-y-6 mt-6">
               {requiresDeviceModel && <div className="p-6 rounded-[2.5rem] bg-slate-50 border border-slate-100" id="device-model-selector"><DeviceModelSelector value={deviceModel} onChange={setDeviceModel} required /></div>}
               {product.category_id === 7 && deliveryMode === 'quick' && (
                  <div className="p-5 rounded-[2rem] bg-amber-50 border border-amber-100 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-3"><div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center shadow-sm text-primary"><Truck size={24} /></div><div><p className="text-[13px] font-black text-slate-900 uppercase">Expert Fitting</p><p className="text-[10px] font-bold text-primary uppercase">Doorstep Installation</p></div></div>
                    <div className="flex items-center gap-4"><span className="text-sm font-black text-slate-900">₹{product.sub_category?.toLowerCase().includes('uv glass') ? 80 : 40}</span>
                    <button type="button" onClick={() => setFitting(!fitting)} className={`w-14 h-8 rounded-full transition-all relative ${fitting ? 'bg-primary' : 'bg-slate-200'}`}><div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-sm transition-all ${fitting ? 'right-1' : 'left-1'}`} /></button></div>
                  </div>
               )}
            </div>
          </div>
          <div className="glass-card p-4 md:p-8 rounded-[2.5rem]">
            <div className="flex p-1.5 bg-slate-100 rounded-full gap-1 mb-8">
              {['overview', 'highlights', 'reviews'].map((tab) => (<button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 rounded-full py-3 text-[11px] font-black uppercase tracking-[0.2em] transition-all duration-300 ${activeTab === tab ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}>{tab}</button>))}
            </div>
            {activeTab === 'overview' && <div className="space-y-8 animate-in fade-in duration-500"><div className="grid grid-cols-1 md:grid-cols-2 gap-6"><div className="rounded-[2rem] p-6 bg-primary/5 border border-amber-400/10"><div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary"><Truck size={20} /></div><h4 className="ui-label text-primary">Fulfillment</h4></div><p className="text-sm font-bold opacity-80">Safe & trusted order fulfillment dispatched directly to your location.</p></div><div className="rounded-[2rem] p-6 bg-emerald-500/5 border border-emerald-500/10"><div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-600"><ShieldCheck size={20} /></div><h4 className="ui-label text-emerald-600">Quality Checked</h4></div><p className="text-sm font-bold opacity-80">Inspected before dispatch for quality assurance.</p></div></div><div className="p-8 rounded-[2rem] bg-slate-50 border border-slate-100"><p className="text-[15px] font-bold opacity-60 leading-relaxed">{product.description || `A premium daily essential from the JDLX collection.`}</p></div></div>}
            {activeTab === 'highlights' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in fade-in duration-500">{highlights.map((h) => (<div key={h} className="flex items-center gap-4 p-5 rounded-3xl bg-white border border-slate-100 shadow-sm"><div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center text-white shrink-0"><CheckCircle2 size={14} /></div><span className="text-[13px] font-bold text-slate-700">{h}</span></div>))}</div>}
            {activeTab === 'reviews' && <div className="animate-in fade-in duration-500"><ProductReviews productId={product.id} /></div>}
          </div>
        </div>
      </section>

      {/* Policy Modal */}
      {showPolicyModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setShowPolicyModal(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-[2.5rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="bg-slate-900 p-8 text-white relative"><button onClick={() => setShowPolicyModal(false)} className="absolute top-6 right-6 p-2 rounded-full bg-white/10"><X size={20} /></button><div className="flex items-center gap-4"><div className="p-3 bg-white/10 rounded-2xl"><ShieldCheck size={24} className="text-emerald-400" /></div><div><h3 className="text-2xl font-black tracking-tight">Protection</h3><p className="ui-label text-slate-400">Verified by JDLX</p></div></div></div>
            <div className="p-8 max-h-[60vh] overflow-y-auto no-scrollbar bg-white"><div className="space-y-4">{(product.final_return_policy || '7 Days Return Policy').split('\n').filter(p => p.trim()).map((p, i) => (<div key={i} className="flex items-start gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100"><div className="w-2 h-2 rounded-full bg-slate-900 mt-1.5 shrink-0" /><p className="text-[13px] font-bold text-slate-700 leading-relaxed">{p.replace(/\*\*/g, '').replace(/^\s*[\*\-]\s*/, '').trim()}</p></div>))}</div></div>
            <div className="p-6 bg-slate-50 border-t border-slate-100"><button onClick={() => setShowPolicyModal(false)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl active:scale-95 transition-all">Got it</button></div>
          </div>
        </div>
      )}

      {/* Mobile Sticky Bar */}
      <div className="fixed bottom-[104px] inset-x-0 z-[90] px-4 md:hidden">
         <div className="bg-slate-900/95 backdrop-blur-2xl border border-white/10 rounded-[2rem] p-3 shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-full duration-700">
            {quantity > 0 ? (
                <div className="flex w-full items-center gap-3">
                    <div className="flex h-12 flex-1 items-center justify-between rounded-2xl bg-white/10 px-4 border border-white/10">
                        <button onClick={() => quantity > 1 ? updateQuantity(product.id, quantity - 1) : removeFromCart(product.id)} className="text-white active:scale-75"><Minus size={18} /></button>
                        <span className="text-lg font-black text-white">{quantity}</span>
                        <button disabled={quantity >= stock} onClick={() => updateQuantity(product.id, quantity + 1)} className="text-white active:scale-75 disabled:opacity-20"><Plus size={18} /></button>
                    </div>
                    <Link to="/cart" className="flex h-12 flex-[1.5] items-center justify-center rounded-2xl bg-primary text-slate-950 text-[11px] font-black uppercase tracking-widest shadow-lg active:scale-95">View in Cart</Link>
                    <button onClick={() => { toggleWishlist(product); toast.success(isInWishlist ? 'Removed from favorites' : 'Saved to favorites'); }} className={`h-12 w-12 flex items-center justify-center rounded-2xl border transition-all active:scale-90 ${isInWishlist ? 'bg-rose-500 border-rose-500 text-white shadow-lg' : 'bg-white/10 border-white/10 text-white'}`} style={{ animation: isInWishlist ? 'heartPop 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) both' : 'none' }}><Heart size={18} fill={isInWishlist ? 'currentColor' : 'none'} /></button>
                    <button onClick={handleShare} className="h-12 w-12 flex items-center justify-center rounded-2xl bg-white/10 text-white border border-white/10 active:scale-90 transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] group"><Share2 size={18} className="group-hover:rotate-12 transition-transform" /></button>
                </div>
            ) : (
              <div className="flex w-full gap-2">
                {canAdd ? (
                  <>
                    <button onClick={() => handleAddToCart()} className="flex-1 h-12 rounded-2xl bg-white/10 text-white text-[11px] font-black uppercase tracking-widest border border-white/10 active:scale-95 flex items-center justify-center gap-2"><ShoppingCart size={14} /> Add</button>
                    <button onClick={() => handleAddToCart(true)} className="flex-[1.5] h-12 rounded-2xl bg-primary text-slate-950 text-[11px] font-black uppercase tracking-widest shadow-lg active:scale-95">Buy Now</button>
                    <button onClick={() => { toggleWishlist(product); toast.success(isInWishlist ? 'Removed from favorites' : 'Saved to favorites'); }} className={`h-12 w-12 flex items-center justify-center rounded-2xl border transition-all active:scale-90 ${isInWishlist ? 'bg-rose-500 border-rose-500 text-white shadow-lg' : 'bg-white/10 border-white/10 text-white'}`} style={{ animation: isInWishlist ? 'heartPop 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) both' : 'none' }}><Heart size={18} fill={isInWishlist ? 'currentColor' : 'none'} /></button>
                    <button onClick={handleShare} className="h-12 w-12 flex items-center justify-center rounded-2xl bg-white/10 text-white border border-white/10 active:scale-90 transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] group"><Share2 size={18} className="group-hover:rotate-12 transition-transform" /></button>
                  </>
                ) : (
                  <div className="flex w-full gap-2">
                    <button disabled={isNotified} onClick={async () => { if (!isNotified) { const res = await registerForNotification(product.id, user?.email); if (res.success) { toast.success(res.message); setIsNotified(true); } } }} className={`h-12 flex-1 rounded-2xl font-black text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 ${isNotified ? 'bg-emerald-500 text-white' : 'bg-primary text-slate-950'}`}>
                      {isNotified ? <CheckCircle2 size={16} /> : <Bell size={16} />} {isNotified ? 'Notified' : 'Notify on Restock'}
                    </button>
                    <button onClick={() => { toggleWishlist(product); toast.success(isInWishlist ? 'Removed from favorites' : 'Saved to favorites'); }} className={`h-12 w-12 flex items-center justify-center rounded-2xl border transition-all active:scale-90 ${isInWishlist ? 'bg-rose-500 border-rose-500 text-white shadow-lg' : 'bg-white/10 border-white/10 text-white'}`} style={{ animation: isInWishlist ? 'heartPop 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) both' : 'none' }}><Heart size={18} fill={isInWishlist ? 'currentColor' : 'none'} /></button>
                    <button onClick={handleShare} className="h-12 w-12 flex items-center justify-center rounded-2xl bg-white/10 text-white border border-white/10 active:scale-90 transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] group"><Share2 size={18} className="group-hover:rotate-12 transition-transform" /></button>
                  </div>
                )}
              </div>
            )}
         </div>
      </div>
      <div className="mt-20"><ProductRecommendationScroller currentProduct={product} allProducts={products} /></div>

      <ShareModal 
        isOpen={showShareModal} 
        onClose={() => setShowShareModal(false)} 
        product={product}
        url={shareUrl}
      />
    </div>
  );
}

function ProductRecommendationScroller({ currentProduct, allProducts }) {
  const recommendations = useMemo(() => allProducts.filter(p => p.id !== currentProduct.id && p.category === currentProduct.category).slice(0, 6), [currentProduct.id, currentProduct.category, allProducts]);
  if (!recommendations.length) return null;
  return (
    <div className="mt-20 border-t border-slate-100 pt-16">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10"><div><span className="ui-label text-primary mb-3 block">From the same aisle</span><h2 className="text-3xl font-black tracking-tighter">You May Also Like</h2></div><Link to="/" className="text-sm font-bold text-primary flex items-center gap-2 group">View Collection <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" /></Link></div>
      <div className="flex gap-6 overflow-x-auto pb-8 no-scrollbar reveal-staggered">
        {recommendations.map(p => (<Link key={p.id} to={getProductUrl(p)} className="flex-shrink-0 w-64 glass-card rounded-[32px] overflow-hidden group hover:-translate-y-2 transition-all duration-500"><div className="aspect-square bg-slate-50 overflow-hidden"><img src={getProductImages(p)[0]} alt={p.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" /></div><div className="p-6"><h4 className="font-bold text-slate-900 truncate mb-1">{p.name}</h4><div className="text-lg font-black text-primary">₹{p.price}</div></div></Link>))}
      </div>
    </div>
  );
}
