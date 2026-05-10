import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronRight, RefreshCw, Search, ShoppingBag, Plus, Minus, SlidersHorizontal, Package, CheckCircle2, XCircle, Heart, Zap, Star, Truck, ShieldCheck } from 'lucide-react'

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
  const updateQuantity = useStore((state) => state.updateQuantity)
  const removeFromCart = useStore((state) => state.removeFromCart)
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
          toast.error('No more units available', {
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

  const discount = product.mrp > product.price
    ? Math.round(((product.mrp - product.price) / product.mrp) * 100)
    : 0;

  return (
    <article className="group relative flex flex-col h-full bg-[var(--color-surface-white)] rounded-2xl overflow-hidden border border-[var(--color-surface-high)] transition-all duration-300 hover:shadow-xl hover:border-primary/20">
      <Link to={`/product/${product.id}`} className="relative block aspect-square overflow-hidden bg-[var(--color-surface-low)]/50">
        {/* Badges Overlay */}
        <div className="absolute top-2 left-2 z-20 flex flex-col gap-1.5">
          {discount > 0 && !outOfStock && (
            <span className="bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-sm uppercase tracking-tighter">
              {discount}% OFF
            </span>
          )}
          {outOfStock ? (
            <span className="bg-slate-200 text-slate-600 text-[9px] font-black px-1.5 py-0.5 rounded-sm uppercase tracking-tighter">
              Sold Out
            </span>
          ) : availableStock <= LOW_STOCK_LIMIT && (
            <span className="bg-amber-100 text-amber-700 text-[9px] font-black px-1.5 py-0.5 rounded-sm uppercase tracking-tighter border border-amber-200">
              Only {availableStock} left
            </span>
          )}
        </div>

        {/* Wishlist Button */}
        <button
          onClick={handleWishlistToggle}
          className={`absolute top-2 right-2 z-30 h-8 w-8 rounded-full flex items-center justify-center transition-all ${isInWishlist ? 'text-red-500' : 'text-slate-400 hover:text-red-500'
            }`}
        >
          <Heart size={18} fill={isInWishlist ? 'currentColor' : 'none'} />
        </button>

        <div className="h-full w-full p-4 transition-transform duration-700 group-hover:scale-105">
          <BlurImage
            src={getProductImage(product)}
            alt={product?.name}
            className="h-full w-full object-contain mix-blend-multiply"
          />
        </div>
      </Link>

      <div className="p-3 md:p-4 flex-1 flex flex-col gap-1.5">
        <div className="flex flex-col gap-0.5">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">
            {product?.category || 'General'}
          </div>
          <Link to={`/product/${product.id}`}>
            <h3 className="line-clamp-2 text-xs md:text-sm font-bold text-[var(--color-on-surface)] leading-snug min-h-[2.4em]">
              {product?.name || 'Untitled Product'}
            </h3>
          </Link>
        </div>

        {/* Rating Section */}
        <div className="flex items-center gap-1">
          <div className="flex items-center bg-emerald-600 text-white text-[9px] font-black px-1 rounded-sm gap-0.5">
            {Number(product.average_rating || 0).toFixed(1)}
            <Star size={8} fill="currentColor" />
          </div>
          <span className="text-[10px] text-slate-400 font-bold">
            ({product.total_reviews || 0})
          </span>
        </div>

        {/* Price Section */}
        <div className="flex flex-col">
          <div className="flex items-baseline gap-1.5">
            <span className="text-base md:text-lg font-black text-[var(--color-on-surface)]">
              ₹{product?.price ?? 0}
            </span>
            {product.mrp > product.price && (
              <span className="text-[10px] md:text-xs text-slate-400 line-through font-medium">
                ₹{product.mrp}
              </span>
            )}
          </div>
          {deliveryMode === 'quick' && (
            <div className="flex items-center gap-1 text-emerald-600 text-[9px] font-black uppercase tracking-tighter">
              <Zap size={10} fill="currentColor" />
              Delivery by Today
            </div>
          )}
        </div>

        {/* Action Button */}
        <div className="mt-auto pt-2">
          {quantity > 0 ? (
            <div className="flex items-center justify-between bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  if (quantity === 1) removeFromCart(product.id)
                  else updateQuantity(product.id, quantity - 1)
                }}
                className="h-7 w-7 flex items-center justify-center text-slate-600 hover:bg-white rounded-md transition-colors"
              >
                <Minus size={14} />
              </button>
              <span className="text-xs font-black text-slate-900">
                {isSyncing ? <RefreshCw size={10} className="animate-spin" /> : quantity}
              </span>
              <button
                disabled={isSyncing || quantity >= availableStock}
                onClick={handleIncrease}
                className="h-7 w-7 flex items-center justify-center text-slate-600 hover:bg-white rounded-md disabled:opacity-30 transition-colors"
              >
                <Plus size={14} />
              </button>
            </div>
          ) : (
            <button
              disabled={disabled || outOfStock || isSyncing}
              onClick={handleAddToCartWithCheck}
              className="w-full h-8 md:h-9 btn-primary"
            >
              {isSyncing ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
              {isSyncing ? '...' : 'Add to Cart'}
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
  
  const globalSearchQuery = useStore((state) => state.globalSearchQuery)
  const setGlobalSearchQuery = useStore((state) => state.setGlobalSearchQuery)
  const query = globalSearchQuery || ''
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [recommendations, setRecommendations] = useState([])

  const logInteraction = useCallback(async (type, targetId, category) => {
    try {
      const sessionId = localStorage.getItem('jdlx_session_id')
      await fetch(`${API_BASE_URL}/user/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user?.user_id,
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

  const fetchRecommendations = useCallback(async () => {
    try {
      let sessionId = localStorage.getItem('jdlx_session_id')
      if (!sessionId) {
        sessionId = Math.random().toString(36).substring(7)
        localStorage.setItem('jdlx_session_id', sessionId)
      }
      const params = new URLSearchParams()
      if (user?.user_id) params.append('user_id', user.user_id)
      if (sessionId) params.append('session_id', sessionId)
      
      const res = await fetch(`${API_BASE_URL}/user/recommendations?${params.toString()}`)
      const json = await res.json()
      if (json.success) setRecommendations(json.data)
    } catch (e) {
      console.error('Recommendations failed:', e)
    }
  }, [user])

  const featuredProducts = useMemo(() => products.filter(p => Number(p.is_featured) === 1 || p.is_featured === true), [products])
  const regularProducts = useMemo(() => products.filter(p => !p.is_featured), [products])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 800)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    fetchRecommendations()
  }, [fetchRecommendations])

  useEffect(() => {
    fetch(`${API_BASE_URL}/categories`)
      .then((res) => res.json())
      .then((json) => setCategories(json.data || []))
      .catch((err) => console.error('Categories failed:', err))

    fetch(`${API_BASE_URL}/banners`)
      .then((r) => r.json())
      .then((json) => json.success && setBanners(json.data))
      .catch((e) => console.error('Banners failed:', e))
  }, [])

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
      link_url: `/product/${p.id}`,
      type: 'product'
    }));
    return [...apiBanners, ...productBanners];
  }, [banners, featuredProducts]);

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

  if (hasError && !hasLoadedOnce) {
    return <ProductErrorState message={errorMessage} onRetry={retryLoad} />
  }

  return (
    <div className="space-y-16 pb-24 reveal-staggered">
      {/* 1. Brand Greeting */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
          <span className="text-[11px] font-black uppercase tracking-[0.4em] text-[var(--color-on-surface)]/30">JDLX Mobile Elite</span>
        </div>
        <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-[var(--color-on-surface)]">
          {getGreeting()}, <span className="text-primary">{getFirstName(user)}</span>
        </h1>
        <p className="max-w-2xl text-[var(--color-on-surface-variant)] text-lg font-medium leading-relaxed">
          {deliveryMode === 'quick' 
            ? 'Premium hyper-local mobile commerce. Experience the gold standard of shopping.' 
            : 'Explore our premium collection of mobile essentials. Experience the gold standard of shopping.'}
        </p>
      </section>

      {/* 2. Dynamic Banner Carousel */}
      <section className="relative overflow-hidden rounded-[40px] shadow-2xl shadow-primary/5">
        {allBanners.length > 0 ? (
          <div className="relative">
            <div className="flex transition-transform duration-1000 cubic-bezier(0.4, 0, 0.2, 1)" style={{ transform: `translateX(-${currentBannerIndex * 100}%)` }}>
              {allBanners.map((b) => (
                <div key={b.id} className="w-full flex-shrink-0">
                  <PromoBanner {...b} cta={b.cta_text} onClick={() => handleBannerClick(b.link_url)} />
                </div>
              ))}
            </div>
            {allBanners.length > 1 && (
              <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-2.5 z-20">
                {allBanners.map((_, idx) => (
                  <button key={idx} onClick={() => setCurrentBannerIndex(idx)} 
                    className={`h-1.5 rounded-full transition-all duration-500 ${currentBannerIndex === idx ? 'w-10 bg-white' : 'w-1.5 bg-white/30'}`} />
                ))}
              </div>
            )}
          </div>
        ) : <PromoBanner />}
      </section>

      {/* 3. Personalized Recommendations */}
      {recommendations.length > 0 && (
        <section className="space-y-10">
          <div className="flex items-end justify-between">
            <div className="space-y-1">
              <h2 className="text-3xl font-black tracking-tight">Best Picks For You</h2>
              <p className="text-slate-400 font-bold italic">Curated based on your preferences</p>
            </div>
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <Zap size={24} fill="currentColor" className="animate-pulse" />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {recommendations.slice(0, 4).map(p => (
              <div key={p.id} onClick={() => logInteraction('view', p.id, p.category)}>
                <ProductCard product={p} onAddToCart={addToCart} disabled={storeBlocked} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. Main Catalog */}
      <section className="space-y-10">
        <div className="flex items-center gap-4">
          <div className="h-10 w-1.5 bg-primary rounded-full shadow-[0_0_15px_rgba(245,158,11,0.4)]" />
          <h2 className="text-3xl font-black tracking-tight">Elite Collection</h2>
        </div>
        
        {initialLoading && !hasLoadedOnce ? (
          <ProductLoadingGrid count={8} />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-8">
            {(featuredProducts.length > 4 ? featuredProducts.slice(4, 12) : regularProducts.slice(0, 12)).map((p) => (
              <ProductCard key={p.id} product={p} onAddToCart={addToCart} disabled={storeBlocked} />
            ))}
          </div>
        )}
        
        {hasMore && <div ref={observerRef} className="py-10 flex justify-center"><PaginationLoader /></div>}
      </section>

      <RecommendationsSection />
    </div>
  )
}
