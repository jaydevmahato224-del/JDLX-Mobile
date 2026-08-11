import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronRight, RefreshCw, Search, ShoppingBag, Plus, Minus, SlidersHorizontal, Package, CheckCircle2, XCircle, Heart as HeartIcon, Zap, Star, Truck, ShieldCheck } from 'lucide-react'

import BlurImage from '../../components/BlurImage'
import PaginationLoader from '../../components/PaginationLoader'
import ProductEmptyState from '../../components/ProductEmptyState'
import ProductErrorState from '../../components/ProductErrorState'
import ProductLoadingGrid from '../../components/ProductLoadingGrid'
import PromoBanner from '../../components/PromoBanner'
import RecommendationsSection from '../../components/RecommendationsSection'
import useSmartProductLoader from '../../hooks/useSmartProductLoader'
import { API_BASE_URL, resolveMediaUrl } from '../../config'
import { useStore } from '../../store/useStore'
import { refreshRecentlyViewed } from '../../utils/recentlyViewedSync'
import { isStickerProduct } from '../../utils/stickerCustomization'
import { getProductUrl } from '../../utils/productSlug'
import { useAnalyticsContext } from '../../context/AnalyticsContext'

const LOW_STOCK_LIMIT = 2

function getFirstName(user) {
  const name = user?.name || 'Guest'
  return String(name).trim().split(' ')[0] || 'Guest'
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return { text: 'Good morning', icon: '👋' }
  if (hour < 17) return { text: 'Good afternoon', icon: '☀️' }
  if (hour < 21) return { text: 'Good evening', icon: '✨' }
  return { text: 'Welcome back', icon: '🌙' }
}

function getProductImage(product) {
  let images =
    product?.image_url ||
    product?.images ||
    product?.image ||
    product?.thumbnail ||
    product?.photo ||
    null

  if (!images) return 'https://placehold.co/800x800/f8fafc/0f172a?text=JDLX'

  // Handle JSON string of images (array)
  if (typeof images === 'string' && images.startsWith('[')) {
    try {
      const parsed = JSON.parse(images)
      if (Array.isArray(parsed) && parsed.length > 0) {
        images = parsed[0]
      }
    } catch (e) {
      // Not valid JSON, continue with original string
    }
  }

  // Handle case where images is already an array
  if (Array.isArray(images) && images.length > 0) {
    images = images[0]
  }

  // Final check if we still have a string
  if (typeof images !== 'string') {
    return 'https://placehold.co/800x800/f8fafc/0f172a?text=JDLX'
  }

  return resolveMediaUrl(images)
}

