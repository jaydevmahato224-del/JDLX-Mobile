import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronRight, RefreshCw, Search, ShoppingBag, Plus, Minus, SlidersHorizontal, Package, CheckCircle2, XCircle, Heart, Zap, Star } from 'lucide-react'

import BlurImage from '../../components/BlurImage'
import PaginationLoader from '../../components/PaginationLoader'
import ProductEmptyState from '../../components/ProductEmptyState'
import ProductErrorState from '../../components/ProductErrorState'
import ProductLoadingGrid from '../../components/ProductLoadingGrid'
import PromoBanner from '../../components/PromoBanner'
import RecommendationsSection from '../../components/RecommendationsSection'
import { useSmartProductLoader } from '../../hooks/useSmartProductLoader'
import { API_BASE_URL, resolveMediaUrl } from '../../config'
import { useStore } from '../../store/useStore'
import { isStickerProduct } from '../../utils/stickerCustomization'

const LOW_STOCK_LIMIT = 2

function getFirstName(user) {
  const name = user?.name || 'Guest'
  return String(name).trim().split(' ')[0] || 'Guest'
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
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
  const cart = useStore((state) => state.cart)
  const wishlist = useStore((state) => state.wishlist)
  const toggleWishlist = useStore((state) => state.toggleWishlist)
  const nearestStoreId = useStore((state) => state.nearestStoreId)
  const deliveryMode = useStore((state) => state.deliveryMode)
  const [isSyncing, setIsSyncing] = useState(false)

  const cartItem = cart.find((item) => item.id === product.id)
  const quantity = cartItem ? cartItem.qty : 0

  const isInWishlist = wishlist.some(item => item.id === product.id)

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
    if (isSyncing) return;

    if (isStickerProduct(product)) {
      toast('Select your device model on the product page');
      navigate(`/product/${product.id}`);
      return;
    }

    setIsSyncing(true);
    const storeId = deliveryMode === 'quick' ? nearestStoreId : null;
    try {
      const res = await fetch(`${API_BASE_URL}/products/${product.id}/stock${storeId ? `?store_id=${storeId}` : ''}`);
      const data = await res.json();
      
      if (res.ok) {
        if (data.available <= quantity) {
          toast.error(`Sorry, only ${data.available} units available right now`, {
            icon: '⚠️',
            style: { borderRadius: '15px', background: '#333', color: '#fff', fontSize: '12px', fontWeight: 'bold' }
          });
        } else {
          updateQuantity(product.id, quantity + 1);
        }
      } else {
        // Fallback to local check if API fails
        if (quantity < availableStock) {
          updateQuantity(product.id, quantity + 1);
        }
      }
    } catch (err) {
      console.error('Inventory sync failed:', err);
      if (quantity < availableStock) {
        updateQuantity(product.id, quantity + 1);
      }
    } finally {
      setIsSyncing(false);
    }
  }

  const handleAddToCartWithCheck = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isSyncing) return;

    setIsSyncing(true);
    const storeId = deliveryMode === 'quick' ? nearestStoreId : null;
    try {
      const res = await fetch(`${API_BASE_URL}/products/${product.id}/stock${storeId ? `?store_id=${storeId}` : ''}`);
      const data = await res.json();
      
      if (res.ok) {
        if (data.available <= 0) {
          toast.error(`Sorry, this item just went out of stock`, {
            icon: '🚫',
            style: { borderRadius: '15px', background: '#333', color: '#fff', fontSize: '12px', fontWeight: 'bold' }
          });
        } else {
          onAddToCart(product);
          toast.success('Added to cart');
        }
      } else {
        onAddToCart(product);
        toast.success('Added to cart');
      }
    } catch (err) {
      console.error('Initial add sync failed:', err);
      onAddToCart(product);
      toast.success('Added to cart');
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <article className="card-standard group relative flex flex-col h-full hover:border-primary/30 transition-all duration-300">
      <Link to={`/product/${product.id}`} className="relative block aspect-[1.1] overflow-hidden bg-slate-50">
        <div className="absolute top-3 left-3 z-20 flex flex-col gap-2">
          {outOfStock ? (
            (Number(product.is_featured) === 1 || product.is_featured === true) ? (
              <span className="rounded-full bg-indigo-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-600 border border-indigo-200 animate-pulse">
                Coming Soon
              </span>
            ) : (
              <span className="rounded-full bg-red-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-red-600 border border-red-200">
                Sold Out
              </span>
            )
          ) : availableStock <= LOW_STOCK_LIMIT ? (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-amber-600 border border-amber-200">
              Only {availableStock} left
            </span>
          ) : (Number(product.is_featured) === 1 || product.is_featured === true) && (
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-600 border border-indigo-100 shadow-sm">
              Featured
            </span>
          )}
        </div>

        {/* Wishlist Button */}
        <button 
          onClick={handleWishlistToggle}
          className={`absolute top-3 right-3 z-30 h-8 w-8 rounded-full flex items-center justify-center transition-all ${
            isInWishlist ? 'bg-red-50 text-red-500 shadow-sm' : 'bg-white/80 backdrop-blur-sm text-slate-400 hover:text-red-500'
          }`}
        >
          <Heart size={16} fill={isInWishlist ? 'currentColor' : 'none'} />
        </button>

        <div className="h-full w-full p-6 transition-transform duration-700 group-hover:scale-110">
          <BlurImage
            src={getProductImage(product)}
            alt={product?.name}
            className="h-full w-full object-contain drop-shadow-2xl"
          />
        </div>
      </Link>

      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">
                {product?.category || 'Curated'}
              </div>
              {deliveryMode === 'quick' && (
                <div className="flex items-center gap-1 text-emerald-500 text-[10px] font-black uppercase tracking-widest">
                  <Zap size={10} fill="currentColor" />
                  Quick
                </div>
              )}
            </div>
            <Link to={`/product/${product.id}`} className="block">
              <h3 className="mt-1 line-clamp-1 text-base font-black tracking-tight text-slate-900 hover:text-primary">
                {product?.name || 'Untitled'}
              </h3>
            </Link>
            
            {product.average_rating > 0 && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <div className="flex items-center gap-0.5 text-amber-400">
                  <Star size={12} fill="currentColor" />
                </div>
                <span className="text-[11px] font-black text-slate-700">
                  {Number(product.average_rating).toFixed(1)}
                </span>
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">
                  ({product.total_reviews} Reviews)
                </span>
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">MRP</div>
            <div className="text-lg font-black tracking-tight text-slate-900">₹{product?.price ?? 0}</div>
          </div>
        </div>

        <div className="mt-auto pt-4 flex items-center justify-between gap-3">
          <Link
            to={`/product/${product.id}`}
            className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-700 hover:bg-slate-200 active:scale-95 transition-all"
          >
            View
            <ChevronRight className="h-4 w-4" />
          </Link>

          {quantity > 0 ? (
            <div className="flex items-center gap-1 rounded-full bg-slate-900 p-1 shadow-lg shadow-slate-900/10">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  if (quantity === 1) {
                    removeFromCart(product.id)
                  } else {
                    updateQuantity(product.id, quantity - 1)
                  }
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-white hover:bg-white/10 active:scale-90 transition-all"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="min-w-[24px] text-center text-sm font-black text-white">
                {isSyncing ? <RefreshCw className="h-3 w-3 animate-spin mx-auto" /> : quantity}
              </span>
              <button
                type="button"
                disabled={isSyncing || quantity >= availableStock}
                onClick={handleIncrease}
                className="flex h-8 w-8 items-center justify-center rounded-full text-white hover:bg-white/10 active:scale-90 disabled:opacity-30 transition-all"
              >
                {isSyncing ? <div className="h-3 w-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus className="h-4 w-4" />}
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={disabled || outOfStock || isSyncing}
              onClick={handleAddToCartWithCheck}
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-slate-800 active:scale-90 active:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-slate-900/10"
            >
              {isSyncing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}
              {isSyncing ? 'Checking...' : 'Add'}
            </button>
          )}
        </div>
      </div>
    </article>
  )
})

