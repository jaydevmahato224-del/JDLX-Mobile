import { AlertCircle, ArrowLeft, ArrowRight, BadgePercent, Bell, CheckCircle2, ChevronRight, Clock, Heart, Minus, Plus, Share2, ShieldCheck, ShoppingCart, Star, Store, Truck, Undo2, X } from 'lucide-react';
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
  const { products: storeProducts, fetchProducts, addToCart, cart, wishlist, toggleWishlist, updateQuantity, removeFromCart, user, registerForNotification } = useStore();
  const { trackEvent } = useAnalyticsContext();
  
  const [remoteProducts, setRemoteProducts] = useState([]);
  const [tokenProduct, setTokenProduct] = useState(null);
  const [loadingToken, setLoadingToken] = useState(!!(token || slugToken));
  const [activeTab, setActiveTab] = useState('overview');
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [deviceModel, setDeviceModel] = useState('');
  const [isNotified, setIsNotified] = useState(false);
  // fitting is always false today (its only setter lived in a dead `false &&`
  // block that was removed); the value is still read when adding to cart.
  const [fitting] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [showShareModal, setShowShareModal] = useState(false);

  // Variant & option state — full variant data is fetched from the detail
  // endpoint (the list payload only carries has_variants + base price).
  const [detailVariants, setDetailVariants] = useState([]);
  const [detailVariantOptions, setDetailVariantOptions] = useState([]);
  const [selectedOptions, setSelectedOptions] = useState({});
  const [selectedVariantId, setSelectedVariantId] = useState(null);

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
      if (product) {
        // Product resolved locally — no remote fetch happens in this branch,
        // so clearing the loading flag here is intentional (not a cascade).
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoadingToken(false);
      }
      return;
    }

    setLoadingToken(true);
    console.log('[DEBUG] Remote Fetching for Token:', rawToken);
    
    // Try resolving with the raw token (whole slug) - backend handles the split logic
    fetch(`${API_BASE_URL}/products/s/${rawToken}`)
      .then(r => r.json())
      .then(payload => {
        // Backend wraps token lookups as {success, data: {product}, message};
        // unwrap so the product object carries the id used below.
        const p = payload?.data || payload;
        if (p && p.id) {
          console.log('[DEBUG] Remote matched Product:', p.name, '(ID:', p.id, ')');
          setTokenProduct(p);
        } else {
          console.error('[DEBUG] Remote resolution failed for:', rawToken);
        }
      })
      .catch(e => console.error('Token resolution failed:', e))
      .finally(() => setLoadingToken(false));
  }, [token, slugToken, product]);

  // Reset the variant picker whenever we move to a different product (adjust
  // state during render — the React-sanctioned equivalent of a reset effect).
  const productKey = product?.id || null;
  const [prevProductKey, setPrevProductKey] = useState(null);
  if (prevProductKey !== productKey) {
    setPrevProductKey(productKey);
    if (!product || !product.has_variants) {
      setDetailVariants([]);
      setDetailVariantOptions([]);
      setSelectedOptions({});
      setSelectedVariantId(null);
    }
  }

  // Load full variant/option data whenever we land on a variant product.
  // Defaults to the first in-stock variant so the page is immediately usable.
  const productId = product?.id;
  const productHasVariants = product?.has_variants;
  useEffect(() => {
    if (!productId || !productHasVariants) return;
    fetch(`${API_BASE_URL}/products/${productId}?_t=${Date.now()}`)
      .then(r => r.json())
      .then(payload => {
        const data = payload?.data || payload || {};
        const variants = Array.isArray(data.variants) ? data.variants : [];
        let opts = Array.isArray(data.variant_options) ? data.variant_options : [];
        // Fallback: if no explicit option groups were defined (e.g. variants
        // created by a warehouse with only per-variant option maps), derive the
        // groups from the variants themselves.
        if (opts.length === 0 && variants.length) {
          const keyOrder = [];
          const valueMap = {};
          variants.forEach(v => {
            Object.entries(v.options || {}).forEach(([k, val]) => {
              if (!(k in valueMap)) { valueMap[k] = new Set(); keyOrder.push(k); }
              if (val) valueMap[k].add(val);
            });
          });
          opts = keyOrder.map(k => ({ option_name: k, option_values: Array.from(valueMap[k]) }));
        }
        setDetailVariants(variants);
        setDetailVariantOptions(opts);
        if (variants.length) {
          const first = variants.find(v => (v.stock || 0) > 0) || variants[0];
          setSelectedVariantId(first.id);
          setSelectedOptions(first.options || {});
        }
      })
      .catch(() => { /* variant data is optional — page still renders base product */ });
  }, [productId, productHasVariants]);

  // Determine if this is a variant product early so other memos can use it
  const isVariantProduct = Boolean(product?.has_variants) && detailVariants.length > 0;

  // Build a map of available combinations for quick lookup
  const availableCombinations = useMemo(() => {
    const map = new Map();
    detailVariants.forEach(v => {
      if (v.stock > 0 && v.options) {
        const key = Object.entries(v.options).sort().map(([k, v]) => `${k}:${v}`).join('|');
        map.set(key, v);
      }
    });
    return map;
  }, [detailVariants]);

  // Check if a partial selection can lead to any available variant
  const hasAvailableCombinations = useMemo(() => {
    if (!isVariantProduct) return true;
    if (Object.keys(selectedOptions).length === 0) return availableCombinations.size > 0;
    return Array.from(availableCombinations.keys()).some(key => {
      const comboOptions = Object.fromEntries(key.split('|').map(kv => kv.split(':')));
      return Object.entries(selectedOptions).every(([k, v]) => comboOptions[k] === v);
    });
  }, [selectedOptions, availableCombinations, isVariantProduct]);

  // The variant currently chosen by the option chips (if any).
  const selectedVariant = useMemo(
    () => detailVariants.find(v => String(v.id) === String(selectedVariantId)) || null,
    [detailVariants, selectedVariantId]
  );

  // Merged view of the product + selected variant. Everything below (price,
  // stock, images, add-to-cart) reads from this so the page reacts to option
  // changes exactly like a single-SKU product would.
  const activeProduct = useMemo(() => {
    if (!product) return null;
    if (!selectedVariant) return product;
    return {
      ...product,
      ...selectedVariant,
      id: product.id,
      name: product.name,
      price: selectedVariant.price != null ? selectedVariant.price : product.price,
      mrp: selectedVariant.mrp != null ? selectedVariant.mrp : (product.mrp || product.price),
      stock: selectedVariant.stock != null ? selectedVariant.stock : 0,
      variant_id: selectedVariant.id,
      variant_name: selectedVariant.name,
      images: Array.isArray(selectedVariant.images) && selectedVariant.images.length
        ? selectedVariant.images
        : product.images,
    };
  }, [product, selectedVariant]);

  const handleSelectOption = (optionName, value) => {
    const next = { ...selectedOptions, [optionName]: value };
    setSelectedOptions(next);
    // Pick the variant whose option map matches every selection. If the
    // combination doesn't exist yet the picker stays visible but add-to-cart
    // is disabled (handled by selectedVariant being stale/unmatched).
    const match = detailVariants.find(v => {
      const vo = v.options || {};
      return Object.entries(next).every(([k, val]) => String(vo[k] || '') === String(val));
    });
    // Only keep a selected variant when the full combination exists — otherwise
    // clear it so the add-to-cart button disables with a clear hint.
    if (match) setSelectedVariantId(match.id);
    else setSelectedVariantId(null);
  };

  const selectionComplete = isVariantProduct
    ? detailVariantOptions.every(o => String(selectedOptions[o.option_name] || '') !== '')
    : true;

  // Determine available values for each option group based on current selection
  const availableOptionValues = useMemo(() => {
    if (!isVariantProduct) return {};
    const available = {};
    detailVariantOptions.forEach(group => {
      const groupName = group.option_name;
      const currentSelection = { ...selectedOptions };
      delete currentSelection[groupName];
      
      const matchingVariants = detailVariants.filter(v => {
        const vo = v.options || {};
        return Object.entries(currentSelection).every(([k, val]) => String(vo[k] || '') === String(val)) && 
               (v.stock || 0) > 0;
      });
      
      available[groupName] = [...new Set(matchingVariants.flatMap(v => v.options?.[groupName]).filter(Boolean))];
    });
    return available;
  }, [isVariantProduct, detailVariantOptions, selectedOptions, detailVariants]);

  const cartItem = useMemo(() => cart.find((item) => String(item.id) === String(activeProduct?.id) && String(item.variant_id || '') === String(activeProduct?.variant_id || '')), [cart, activeProduct?.id, activeProduct?.variant_id]);
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
    if (cartItem?.device_model) {
      // Keep the selected device model in sync with the cart line item
      // (external store state) — intentional effect-based sync.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeviceModel(cartItem.device_model);
    }
  }, [cartItem?.device_model]);

  const deliveryTimeDisplay = useMemo(() => {
    return availability?.scheduled_delivery_time || 'Today / Tomorrow';
  }, [availability]);

  const deliveryNoteDisplay = useMemo(() => {
    return availability?.scheduled_delivery_note || 'Reliable fulfillment from our central warehouse.';
  }, [availability]);

  useEffect(() => {
    if (product) {
      trackViewItem(product);
      trackEvent('page_view', 'product', product.name, product.id);
    }
  }, [product, trackEvent]);

  const stock = activeProduct?.stock || 0;
  const variantId = activeProduct?.variant_id || null;
  const rating = activeProduct?.average_rating || 0;
  const canAdd = stock > 0 && selectionComplete && (isVariantProduct ? Boolean(selectedVariant) : true);
  const requiresDeviceModel = isStickerProduct(activeProduct);
  
  const productImages = useMemo(() => getProductImages(activeProduct), [activeProduct]);
  
  const highlights = useMemo(() => [
    `${activeProduct?.category || 'Accessory'} essential ready for secure fulfillment`,
    `Available quantity: ${stock}`,
    `Dispatch window: ${deliveryTimeDisplay}`,
    'Central warehouse dispatched for reliable fulfillment',
  ], [activeProduct?.category, stock, deliveryTimeDisplay]);

  const handleAddToCart = useCallback((toCart = false) => {
    if (!activeProduct) return;
    if (isVariantProduct && !selectedVariant) {
      if (!hasAvailableCombinations && Object.keys(selectedOptions).length > 0) {
        toast.error('This combination is not available. Please change your selection.');
      } else if (!selectionComplete) {
        toast.error('Please select all options');
      } else {
        toast.error('Please select all options');
      }
      return;
    }
    const selectedDeviceModel = getDeviceModelValue(deviceModel);
    if (requiresDeviceModel && !selectedDeviceModel) {
      toast.error('Select Device Model');
      document.getElementById('device-model-selector')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    addToCart({ ...activeProduct, device_model: selectedDeviceModel || null, fitting });
    trackAddToCart(activeProduct, 1);
    trackEvent('add_to_cart', 'product', activeProduct.name, activeProduct.id);
    if (toCart) navigate('/cart');
    else toast.success('Added to collection');
  }, [activeProduct, addToCart, deviceModel, fitting, isVariantProduct, navigate, requiresDeviceModel, selectedVariant, trackEvent, hasAvailableCombinations, selectionComplete, selectedOptions]);

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
      ? rawImage.replace(/https?:\/\/[^/]+/, 'https://jdlx-mobile.onrender.com')
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
      {/* Variant option picker (Size / Color / Model chips). Rendered for both
          mobile and desktop — selection drives price, stock and images below. */}
      {isVariantProduct && detailVariantOptions.length > 0 && (
        <section className="glass-card p-6 sm:p-8 rounded-[2rem] mt-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-sm font-black uppercase tracking-[0.15em]">Choose Options</h3>
              <p className="text-[11px] font-bold opacity-50 mt-1">
                {selectedVariant ? selectedVariant.name : 
                 !hasAvailableCombinations ? 'This combination is not available' : 
                 'Select all options to continue'}
              </p>
            </div>
            {selectedVariant?.stock > 0 && <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-500/10 px-3 py-1.5 rounded-full">{selectedVariant.stock} in stock</span>}
            {!hasAvailableCombinations && selectedOptions && Object.keys(selectedOptions).length > 0 && (
              <span className="text-[10px] font-black uppercase tracking-widest text-rose-600 bg-rose-500/10 px-3 py-1.5 rounded-full">Unavailable</span>
            )}
          </div>
          <div className="space-y-5">
            {detailVariantOptions.map((group) => {
              const values = Array.isArray(group.option_values) ? group.option_values : [];
              const current = selectedOptions[group.option_name];
              const availableValues = availableOptionValues[group.option_name] || [];
              return (
                <div key={group.id || group.option_name}>
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="ui-label">{group.option_name}</span>
                    {current && <span className="text-[10px] font-black text-primary uppercase tracking-widest">{current}</span>}
                    {!hasAvailableCombinations && (
                      <span className="text-[9px] font-black text-rose-500">No available combinations</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {values.map((value) => {
                      const selected = String(current || '') === String(value);
                      const isAvailable = availableValues.includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => isAvailable && handleSelectOption(group.option_name, value)}
                          disabled={!isAvailable}
                          className={`min-w-[52px] px-4 py-2.5 rounded-2xl text-[12px] font-black transition-all active:scale-95 border-2 ${
                            selected
                              ? 'bg-slate-900 text-white border-slate-900 shadow-lg'
                              : isAvailable
                                ? 'bg-[var(--color-surface-low)] text-[var(--color-on-surface)] border-[var(--color-surface-high)] hover:border-slate-400'
                                : 'bg-[var(--color-surface-container)] text-[var(--color-on-surface-variant)] border-[var(--color-surface-high)] cursor-not-allowed opacity-50'
                          }`}
                          aria-disabled={!isAvailable}
                          aria-label={isAvailable ? `${group.option_name}: ${value}` : `${group.option_name}: ${value} (unavailable)`}
                        >
                          {value}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {/* Back navigation is provided by the sticky app header (top-left),
          which already navigates back on every non-home route — a second
          floating button here overlapped it on mobile. */}

      <section className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr] animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="space-y-6">
          <div className="md:glass-card overflow-hidden md:p-1.5 -mx-4 md:mx-0">
            <div className="relative overflow-hidden md:rounded-[28px] bg-[var(--color-surface-card)] md:bg-transparent">
              <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 md:hidden">
                <span className="bg-slate-900/90 backdrop-blur-md text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest border border-white/10">{product.category || 'General'}</span>
                {stock <= LOW_STOCK_LIMIT && stock > 0 && <span className="bg-primary text-slate-900 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest border border-amber-500/20 shadow-lg">Only {stock} Left</span>}
                {stock <= 0 && <span className="bg-red-500 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest border border-red-600 shadow-lg animate-pulse">Sold Out</span>}
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
                    : 'bg-[var(--color-surface-card)] border-[var(--color-surface-high)] text-[var(--color-on-surface-variant)] hover:text-rose-500 hover:bg-[var(--color-surface-high)]'
                }`}
                style={{
                  animation: isInWishlist ? 'heartPop 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) both' : 'none'
                }}
                aria-label="Add to Favorites"
              >
                <Heart size={20} fill={isInWishlist ? 'currentColor' : 'none'} className="transition-transform duration-300" />
              </button>
              <div className="overflow-hidden bg-[var(--color-surface-card)]">
                <img
                  src={productImages[activeImageIndex]}
                  alt={product.name}
                  onError={(e) => { if (e.currentTarget.src !== FALLBACK_IMAGE) e.currentTarget.src = FALLBACK_IMAGE; }}
                  className="h-[400px] w-full object-contain transition-all duration-700 sm:h-[540px] md:rounded-[28px]"
                />
              </div>
              {productImages.length > 1 && (
                <div className="absolute inset-x-0 bottom-6 z-20 flex justify-center gap-2 px-6">
                  <div className="flex gap-2 overflow-x-auto no-scrollbar p-1 rounded-2xl bg-white/10 backdrop-blur-md border border-white/10">
                    {productImages.map((img, idx) => (
                      <button key={idx} onClick={() => setActiveImageIndex(idx)} className={`relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl border-2 transition-all ${activeImageIndex === idx ? 'border-amber-400 scale-105' : 'border-transparent opacity-60'}`}><img src={img} alt="" onError={(e) => { if (e.currentTarget.src !== FALLBACK_IMAGE) e.currentTarget.src = FALLBACK_IMAGE; }} className="h-full w-full object-cover" /></button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[ { icon: Truck, val: deliveryTimeDisplay, note: deliveryNoteDisplay, label: 'Delivery' }, { icon: ShieldCheck, val: 'Quality Checked', note: 'Managed inventory batches.', label: 'Quality' }, { icon: Store, val: `${stock} units`, note: 'Live inventory status.', label: 'Availability' } ].map((item, i) => (
              <div key={i} className="glass-card p-6 transition-transform hover:-translate-y-1">
                <div className="flex items-center gap-3"><div className="p-2.5 rounded-2xl bg-primary/10 text-primary"><item.icon size={20} /></div><span className="ui-label text-[var(--color-on-surface-variant)]">{item.label}</span></div>
                <div className="mt-4 text-[17px] font-black tracking-tight text-[var(--color-on-surface)]">{item.val}</div>
                <p className="mt-2 text-[13px] font-bold text-[var(--color-on-surface-variant)]">{item.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="glass-card p-8 sm:p-10">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {rating > 0 && <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-primary border border-amber-400/20"><Star size={12} fill="currentColor" /> {Number(rating).toFixed(1)} Rating</div>}
              <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-600"><ShieldCheck size={12} /> Quality Checked</div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-on-surface)]/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-[var(--color-on-surface)]"><Clock size={12} /> Secure Checkout</div>
            </div>
            <h1 className="text-3xl font-black tracking-tighter md:text-5xl leading-[1.1] mb-2">{activeProduct.name}</h1>
            <p className="ui-label mb-2">{activeProduct.category || 'Premium Accessory'}</p>
            {selectedVariant && <p className="text-[12px] font-black text-primary uppercase tracking-widest mb-6">{selectedVariant.name}</p>}
            <div className="mt-6 p-6 rounded-[2.5rem] bg-[var(--color-surface-low)] border border-[var(--color-surface-high)] shadow-inner">
              <div className="flex items-baseline gap-4 flex-wrap">
                <div className="flex flex-col"><span className="ui-label text-[var(--color-on-surface-variant)] mb-1">Current Price</span><div className="text-4xl md:text-5xl font-black tracking-tighter text-[var(--color-on-surface)]">₹{activeProduct.price}</div></div>
                {activeProduct.mrp > activeProduct.price && (
                  <>
                    <div className="flex flex-col"><span className="ui-label text-[var(--color-on-surface-variant)] mb-1">MRP</span><div className="text-xl md:text-2xl text-[var(--color-on-surface-variant)] line-through font-bold">₹{activeProduct.mrp}</div></div>
                    <div className="ml-auto inline-flex items-center gap-1.5 rounded-2xl bg-emerald-500/15 px-4 py-2 text-[12px] font-black uppercase tracking-wider text-emerald-500 border border-emerald-500/20"><BadgePercent size={16} /> {Math.round(((activeProduct.mrp - activeProduct.price) / activeProduct.mrp) * 100)}% OFF</div>
                  </>
                )}
              </div>
              {activeProduct.mrp > activeProduct.price && <p className="mt-3 text-[13px] font-bold text-emerald-500">You save ₹{activeProduct.mrp - activeProduct.price} on this order</p>}
            </div>
            <div className="mt-8 space-y-4">
              <h3 className="ui-label text-slate-400">Description</h3>
              <p className="text-[16px] md:text-lg font-bold opacity-70 leading-relaxed">{activeProduct.description || 'Premium daily essential from the JDLX collection.'}</p>
            </div>
            <div className="mt-8 overflow-hidden rounded-[2.5rem] border border-[var(--color-surface-high)] bg-[var(--color-surface-low)]">
              <div className="flex items-center justify-between bg-[var(--color-surface-card)] px-6 py-5 border-b border-[var(--color-surface-high)]">
                <div className="flex items-center gap-3"><div className="rounded-2xl bg-emerald-500/10 p-2.5 text-emerald-600"><Undo2 size={20} /></div><div><h4 className="text-[12px] font-black uppercase tracking-[0.1em]">Return Policy</h4><p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Verified</p></div></div>
                <button onClick={() => setShowPolicyModal(true)} className="rounded-full bg-slate-900 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-lg active:scale-95 transition-all">View Details</button>
              </div>
            </div>
            <div className="mt-8 rounded-[2rem] bg-[var(--color-surface-low)] border border-[var(--color-surface-high)] overflow-hidden">
              <div className="flex items-center gap-3 px-6 py-5">
                <span className="relative flex h-3 w-3 shrink-0">
                  <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 ${stock <= 0 ? 'bg-red-500' : stock <= LOW_STOCK_LIMIT ? 'bg-amber-500 animate-ping' : 'bg-emerald-500 animate-ping'}`}></span>
                  <span className={`relative inline-flex rounded-full h-3 w-3 ${stock <= 0 ? 'bg-red-500' : stock <= LOW_STOCK_LIMIT ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-black tracking-tight text-[var(--color-on-surface)]">{stock <= 0 ? 'Out of Stock' : stock <= LOW_STOCK_LIMIT ? `Only ${stock} left in stock` : 'In Stock'}</div>
                  <p className="text-[12px] font-bold text-[var(--color-on-surface-variant)]">{stock > 0 ? 'Ready for fulfillment · Ships from JDLX warehouse' : 'Restocking soon — get notified below'}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 border-t border-[var(--color-surface-high)]">
                <div className="flex items-center gap-3 px-6 py-4 border-r border-[var(--color-surface-high)]">
                  <div className="p-2 rounded-xl bg-primary/10 text-primary shrink-0"><Truck size={18} /></div>
                  <div className="min-w-0"><div className="text-[13px] font-black text-[var(--color-on-surface)] truncate">{deliveryTimeDisplay}</div><p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-on-surface-variant)]">Delivery</p></div>
                </div>
                <div className="flex items-center gap-3 px-6 py-4">
                  <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500 shrink-0"><ShieldCheck size={18} /></div>
                  <div className="min-w-0"><div className="text-[13px] font-black text-[var(--color-on-surface)] truncate">Secure &amp; Verified</div><p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-on-surface-variant)]">Checkout</p></div>
                </div>
              </div>
            </div>

            <div className="mt-10 md:block hidden">
              {quantity > 0 ? (
                <div className="flex items-center gap-4">
                  <div className="flex h-16 items-center gap-8 rounded-3xl bg-slate-900 px-8 shadow-2xl">
                    <button onClick={() => quantity > 1 ? updateQuantity(product.id, quantity - 1, variantId) : removeFromCart(product.id, variantId)} className="text-white active:scale-75 transition-all"><Minus size={24} /></button>
                    <span className="text-2xl font-black text-white">{quantity}</span>
                    <button disabled={quantity >= stock} onClick={() => updateQuantity(product.id, quantity + 1, variantId)} className="text-white active:scale-75 transition-all disabled:opacity-20"><Plus size={24} /></button>
                  </div>
                  <Link to="/cart" className="flex-1 h-16 rounded-3xl bg-primary text-slate-950 font-black text-sm uppercase tracking-widest shadow-xl flex items-center justify-center active:scale-95 transition-all">View in Cart</Link>
                  <button onClick={handleShare} className="h-16 w-16 flex items-center justify-center rounded-3xl border-2 border-[var(--color-surface-high)] bg-[var(--color-surface-low)] text-[var(--color-on-surface-variant)] hover:text-primary hover:border-primary/20 hover:shadow-lg active:scale-90 transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] group"><Share2 size={24} className="group-hover:rotate-12 transition-transform" /></button>
                </div>
              ) : (
                <div className="space-y-4">
                  {requiresDeviceModel && <div className="p-6 rounded-[2rem] bg-[var(--color-surface-low)] border border-[var(--color-surface-high)]"><DeviceModelSelector value={deviceModel} onChange={setDeviceModel} required /></div>}
                  <div className="flex items-center gap-4">
{canAdd && hasAvailableCombinations ? (
                      <><button onClick={() => handleAddToCart()} className="flex-1 h-12 rounded-2xl bg-white/10 text-white text-[11px] font-black uppercase tracking-widest border border-white/10 active:scale-95 flex items-center justify-center gap-2"><ShoppingCart size={14} /> Add</button>
                        <button onClick={() => handleAddToCart(true)} className="flex-[1.5] h-12 rounded-2xl bg-primary text-slate-950 text-[11px] font-black uppercase tracking-widest shadow-lg active:scale-95">Buy Now</button>
                        <button onClick={() => { toggleWishlist(product); toast.success(isInWishlist ? 'Removed from favorites' : 'Saved to favorites'); }} className={`h-12 w-12 flex items-center justify-center rounded-2xl border transition-all active:scale-90 ${isInWishlist ? 'bg-rose-500 border-rose-500 text-white shadow-lg' : 'bg-white/10 border-white/10 text-white'}`} style={{ animation: isInWishlist ? 'heartPop 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) both' : 'none' }}><Heart size={18} fill={isInWishlist ? 'currentColor' : 'none'} /></button>
                        <button onClick={handleShare} className="h-12 w-12 flex items-center justify-center rounded-2xl bg-white/10 text-white border border-white/10 active:scale-90 transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] group"><Share2 size={18} className="group-hover:rotate-12 transition-transform" /></button></>
                    ) : (
                      <div className="flex w-full gap-2">
                        {hasAvailableCombinations && !canAdd && stock <= 0 ? (
                          <button disabled className="h-12 flex-1 rounded-2xl bg-[var(--color-surface-high)] text-[var(--color-on-surface-variant)] text-[11px] font-black uppercase tracking-widest border border-[var(--color-surface-high)] cursor-not-allowed flex items-center justify-center gap-2">
                            <ShoppingCart size={14} /> Out of Stock
                          </button>
                        ) : (!hasAvailableCombinations && Object.keys(selectedOptions).length > 0 ? (
                          <button disabled className="h-12 flex-1 rounded-2xl bg-rose-100 text-rose-500 text-[11px] font-black uppercase tracking-widest border border-rose-200 cursor-not-allowed flex items-center justify-center gap-2">
                            <AlertCircle size={14} /> Unavailable
                          </button>
                        ) : (
                          <button disabled={isNotified} onClick={async () => { if (!isNotified) { const res = await registerForNotification(product.id, user?.email); if (res.success) { toast.success(res.message); setIsNotified(true); } } }} className={`h-12 flex-1 rounded-2xl font-black text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 ${isNotified ? 'bg-emerald-500 text-white' : 'bg-primary text-slate-950'}`}>
                            {isNotified ? <CheckCircle2 size={16} /> : <Bell size={16} />} {isNotified ? 'Notified' : 'Notify on Restock'}
                          </button>
                        ))}
                        <button onClick={() => { toggleWishlist(product); toast.success(isInWishlist ? 'Removed from favorites' : 'Saved to favorites'); }} className={`h-12 w-12 flex items-center justify-center rounded-2xl border transition-all active:scale-90 ${isInWishlist ? 'bg-rose-500 border-rose-500 text-white shadow-lg' : 'bg-white/10 border-white/10 text-white'}`} style={{ animation: isInWishlist ? 'heartPop 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) both' : 'none' }}><Heart size={18} fill={isInWishlist ? 'currentColor' : 'none'} /></button>
                        <button onClick={handleShare} className="h-12 w-12 flex items-center justify-center rounded-2xl bg-white/10 text-white border border-white/10 active:scale-90 transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] group"><Share2 size={18} className="group-hover:rotate-12 transition-transform" /></button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Mobile-only Customization */}
            <div className="md:hidden space-y-6 mt-6">
               {requiresDeviceModel && <div className="p-6 rounded-[2.5rem] bg-[var(--color-surface-low)] border border-[var(--color-surface-high)]" id="device-model-selector"><DeviceModelSelector value={deviceModel} onChange={setDeviceModel} required /></div>}
               {/* Note: the mobile 'Expert Fitting' toggle block was removed —
                   it was gated behind a hardcoded `false &&` so it never
                   rendered. The `fitting` state is still used by
                   handleAddToCart, so cart logic is unchanged. */}
            </div>
          </div>
          <div className="glass-card p-4 md:p-8 rounded-[2.5rem]">
            <div className="flex p-1.5 bg-[var(--color-surface-container)] rounded-full gap-1 mb-8">
              {['overview', 'highlights', 'reviews'].map((tab) => (<button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 rounded-full py-3 text-[11px] font-black uppercase tracking-[0.2em] transition-all duration-300 ${activeTab === tab ? 'bg-slate-900 text-white shadow-lg' : 'text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)]'}`}>{tab}</button>))}
            </div>
            {activeTab === 'overview' && <div className="space-y-8 animate-in fade-in duration-500"><div className="grid grid-cols-1 md:grid-cols-2 gap-6"><div className="rounded-[2rem] p-6 bg-primary/5 border border-amber-400/10"><div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary"><Truck size={20} /></div><h4 className="ui-label text-primary">Fulfillment</h4></div><p className="text-sm font-bold opacity-80">Safe & trusted order fulfillment dispatched directly to your location.</p></div><div className="rounded-[2rem] p-6 bg-emerald-500/5 border border-emerald-500/10"><div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-600"><ShieldCheck size={20} /></div><h4 className="ui-label text-emerald-600">Quality Checked</h4></div><p className="text-sm font-bold opacity-80">Inspected before dispatch for quality assurance.</p></div></div><div className="p-8 rounded-[2rem] bg-[var(--color-surface-low)] border border-[var(--color-surface-high)]"><p className="text-[15px] font-bold opacity-60 leading-relaxed">{activeProduct.description || `A premium daily essential from the JDLX collection.`}</p></div></div>}
            {activeTab === 'highlights' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in fade-in duration-500">{highlights.map((h) => (<div key={h} className="flex items-center gap-4 p-5 rounded-3xl bg-[var(--color-surface-card)] border border-[var(--color-surface-high)] shadow-sm"><div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center text-white shrink-0"><CheckCircle2 size={14} /></div><span className="text-[13px] font-bold text-[var(--color-on-surface)]">{h}</span></div>))}</div>}
            {activeTab === 'reviews' && <div className="animate-in fade-in duration-500"><ProductReviews productId={product.id} /></div>}
          </div>
        </div>
      </section>

      {/* Policy Modal */}
      {showPolicyModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setShowPolicyModal(false)} />
          <div className="relative w-full max-w-lg bg-[var(--color-surface-card)] rounded-[2.5rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="bg-slate-900 p-8 text-white relative"><button onClick={() => setShowPolicyModal(false)} className="absolute top-6 right-6 p-2 rounded-full bg-white/10"><X size={20} /></button><div className="flex items-center gap-4"><div className="p-3 bg-white/10 rounded-2xl"><ShieldCheck size={24} className="text-emerald-400" /></div><div><h3 className="text-2xl font-black tracking-tight">Protection</h3><p className="ui-label text-slate-400">Verified by JDLX</p></div></div></div>
            <div className="p-8 max-h-[60vh] overflow-y-auto no-scrollbar bg-[var(--color-surface-card)]"><div className="space-y-4">{(product.final_return_policy || '7 Days Return Policy').split('\n').filter(p => p.trim()).map((p, i) => (<div key={i} className="flex items-start gap-4 p-4 rounded-2xl bg-[var(--color-surface-low)] border border-[var(--color-surface-high)]"><div className="w-2 h-2 rounded-full bg-[var(--color-on-surface)] mt-1.5 shrink-0" /><p className="text-[13px] font-bold text-[var(--color-on-surface)] leading-relaxed">{p.replace(/\*\*/g, '').replace(/^\s*[*-]\s*/, '').trim()}</p></div>))}</div></div>
            <div className="p-6 bg-[var(--color-surface-low)] border-t border-[var(--color-surface-high)]"><button onClick={() => setShowPolicyModal(false)} className="w-full py-4 bg-[var(--color-on-surface)] text-[var(--color-surface-card)] rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl active:scale-95 transition-all">Got it</button></div>
          </div>
        </div>
      )}

      {/* Mobile Sticky Bar */}
      <div className="fixed bottom-[104px] inset-x-0 z-[90] px-4 md:hidden">
         <div className="bg-slate-900/95 backdrop-blur-2xl border border-white/10 rounded-[2rem] p-3 shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-full duration-700">
            {quantity > 0 ? (
                <div className="flex w-full items-center gap-3">
                    <div className="flex h-12 flex-1 items-center justify-between rounded-2xl bg-white/10 px-4 border border-white/10">
                        <button onClick={() => quantity > 1 ? updateQuantity(product.id, quantity - 1, variantId) : removeFromCart(product.id, variantId)} className="text-white active:scale-75"><Minus size={18} /></button>
                        <span className="text-lg font-black text-white">{quantity}</span>
                        <button disabled={quantity >= stock} onClick={() => updateQuantity(product.id, quantity + 1, variantId)} className="text-white active:scale-75 disabled:opacity-20"><Plus size={18} /></button>
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
    <div className="mt-20 border-t border-[var(--color-surface-high)] pt-16">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10"><div><span className="ui-label text-primary mb-3 block">From the same aisle</span><h2 className="text-3xl font-black tracking-tighter">You May Also Like</h2></div><Link to="/" className="text-sm font-bold text-primary flex items-center gap-2 group">View Collection <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" /></Link></div>
      <div className="flex gap-6 overflow-x-auto pb-8 no-scrollbar reveal-staggered">
        {recommendations.map(p => (<Link key={p.id} to={getProductUrl(p)} className="flex-shrink-0 w-64 glass-card rounded-[32px] overflow-hidden group hover:-translate-y-2 transition-all duration-500"><div className="aspect-square bg-[var(--color-surface-low)] overflow-hidden"><img src={getProductImages(p)[0]} alt={p.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" /></div><div className="p-6"><h4 className="font-bold text-[var(--color-on-surface)] truncate mb-1">{p.name}</h4><div className="text-lg font-black text-primary">₹{p.price}</div></div></Link>))}
      </div>
    </div>
  );
}