const ProductCard = memo(({ product, onAddToCart, disabled }) => {
  const navigate = useNavigate()
  const cartItem = useStore((state) => state.cart.find((item) => String(item.id) === String(product.id)))
  const isInWishlist = useStore((state) => state.wishlist.some(item => String(item.id) === String(product.id)))
  
  const toggleWishlist = useStore((state) => state.toggleWishlist)
  const updateQuantity = useStore((state) => state.updateQuantity)
  const removeFromCart = useStore((state) => state.removeFromCart)
  const [isSyncing, setIsSyncing] = useState(false)

  const quantity = cartItem ? Number(cartItem.qty || 0) : 0;

  const stock = Number(product?.stock ?? 0)
  const reservedStock = Number(product?.reserved_stock ?? 0)
  const availableStock = Math.max(0, stock - reservedStock)
  const outOfStock = availableStock <= 0

  const handleWishlistToggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleWishlist(product);
    if (isInWishlist) {
      toast.success('Removed from wishlist');
    } else {
      toast.success('Added to wishlist');
    }
  }

  const handleIncrease = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/products/${product.id}/stock`);
      const json = await res.json();
      const stockData = json.data || {};
      
      if (res.ok && stockData.available <= quantity) {
        toast.error(`No more units available`, {
          icon: '🚫',
          style: { borderRadius: '15px', background: '#333', color: '#fff', fontSize: '12px', fontWeight: 'bold' }
        });
      } else {
        updateQuantity(product.id, quantity + 1);
      }
    } catch (err) {
      console.error('Stock check failed:', err);
      updateQuantity(product.id, quantity + 1);
    } finally {
      setIsSyncing(false);
    }
  }

  const handleDecrease = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (quantity > 1) {
      updateQuantity(product.id, quantity - 1);
    } else {
      removeFromCart(product.id);
    }
  }

  const handleAddToCartWithCheck = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/products/${product.id}/stock`);
      const json = await res.json();
      const stockData = json.data || {};

      if (res.ok && stockData.available <= 0) {
        toast.error(`Out of stock`, { icon: '🚫' });
      } else {
        onAddToCart(product);
        toast.success('Added to collection');
      }
    } catch (err) {
      onAddToCart(product);
      toast.success('Added to collection');
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <article className="gpu-accelerated group relative flex flex-col h-full bg-[var(--color-surface-white)] rounded-[1.5rem] md:rounded-[2rem] overflow-hidden border border-[var(--color-surface-high)] transition-all duration-500 hover:shadow-[0_20px_50px_rgba(0,0,0,0.1)] hover:-translate-y-2 hover:border-primary/20">
      <div onClick={() => navigate(getProductUrl(product))} className="relative block aspect-square overflow-hidden bg-[var(--color-surface-low)]/30 cursor-pointer">
        {/* Dynamic Badges Overlay */}
        <div className="absolute top-2 left-2 md:top-4 md:left-4 z-20 flex flex-col gap-1 md:gap-2">
          {outOfStock ? (
            <span className="bg-slate-900/90 backdrop-blur text-white text-[10px] font-black px-2 py-0.5 md:px-2.5 md:py-1 rounded-full uppercase tracking-widest shadow-xl">
              Sold Out
            </span>
          ) : availableStock <= LOW_STOCK_LIMIT ? (
            <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 md:px-2.5 md:py-1 rounded-full uppercase tracking-widest shadow-lg shadow-red-500/20 animate-pulse">
              Low Stock
            </span>
          ) : (Number(product.is_featured) === 1 || product.is_featured === true) ? (
            <span className="bg-primary text-white text-[10px] font-black px-2 py-0.5 md:px-2.5 md:py-1 rounded-full uppercase tracking-widest shadow-lg shadow-primary/30 animate-soft-glow">
              Premium
            </span>
          ) : product.average_rating >= 4.5 ? (
            <span className="bg-emerald-500 text-white text-[10px] font-black px-2 py-0.5 md:px-2.5 md:py-1 rounded-full uppercase tracking-widest shadow-lg shadow-emerald-500/20">
              Best Seller
            </span>
          ) : (
            <span className="bg-blue-500 text-white text-[10px] font-black px-2 py-0.5 md:px-2.5 md:py-1 rounded-full uppercase tracking-widest shadow-lg shadow-blue-500/20">
              New
            </span>
          )}
        </div>

        {/* Wishlist Button */}
        <button 
          onClick={handleWishlistToggle}
          className={`absolute top-2 right-2 md:top-4 md:right-4 z-20 h-8 w-8 md:h-10 md:w-10 flex items-center justify-center rounded-full backdrop-blur-md transition-all duration-300 ${isInWishlist ? 'bg-red-500 text-white shadow-lg' : 'bg-white/80 text-slate-400 hover:text-red-500 hover:bg-white'}`}
        >
          <HeartIcon size={14} className="md:w-[18px] md:h-[18px]" fill={isInWishlist ? "currentColor" : "none"} strokeWidth={2.5} />
        </button>

        <div className="h-full w-full p-4 md:p-8 transition-transform duration-1000 cubic-bezier(0.4, 0, 0.2, 1) group-hover:scale-110">
          <BlurImage
            src={getProductImage(product)}
            alt={product.name}
            className="h-full w-full object-contain drop-shadow-2xl"
          />
        </div>
      </div>

      <div className="p-4 md:p-8 flex-1 flex flex-col gap-2 md:gap-4">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] md:tracking-[0.3em] text-primary/60">
              {product.category || 'Elite'}
            </span>
            {product.average_rating > 0 ? (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-100">
                <Star size={8} fill="currentColor" className="text-emerald-500" />
                <span className="text-[9px] md:text-[10px] font-black text-emerald-700">{Number(product.average_rating).toFixed(1)}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 border border-blue-100">
                <ShieldCheck size={8} className="text-blue-500" />
                <span className="text-[10px] font-black text-blue-700 uppercase tracking-tighter">Verified</span>
              </div>
            )}
          </div>
          <h3 className="line-clamp-2 text-sm md:text-base font-black text-[var(--color-on-surface)] leading-tight group-hover:text-primary transition-colors min-h-[2.5em]">
            {product.name}
          </h3>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 md:gap-4">
          <div className="space-y-0.5 md:space-y-1">
             <div className="flex items-baseline gap-1 md:gap-2">
               <span className="text-lg md:text-2xl font-black text-[var(--color-on-surface)] tracking-tighter">₹{product.price}</span>
               {product.mrp > product.price && (
                 <span className="text-[10px] md:text-xs text-slate-400 line-through font-bold">₹{product.mrp}</span>
               )}
             </div>
             {product.mrp > product.price && (
               <span className="block text-[10px] font-black text-emerald-600 uppercase">Save {Math.round(((product.mrp - product.price) / product.mrp) * 100)}%</span>
             )}
          </div>

          {quantity > 0 ? (
            <div className="flex items-center bg-slate-900 rounded-xl md:rounded-2xl p-0.5 md:p-1 shadow-xl">
              <button
                onClick={handleDecrease}
                className="h-7 w-7 md:h-8 md:w-8 flex items-center justify-center text-white hover:bg-white/10 rounded-lg md:rounded-xl transition-all active:scale-90"
              >
                <Minus size={14} />
              </button>
              <span className="min-w-[20px] md:min-w-[28px] text-center text-xs md:text-sm font-black text-white">
                {isSyncing ? '..' : quantity}
              </span>
              <button
                disabled={quantity >= availableStock || isSyncing}
                onClick={handleIncrease}
                className="h-7 w-7 md:h-8 md:w-8 flex items-center justify-center text-white hover:bg-white/10 rounded-lg md:rounded-xl transition-all active:scale-90 disabled:opacity-30"
              >
                <Plus size={14} />
              </button>
            </div>
          ) : (
            <button
              disabled={disabled || outOfStock || isSyncing}
              onClick={handleAddToCartWithCheck}
              className="h-9 md:h-11 px-3 md:px-6 btn-primary rounded-xl md:rounded-2xl shadow-lg shadow-primary/20 text-xs md:text-sm"
            >
              {isSyncing ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={16} />}
              <span className="hidden xs:inline">{isSyncing ? '...' : 'Add'}</span>
            </button>
          )}
        </div>
      </div>
    </article>
  )
})