function CategoryChips({ categories, selected, onSelect }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-4 no-scrollbar -mx-2 px-2">
      <button
        onClick={() => onSelect('All')}
        className={`category-chip ${selected === 'All' ? 'active' : ''}`}
      >
        All Products
      </button>
      {categories.map((cat) => (
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
  const fetchWishlist = useStore((state) => state.fetchWishlist)
  const addToCart = useStore((state) => state.addToCart)

  useEffect(() => {
    if (token) {
      fetchWishlist();
    }
  }, [token, fetchWishlist]);
  const storeBlocked = useStore((state) => state.storeBlocked)
  const deliveryMode = useStore((state) => state.deliveryMode)
  const nearestStoreId = useStore((state) => state.nearestStoreId)

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
  } = useSmartProductLoader(20)

  const [categories, setCategories] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [stockFilter, setStockFilter] = useState('all')
  const [sortBy, setSortBy] = useState('recommended')
  const handleBannerClick = (url) => {
    if (!url) return;
    
    // Normalize URL
    let finalUrl = url.trim();
    
    // Check if it's an external domain or has a protocol
    const isExternal = /^(https?:\/\/)?(www\.)?(youtube\.com|instagram\.com|facebook\.com|twitter\.com|t\.me|googl\.com|linktr\.ee)/i.test(finalUrl);
    
    if (isExternal) {
      if (!/^https?:\/\//i.test(finalUrl)) {
        finalUrl = `https://${finalUrl}`;
      }
      window.open(finalUrl, '_blank');
    } else if (finalUrl.startsWith('/')) {
      navigate(finalUrl);
    } else if (finalUrl.startsWith('http')) {
      window.open(finalUrl, '_blank');
    } else {
      // Fallback for domains like "google.com"
      window.open(`https://${finalUrl}`, '_blank');
    }
  };

  const [banners, setBanners] = useState([])
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0)
  
  const globalSearchQuery = useStore((state) => state.globalSearchQuery)
  const setGlobalSearchQuery = useStore((state) => state.setGlobalSearchQuery)
  
  const query = globalSearchQuery || ''
  const setQuery = setGlobalSearchQuery

  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [availability, setAvailability] = useState(null)

  const [recommendations, setRecommendations] = useState([])
  const [recLoading, setRecLoading] = useState(false)

  const logInteraction = useCallback(async (type, targetId, category) => {
    try {
      const sessionId = localStorage.getItem('jdlx_session_id')
      const userId = user?.user_id
      await fetch(`${API_BASE_URL}/user/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          session_id: sessionId,
          interaction_type: type,
          target_id: String(targetId),
          category: category
        })
      })
    } catch (e) {
      console.error('Failed to log interaction:', e)
    }
  }, [user])

  const fetchRecommendations = useCallback(async () => {
    setRecLoading(true)
    try {
      let sessionId = localStorage.getItem('jdlx_session_id')
      if (!sessionId) {
        sessionId = Math.random().toString(36).substring(7)
        localStorage.setItem('jdlx_session_id', sessionId)
      }
      
      const userId = user?.user_id
      const params = new URLSearchParams()
      if (userId) params.append('user_id', userId)
      if (sessionId) params.append('session_id', sessionId)
      
      const res = await fetch(`${API_BASE_URL}/user/recommendations?${params.toString()}`)
      const json = await res.json()
      if (json.success) setRecommendations(json.data)
    } catch (e) {
      console.error('Failed to load recommendations:', e)
    } finally {
      setRecLoading(false)
    }
  }, [user])

  const featuredProducts = useMemo(() => products.filter(p => Number(p.is_featured) === 1 || p.is_featured === true), [products])
  const regularProducts = useMemo(() => products.filter(p => !p.is_featured), [products])

  const bestDeals = products
    .filter(p => p.mrp > p.price)
    .sort((a, b) => ((b.mrp - b.price) / b.mrp) - ((a.mrp - a.price) / a.mrp))
    .slice(0, 6)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
      if (query && query.length > 2) {
        logInteraction('search', query)
      }
    }, 800)
    return () => clearTimeout(timer)
  }, [query, logInteraction])

  useEffect(() => {
    fetchRecommendations()
  }, [fetchRecommendations])

  useEffect(() => {
    fetch(`${API_BASE_URL}/categories`)
      .then((res) => res.json())
      .then((json) => setCategories(json.data || []))
      .catch((err) => console.error('Failed to load categories:', err))
  }, [])

  useEffect(() => {
    fetch(`${API_BASE_URL}/warehouse/availability`)
      .then((r) => r.json())
      .then((data) => setAvailability(data))
      .catch((e) => console.error('Failed to load availability:', e))

    // Fetch Banners
    fetch(`${API_BASE_URL}/banners`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data) {
          setBanners(json.data)
        }
      })
      .catch((e) => console.error('Failed to load banners:', e))
  }, [])

  const allBanners = useMemo(() => {
    const apiBanners = banners.map(b => ({
      ...b,
      image: resolveMediaUrl(b.image_url),
      type: 'promo'
    }));

    const productBanners = featuredProducts.slice(0, 3).map(p => ({
      id: `prod-${p.id}`,
      title: p.name,
      subtitle: p.description || "Premium JDLX Mobile Collection",
      cta_text: "Shop Now",
      image: getProductImage(p),
      badge_text: "Featured",
      gradient: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
      link_url: `/product/${p.id}`,
      type: 'product'
    }));

    return [...apiBanners, ...productBanners];
  }, [banners, featuredProducts]);

  // Auto-slide effect for multiple banners
  useEffect(() => {
    if (allBanners.length <= 1) return
    const interval = setInterval(() => {
      setCurrentBannerIndex(prev => (prev + 1) % allBanners.length)
    }, 5000)
    return () => clearInterval(interval)
  }, [allBanners])

  useEffect(() => {
    const effectiveStoreId = deliveryMode === 'quick' ? nearestStoreId : null
    loadInitialProducts(selectedCategory, debouncedQuery, effectiveStoreId)
  }, [selectedCategory, debouncedQuery, loadInitialProducts, deliveryMode, nearestStoreId])

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

  const filteredProducts = useMemo(() => {
    let list = [...products]

    if (stockFilter === 'in-stock') {
      list = list.filter((p) => (Number(p.stock) - Number(p.reserved_stock)) > 0)
    } else if (stockFilter === 'low-stock') {
      list = list.filter((p) => {
        const avail = Number(p.stock) - Number(p.reserved_stock)
        return avail > 0 && avail <= LOW_STOCK_LIMIT
      })
    }

    if (sortBy === 'price-low') list.sort((a, b) => a.price - b.price)
    if (sortBy === 'price-high') list.sort((a, b) => b.price - a.price)
    if (sortBy === 'newest') list.sort((a, b) => b.id - a.id)

    return list
  }, [products, stockFilter, sortBy])

  const hasActiveFilters = selectedCategory !== 'All' || query.trim() !== '' || stockFilter !== 'all' || sortBy !== 'recommended'

  const clearFilters = () => {
    setSelectedCategory('All')
    setQuery('')
    setStockFilter('all')
    setSortBy('recommended')
  }

  if (hasError && !hasLoadedOnce) {
    return <ProductErrorState message={errorMessage} onRetry={retryLoad} />
  }

  return (
    <div className="space-y-12 pb-20 reveal-staggered">
      {/* 1. Header & Greeting */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
           <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
           <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">JDLX Store</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-slate-900">
          {getGreeting()}, <span className="text-primary">{getFirstName(user)}</span>
        </h1>
        <p className="max-w-xl text-slate-500 font-medium leading-relaxed">
          Browse curated essentials. Fast delivery, reliable stock, and a clean shopping experience.
        </p>
      </section>

      {/* 2. Promo & Availability Carousel */}
      <section className="relative group overflow-hidden rounded-[40px]">
        {allBanners.length > 0 ? (
          <div className="relative">
            <div 
              className="flex transition-transform duration-1000 ease-out" 
              style={{ transform: `translateX(-${currentBannerIndex * 100}%)` }}
            >
              {allBanners.map((b, idx) => (
                <div key={b.id} className="w-full flex-shrink-0">
                  <PromoBanner 
                    title={b.title}
                    subtitle={b.subtitle}
                    cta={b.cta_text}
                    image={b.image}
                    badge={b.badge_text}
                    gradient={b.gradient}
                    overlay_opacity={b.overlay_opacity}
                    onClick={() => handleBannerClick(b.link_url)}
                  />
                </div>
              ))}
            </div>

            {/* Carousel Indicators */}
            {allBanners.length > 1 && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2 z-20">
                {allBanners.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCurrentBannerIndex(idx)}
                    className={`h-1.5 rounded-full transition-all duration-500 ${currentBannerIndex === idx ? 'w-8 bg-white' : 'w-1.5 bg-white/40'}`}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <PromoBanner />
        )}
      </section>

      {/* 3. Availability Indicator (Refined) */}
      {availability && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="glass-card p-4 flex items-center gap-4">
              <div className={`h-10 w-10 rounded-2xl flex items-center justify-center ${availability.ordering_enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                 {availability.ordering_enabled ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Status</div>
                <div className="text-sm font-black text-slate-900">
                  {availability.ordering_enabled ? (
                    <span className="flex items-center gap-1.5">
                      Operational
                      {availability.quick_mode_enabled && (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-100 text-[9px] text-emerald-700 animate-pulse">
                          <Zap size={8} fill="currentColor" />
                          QUICK
                        </span>
                      )}
                    </span>
                  ) : 'Store Closed'}
                </div>
              </div>
            </div>
           <div className="glass-card p-4 flex items-center gap-4">
             <div className="h-10 w-10 rounded-2xl bg-primary/5 flex items-center justify-center text-primary">
                <Package size={20} />
             </div>
             <div>
               <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ready to Ship</div>
               <div className="text-sm font-black text-slate-900">{availability.active_products || 0} Products</div>
             </div>
           </div>
           <div className="glass-card p-4 flex items-center gap-4">
             <div className="h-10 w-10 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600">
                <RefreshCw size={18} className="animate-spin-slow" />
             </div>
             <div>
               <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Last Sync</div>
               <div className="text-sm font-black text-slate-900">Just now</div>
             </div>
           </div>
        </section>
      )}

      {/* 5. Personalized Section: Best Picks For You */}
      {recommendations.length > 0 && (
        <section className="space-y-8 animate-in fade-in duration-700">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h2 className="text-2xl font-black tracking-tight text-slate-900">Best Picks For You</h2>
              <p className="text-sm text-slate-500 font-medium italic">Handpicked based on your recent searches & interests</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-primary/5 flex items-center justify-center text-primary">
              <Zap size={20} fill="currentColor" className="animate-pulse" />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {recommendations.slice(0, 4).map(p => (
              <div key={p.id} onClick={() => logInteraction('view', p.id, p.category)}>
                <ProductCard 
                  product={p} 
                  onAddToCart={addToCart}
                  disabled={storeBlocked}
                />
              </div>
            ))}
          </div>
        </section>
      )}


      {/* 6. Popular Essentials */}
      <section className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-1 bg-primary rounded-full" />
            <h2 className="text-2xl font-black tracking-tight text-slate-900">Popular Essentials</h2>
          </div>
        </div>

        {initialLoading && !hasLoadedOnce ? (
          <ProductLoadingGrid count={8} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {(featuredProducts.length > 4 ? featuredProducts.slice(4, 12) : regularProducts.slice(0, 8)).map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onAddToCart={addToCart}
                disabled={storeBlocked}
              />
            ))}
          </div>
        )}
      </section>

      {/* 7. Recommendations (Footer Section) */}
      <RecommendationsSection />
    </div>
  )
}