function CategoryChips({ categories, selected, onSelect }) {
  const categoryList = Array.isArray(categories) ? categories : []
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-4 no-scrollbar -mx-2 px-2">
      <button
        onClick={() => onSelect('All')}
        className={`category-chip ${selected === 'All' ? 'active' : ''}`}
      >
        All Products
      </button>
      {categoryList.map((cat) => (
        <button
          key={cat.id || cat.name}
          onClick={() => onSelect(cat.id)}
          className={`category-chip ${selected === cat.id ? 'active' : ''}`}
        >
          {cat.name}
        </button>
      ))}
    </div>
  )
}

function FiltersBar({ inputRef, query, onQueryChange, stockFilter, onStockFilterChange, sortBy, onSortByChange, hasActiveFilters, onClear }) {
  return (
    <div className="flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between border-t border-slate-100">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search items by name or category..."
          className="w-full h-12 rounded-2xl bg-slate-50 pl-11 pr-4 text-sm font-bold border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all"
        />
      </div>

      <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
        <select
          value={stockFilter}
          onChange={(e) => onStockFilterChange(e.target.value)}
          className="glass-dropdown h-12 px-6"
        >
          <option value="all">Availability: All</option>
          <option value="in-stock">In Stock Only</option>
          <option value="low-stock">Low Stock</option>
        </select>

        <select
          value={sortBy}
          onChange={(e) => onSortByChange(e.target.value)}
          className="glass-dropdown h-12 px-6"
        >
          <option value="recommended">Sort: Recommended</option>
          <option value="price-low">Price: Low to High</option>
          <option value="price-high">Price: High to Low</option>
          <option value="newest">Newest First</option>
        </select>

        {hasActiveFilters && (
          <button
            onClick={onClear}
            className="h-12 px-5 rounded-2xl bg-red-50 text-red-600 text-xs font-black uppercase tracking-widest hover:bg-red-100 transition-all whitespace-nowrap"
          >
            Clear Filters
          </button>
        )}
      </div>
    </div>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const location = useLocation()
  const observerRef = useRef(null)
  const searchInputRef = useRef(null)
  
  const user = useStore((state) => state.user)
  const token = useStore((state) => state.token)
  const cartCount = useStore((state) => state.cart.length)
  const wishlistCount = useStore((state) => state.wishlist.length)
  
  const recentlyViewed = useStore((state) => state.recentlyViewed)
  const addToRecentlyViewed = useStore((state) => state.addToRecentlyViewed)
  const fetchWishlist = useStore((state) => state.fetchWishlist)
  const addToCart = useStore((state) => state.addToCart)
  const { trackEvent } = useAnalyticsContext();

  useEffect(() => {
    if (token) {
      fetchWishlist();
    }
  }, [token, fetchWishlist]);

  const storeBlocked = useStore((state) => state.storeBlocked)

  const {
    products,
    initialLoading,
    pageRefreshing,
    paginationLoading,
    hasError,
    errorMessage,
    hasLoadedOnce,
    hasMore,
    loadInitialProducts,
    loadMoreProducts,
    retryLoad,
    isWakingUp,
  } = useSmartProductLoader(20)

  const [categories, setCategories] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [stockFilter, setStockFilter] = useState('all')
  const [sortBy, setSortBy] = useState('recommended')

  const handleBannerClick = (url) => {
    if (!url) return;
    trackEvent('click', 'banner', url);
    let finalUrl = url.trim();
    const isExternal = /^(https?:\/\/)?(www\.)?(youtube\.com|instagram\.com|facebook\.com|twitter\.com|t\.me|googl\.com|linktr\.ee)/i.test(finalUrl);
    
    if (isExternal) {
      if (!/^https?:\/\//i.test(finalUrl)) finalUrl = `https://${finalUrl}`;
      window.open(finalUrl, '_blank');
    } else if (finalUrl.startsWith('/')) {
      navigate(finalUrl);
    } else if (finalUrl.startsWith('http')) {
      window.open(finalUrl, '_blank');
    } else {
      window.open(`https://${finalUrl}`, '_blank');
    }
  };

  const [banners, setBanners] = useState([])
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0)

  const featuredProducts = useMemo(() => products.filter(p => Number(p.is_featured) === 1 || p.is_featured === true), [products])
  const regularProducts = useMemo(() => products.filter(p => !p.is_featured), [products])

  // Continue Exploring: recentlyViewed is cached in localStorage with a product
  // snapshot, so its image URLs can be stale (e.g. after the images were migrated
  // to cloud storage). Overlay fresh catalog data by id so every card shows the
  // latest image/price/stock — cached entries without a fresh match stay as-is.
  const freshRecentlyViewed = useMemo(
    () => refreshRecentlyViewed(recentlyViewed, products),
    [recentlyViewed, products]
  )

  const allBanners = useMemo(() => {
    const apiBanners = banners.map(b => ({ ...b, image: resolveMediaUrl(b.image_url), type: 'promo' }));
    const productBanners = featuredProducts.slice(0, 3).map(p => ({
      id: `prod-${p.id}`,
      title: p.name,
      subtitle: p.description || "Premium JDLX Mobile Collection",
      cta_text: "Shop Now",
      image: getProductImage(p),
      badge_text: "Featured",
      gradient: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
      link_url: getProductUrl(p),
      type: 'product'
    }));
    return [...apiBanners, ...productBanners];
  }, [banners, featuredProducts]);

  // Swipe Logic Refs
  const bannerTouchStart = useRef(0)
  const bannerTouchEnd = useRef(0)
  const SWIPE_THRESHOLD = 50

  const handleBannerNext = useCallback(() => {
    setCurrentBannerIndex(prev => (prev + 1) % allBanners.length)
  }, [allBanners.length])

  const handleBannerPrev = useCallback(() => {
    setCurrentBannerIndex(prev => (prev - 1 + allBanners.length) % allBanners.length)
  }, [allBanners.length])

  useEffect(() => {
    if (allBanners.length <= 1) return
    
    const interval = setInterval(() => {
      setCurrentBannerIndex(prev => (prev + 1) % allBanners.length)
    }, 5000)
    
    return () => clearInterval(interval)
  }, [allBanners.length])

  const resetBannerTimer = useCallback(() => {
    // This now just triggers a re-render of the effect above by dependency logic if needed,
    // but we'll keep it as a no-op or simple index reset to avoid disrupting existing swipe logic.
    // The main interval is now cleanly managed by the dedicated useEffect.
  }, [])

  // Swipe Handlers
  const onBannerTouchStart = useCallback((e) => {
    bannerTouchStart.current = e.targetTouches[0].clientX
  }, [])

  const onBannerTouchMove = useCallback((e) => {
    bannerTouchEnd.current = e.targetTouches[0].clientX
  }, [])

  const onBannerTouchEnd = useCallback(() => {
    if (!bannerTouchStart.current || !bannerTouchEnd.current) return
    const distance = bannerTouchStart.current - bannerTouchEnd.current
    if (Math.abs(distance) > SWIPE_THRESHOLD) {
      if (distance > 0) handleBannerNext()
      else handleBannerPrev()
      resetBannerTimer()
    }
    bannerTouchStart.current = 0
    bannerTouchEnd.current = 0
  }, [handleBannerNext, handleBannerPrev, resetBannerTimer])

  const onBannerMouseDown = useCallback((e) => {
    bannerTouchStart.current = e.clientX
    if (e.target.tagName === 'IMG') e.preventDefault()
  }, [])

  const onBannerMouseMove = useCallback((e) => {
    if (bannerTouchStart.current) {
      bannerTouchEnd.current = e.clientX
    }
  }, [])

  const onBannerMouseUp = useCallback(() => {
    if (bannerTouchStart.current && bannerTouchEnd.current) {
      const distance = bannerTouchStart.current - bannerTouchEnd.current
      if (Math.abs(distance) > SWIPE_THRESHOLD) {
        if (distance > 0) handleBannerNext()
        else handleBannerPrev()
        resetBannerTimer()
      }
    }
    bannerTouchStart.current = 0
    bannerTouchEnd.current = 0
  }, [handleBannerNext, handleBannerPrev, resetBannerTimer])
  
  const globalSearchQuery = useStore((state) => state.globalSearchQuery)
  const setGlobalSearchQuery = useStore((state) => state.setGlobalSearchQuery)
  const query = globalSearchQuery || ''
  const [debouncedQuery, setDebouncedQuery] = useState('')

  const greeting = useMemo(() => getGreeting(), []);

  const logInteraction = useCallback(async (type, targetId, category) => {
    try {
      const sessionId = localStorage.getItem('jdlx_session_id') || 'anon'
      await fetch(`${API_BASE_URL}/user/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // user object uses `id`, not `user_id` — support both for safety
          user_id: user?.id ?? user?.user_id ?? null,
          session_id: sessionId,
          interaction_type: type,
          target_id: String(targetId),
          category: category
        })
      })
    } catch (e) {
      console.error('Interaction logging failed:', e)
    }
  }, [user])





  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 800)
    return () => clearTimeout(timer)
  }, [query])



  const [offerBanners, setOfferBanners] = useState([])
  const [activeOffers, setActiveOffers] = useState([])

  useEffect(() => {
    fetch(`${API_BASE_URL}/categories`)
      .then((res) => res.json())
      .then((json) => setCategories(json.data || []))
      .catch((err) => console.error('Categories failed:', err))

    // Banners are preloaded in App.jsx via useStore.fetchBanners()
    // but we still sync them to local state for compatibility with existing useMemo
    const preloadedBanners = useStore.getState().banners;
    if (preloadedBanners && preloadedBanners.length > 0) {
      setBanners(preloadedBanners);
    } else {
      fetch(`${API_BASE_URL}/banners`)
        .then((r) => r.json())
        .then((json) => {
          if (json.success && json.data) {
            setBanners(json.data);
          }
        })
        .catch((e) => console.error('Banners failed:', e))
    }

    // Fetch Offer Banners
    fetch(`${API_BASE_URL}/offers/banners`)
      .then(res => res.json())
      .then(json => {
        if (json.success && Array.isArray(json.data)) {
          setOfferBanners(json.data)
        } else {
          setOfferBanners([])
        }
      })
      .catch(e => console.error('Offer banners failed:', e))

    // Fetch Active Offers (for text-based offer cards)
    fetch(`${API_BASE_URL}/offers/active`)
      .then(res => res.json())
      .then(json => {
        if (json.success && Array.isArray(json.data)) {
          setActiveOffers(json.data)
        }
      })
      .catch(e => console.error('Active offers failed:', e))
  }, [])



  useEffect(() => {
    loadInitialProducts(selectedCategory, debouncedQuery, null)
  }, [selectedCategory, debouncedQuery, loadInitialProducts])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !paginationLoading && !initialLoading) {
          loadMoreProducts()
        }
      },
      { threshold: 0.1, rootMargin: '200px' }
    )
    if (observerRef.current) observer.observe(observerRef.current)
    return () => observer.disconnect()
  }, [hasMore, paginationLoading, initialLoading, loadMoreProducts])

  if (hasError && !hasLoadedOnce) {
    return <ProductErrorState message={errorMessage} onRetry={retryLoad} />
  }

  return (
    <div className="space-y-16 pb-24 reveal-staggered">
      {/* 1. Personalized Header */}
      <section className="space-y-8 animate-in fade-in slide-in-from-top-4 duration-1000">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse shadow-[0_0_15px_rgba(245,158,11,0.6)]" />
            <span className="text-[10px] font-black uppercase tracking-[0.5em] text-[var(--color-on-surface)]/40">JDLX Digital Concierge</span>
          </div>
          
          <div className="space-y-2">
            <h1 className="text-2xl md:text-7xl font-black tracking-tight text-[var(--color-on-surface)] leading-tight md:leading-[0.95]">
              {greeting.text}, <span className="text-primary">{getFirstName(user)}</span> {greeting.icon}
            </h1>
            
            <p className="max-w-2xl text-[var(--color-on-surface-variant)] text-sm md:text-xl font-medium leading-relaxed opacity-80">
              {cartCount > 0 
                ? `You have ${cartCount} premium ${cartCount === 1 ? 'item' : 'items'} waiting in your cart.` 
                : wishlistCount > 0 
                  ? "Your favorites are waiting. Continue exploring the collection."
                  : "Experience the gold standard of mobile commerce. Curated for precision."}
            </p>
          </div>
        </div>

        {/* Recent Activity Dashboard */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
           {cartCount > 0 && (
             <Link to="/cart" className="flex items-center gap-2.5 px-4 py-2.5 bg-primary/5 border border-primary/10 rounded-2xl hover:bg-primary/10 transition-all group">
                <ShoppingBag size={14} className="text-primary group-hover:scale-110 transition-transform" />
                <span className="text-[11px] font-black uppercase tracking-wider text-primary">{cartCount} In Cart</span>
             </Link>
           )}
           
           {wishlistCount > 0 && (
             <Link to="/profile/wishlist" className="flex items-center gap-2.5 px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-2xl hover:bg-slate-100 transition-all group">
                <HeartIcon size={14} className="text-red-500 group-hover:scale-110 transition-transform" fill="currentColor" />
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-600">{wishlistCount} Saved</span>
             </Link>
           )}

           <div className="flex items-center gap-2.5 px-4 py-2.5 bg-emerald-50 border border-emerald-100 rounded-2xl">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[11px] font-black uppercase tracking-wider text-emerald-700">Live Inventory Active</span>
           </div>
        </div>
      </section>

      {/* 2. Recently Viewed (Personalized Discovery) */}
      {recentlyViewed.length > 0 && (
        <section className="content-visibility-auto space-y-8">
          <div className="flex items-center gap-4">
            <div className="h-10 w-1.5 bg-primary rounded-full shadow-[0_0_15px_rgba(245,158,11,0.4)]" />
            <div className="space-y-1">
              <h2 className="text-3xl font-black tracking-tight">Continue Exploring</h2>
              <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">Picked from your history</p>
            </div>
          </div>
          <div className="flex gap-4 md:gap-6 overflow-x-auto no-scrollbar pb-8 -mx-6 px-6">
            {freshRecentlyViewed.map((p) => (
              <div key={`recent-${p.id}`} className="min-w-[180px] xs:min-w-[200px] md:min-w-[320px]">
                <ProductCard product={p} onAddToCart={addToCart} disabled={storeBlocked} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. Dynamic Banner Carousel */}
      <section 
        className="content-visibility-auto gpu-accelerated relative overflow-hidden rounded-[40px] shadow-2xl shadow-primary/5 cursor-grab active:cursor-grabbing"
        onTouchStart={onBannerTouchStart}
        onTouchMove={onBannerTouchMove}
        onTouchEnd={onBannerTouchEnd}
        onMouseDown={onBannerMouseDown}
        onMouseMove={onBannerMouseMove}
        onMouseUp={onBannerMouseUp}
        onMouseLeave={onBannerMouseUp}
      >
        {allBanners.length > 0 ? (
          <div className="relative">
            <div className="flex transition-transform duration-1000 cubic-bezier(0.4, 0, 0.2, 1)" style={{ transform: `translateX(-${currentBannerIndex * 100}%)` }}>
              {allBanners.map((b, idx) => (
                <div key={b.id} className="w-full flex-shrink-0 select-none">
                  <PromoBanner {...b} cta={b.cta_text} onClick={() => handleBannerClick(b.link_url)} priority={idx === 0} />
                </div>
              ))}
            </div>
            {allBanners.length > 1 && (
              <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-2.5 z-20">
                {allBanners.map((_, idx) => (
                  <button key={idx} onClick={() => { setCurrentBannerIndex(idx); resetBannerTimer(); }} 
                    className={`h-1.5 rounded-full transition-all duration-500 ${currentBannerIndex === idx ? 'w-10 bg-white' : 'w-1.5 bg-white/30'}`} />
                ))}
              </div>
            )}
          </div>
        ) : <PromoBanner />}
      </section>

      {/* Offer Banners */}
      {Array.isArray(offerBanners) && offerBanners.length > 0 && (
        <section className="content-visibility-auto -mx-4 px-4 md:-mx-6 md:px-6 overflow-x-auto no-scrollbar snap-x snap-mandatory flex gap-4 pb-4">
          {offerBanners.map(offer => (
            <div 
              key={offer.id} 
              className="snap-center shrink-0 w-[280px] h-[120px] rounded-2xl overflow-hidden shadow-lg cursor-pointer bg-slate-100 relative group"
              onClick={() => {
                 trackEvent('click', 'offer_banner', offer.title);
                 // Determine route based on applicable_on
                 if (offer.applicable_on === 'category' && offer.applicable_ids?.length) {
                    navigate('/?category_id=' + offer.applicable_ids[0]);
                 } else if (offer.applicable_on === 'product' && offer.applicable_ids?.length) {
                    // Find product in our list to get its share_token for a secure URL
                    const p = products.find(prod => String(prod.id) === String(offer.applicable_ids[0]));
                    if (p) navigate(getProductUrl(p));
                    else {
                      // If product not found in local state, we use the secure utility with just the ID
                      // This will generate /p/product-:id which is safer than /product/:id
                      navigate(getProductUrl({ id: offer.applicable_ids[0] }), { replace: true });
                    }
                 } else {
                    navigate('/search?q=offers');
                 }
              }}
            >
              <img src={resolveMediaUrl(offer.banner_image)} alt={offer.title} loading="lazy" decoding="async" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex flex-col justify-end p-4">
                 <h3 className="text-white font-black text-sm tracking-tight">{offer.title}</h3>
                 <p className="text-white/80 text-[10px] font-bold uppercase tracking-widest">{offer.description || 'Exclusive Offer'}</p>
              </div>
            </div>
          ))}
        </section>
      )}
      {/* Active Offers Section */}
      {activeOffers.length > 0 && (
        <section className="content-visibility-auto space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-10 w-1.5 bg-gradient-to-b from-amber-500 to-orange-500 rounded-full shadow-[0_0_15px_rgba(245,158,11,0.4)]" />
              <div className="space-y-1">
                <h2 className="text-2xl md:text-3xl font-black tracking-tight">Deals & Offers</h2>
                <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">Exclusive savings for you</p>
              </div>
            </div>
            <button
              onClick={() => navigate('/profile/coupons')}
              className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-1.5 hover:opacity-70 transition-opacity bg-primary/5 px-3 py-1.5 rounded-full"
            >
              View All <ChevronRight size={14} />
            </button>
          </div>

          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-4 -mx-2 px-2 snap-x snap-mandatory">
            {activeOffers.map((offer, i) => {
              const gradients = [
                'from-amber-500 to-orange-600',
                'from-emerald-500 to-teal-600',
                'from-violet-500 to-purple-600',
                'from-rose-500 to-pink-600',
                'from-blue-500 to-indigo-600',
              ];
              const grad = gradients[i % gradients.length];

              return (
                <div
                  key={offer.id}
                  onClick={() => trackEvent('click', 'offer_card', offer.title)}
                  className="snap-center flex-shrink-0 w-[280px] md:w-[320px] rounded-[24px] bg-white border border-slate-100 shadow-lg overflow-hidden hover:shadow-xl transition-all duration-500 hover:-translate-y-1"
                >
                  {/* Gradient Accent */}
                  <div className={`h-1.5 bg-gradient-to-r ${grad}`} />

                  <div className="p-5 space-y-4">
                    {/* Title + Type */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-base font-black text-slate-900 tracking-tight leading-tight truncate">{offer.title}</h3>
                        {offer.description && (
                          <p className="text-[11px] text-slate-400 font-medium mt-0.5 truncate">{offer.description}</p>
                        )}
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-gradient-to-r ${grad} text-white flex-shrink-0`}>
                        {offer.offer_type}
                      </span>
                    </div>

                    {/* Discount */}
                    <div className="flex items-center gap-4 py-3 px-4 bg-slate-50 rounded-xl border border-slate-100">
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Discount</p>
                        <p className="text-xl font-black text-slate-900 tracking-tighter">
                          {offer.discount_type === 'percentage' ? `${offer.discount_value}%` : `₹${offer.discount_value}`}
                          <span className="text-xs ml-1 text-primary font-black">OFF</span>
                        </p>
                      </div>
                      {offer.min_order_amount > 0 && (
                        <div className="border-l border-slate-200 pl-4">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Min. Order</p>
                          <p className="text-sm font-black text-slate-700">₹{offer.min_order_amount}</p>
                        </div>
                      )}
                    </div>

                    {/* Coupon Code */}
                    {offer.coupon_code ? (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(offer.coupon_code);
                          toast.success(`Copied: ${offer.coupon_code}`, {
                            icon: '📋',
                            style: { borderRadius: '16px', background: '#1e293b', color: '#fff', fontSize: '12px', fontWeight: 'bold' }
                          });
                        }}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-slate-200 text-sm font-black text-slate-700 uppercase tracking-widest hover:border-primary hover:bg-primary/5 transition-all active:scale-95"
                      >
                        <span>{offer.coupon_code}</span>
                        <span className="text-[9px] text-slate-400 normal-case tracking-normal font-bold">Tap to copy</span>
                      </button>
                    ) : (
                      <div className="flex items-center justify-center gap-2 py-2 bg-emerald-50 border border-emerald-100 rounded-xl">
                        <Zap size={12} className="text-emerald-500" />
                        <span className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Auto-Applied at Checkout</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 4. Trending Now (Curated Picks) — hidden when empty */}
      {featuredProducts.length > 0 && (
        <section className="content-visibility-auto space-y-10">
          <div className="flex items-end justify-between">
            <div className="space-y-1">
              <h2 className="text-3xl font-black tracking-tight">Trending Now</h2>
              <p className="text-slate-400 font-bold italic">Curated essentials for your device</p>
            </div>
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <Zap size={24} fill="currentColor" className="animate-pulse" />
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {featuredProducts.slice(0, 4).map(p => (
              <div key={`trending-${p.id}`} onClick={() => { logInteraction('view', p.id, p.category); addToRecentlyViewed(p); }}>
                <ProductCard product={p} onAddToCart={addToCart} disabled={storeBlocked} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5. New Arrivals (Latest Additions) — hidden when empty */}
      {regularProducts.length > 0 && (
        <section className="content-visibility-auto space-y-8">
          <div className="flex items-center gap-4">
            <div className="h-10 w-1.5 bg-emerald-500 rounded-full shadow-[0_0_15px_rgba(16,185,129,0.4)]" />
            <div className="space-y-1">
              <h2 className="text-3xl font-black tracking-tight">New Arrivals</h2>
              <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">Freshly added to collection</p>
            </div>
          </div>
          <div className="flex gap-4 md:gap-6 overflow-x-auto no-scrollbar pb-8 -mx-6 px-6">
            {regularProducts.slice(0, 6).map((p) => (
              <div key={`new-${p.id}`} className="min-w-[180px] xs:min-w-[200px] md:min-w-[320px]" onClick={() => addToRecentlyViewed(p)}>
                <ProductCard product={p} onAddToCart={addToCart} disabled={storeBlocked} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 6. Main Catalog (Elite Collection) */}
      <section className="content-visibility-auto space-y-10">
        <div className="flex items-center gap-4">
          <div className="h-10 w-1.5 bg-primary rounded-full shadow-[0_0_15px_rgba(245,158,11,0.4)]" />
          <h2 className="text-3xl font-black tracking-tight">Elite Catalog</h2>
        </div>
        
        {isWakingUp && initialLoading && !hasLoadedOnce && (
          <div className="flex items-center gap-3 justify-center py-4 bg-amber-50/50 border border-amber-100/60 rounded-[20px] shadow-sm animate-pulse">
            <Zap size={14} className="text-amber-500 animate-bounce" />
            <p className="text-[10px] font-black text-amber-700 uppercase tracking-[0.2em]">
              Waking up cloud server... Hang tight, almost ready! ✨
            </p>
          </div>
        )}
        
        {initialLoading && !hasLoadedOnce ? (
          <ProductLoadingGrid count={8} />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-8">
            {regularProducts.slice(6, 18).map((p) => (
              <div key={`main-${p.id}`} onClick={() => addToRecentlyViewed(p)}>
                <ProductCard product={p} onAddToCart={addToCart} disabled={storeBlocked} />
              </div>
            ))}
          </div>
        )}
        
        {hasMore && <div ref={observerRef} className="py-10 flex justify-center"><PaginationLoader /></div>}
      </section>

      <div className="content-visibility-auto">
        <RecommendationsSection />
      </div>
    </div>
  )
}
