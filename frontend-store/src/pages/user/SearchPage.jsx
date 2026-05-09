import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronRight, RefreshCw, Search, ShoppingBag, Plus, Minus, SlidersHorizontal, Package, CheckCircle2, XCircle, Star } from 'lucide-react'

import BlurImage from '../../components/BlurImage'
import PaginationLoader from '../../components/PaginationLoader'
import ProductEmptyState from '../../components/ProductEmptyState'
import ProductErrorState from '../../components/ProductErrorState'
import ProductLoadingGrid from '../../components/ProductLoadingGrid'
import RecommendationsSection from '../../components/RecommendationsSection'
import { useSmartProductLoader } from '../../hooks/useSmartProductLoader'
import { API_BASE_URL, resolveMediaUrl } from '../../config'
import { useStore } from '../../store/useStore'
import { isStickerProduct } from '../../utils/stickerCustomization'

const LOW_STOCK_LIMIT = 2

function getProductImage(product) {
  let images = 
    product?.image_url ||
    product?.images ||
    product?.image ||
    product?.thumbnail ||
    product?.photo ||
    null

  if (!images) return 'https://placehold.co/800x800/f8fafc/0f172a?text=JDLX'

  if (typeof images === 'string' && images.startsWith('[')) {
    try {
      const parsed = JSON.parse(images)
      if (Array.isArray(parsed) && parsed.length > 0) {
        images = parsed[0]
      }
    } catch (e) {}
  }

  if (Array.isArray(images) && images.length > 0) {
    images = images[0]
  }

  if (typeof images !== 'string') {
    return 'https://placehold.co/800x800/f8fafc/0f172a?text=JDLX'
  }

  return resolveMediaUrl(images)
}

const ProductCard = memo(({ product, onAddToCart, disabled }) => {
  const navigate = useNavigate()
  const cart = useStore((state) => state.cart)
  const updateQuantity = useStore((state) => state.updateQuantity)

  const cartItem = cart.find((item) => item.id === product.id)
  const quantity = cartItem ? cartItem.qty : 0

  const stock = Number(product?.stock ?? 0)
  const reservedStock = Number(product?.reserved_stock ?? 0)
  const availableStock = Math.max(0, stock - reservedStock)
  const outOfStock = availableStock <= 0

  return (
    <article className="card-standard group relative flex flex-col h-full hover:border-primary/30 transition-all duration-300">
      <div onClick={() => window.location.href=`/product/${product.id}`} className="relative block aspect-[1.1] overflow-hidden bg-[var(--color-surface-low)] cursor-pointer transition-colors">
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

        <div className="h-full w-full p-6 transition-transform duration-700 group-hover:scale-110">
          <BlurImage
            src={getProductImage(product)}
            alt={product.name}
            className="h-full w-full object-contain"
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-black uppercase tracking-widest text-primary/80">
            {product.category || 'Product'}
          </span>
          <div className="flex items-center gap-1">
             <span className="text-[10px] font-black text-[var(--color-on-surface)]/30">MRP</span>
             <span className="text-[10px] font-black text-[var(--color-on-surface)]/30 line-through">₹{product.mrp || product.price}</span>
          </div>
        </div>
        
        <h3 className="mb-1 line-clamp-2 text-sm font-black tracking-tight text-[var(--color-on-surface)] group-hover:text-primary transition-colors">
          {product.name}
        </h3>

        {product.average_rating > 0 && (
          <div className="mb-4 flex items-center gap-1.5">
            <div className="flex items-center gap-0.5 text-amber-400">
              <Star size={12} fill="currentColor" />
            </div>
            <span className="text-[11px] font-black text-[var(--color-on-surface)]/80">
              {Number(product.average_rating).toFixed(1)}
            </span>
            <span className="text-[10px] text-[var(--color-on-surface)]/40 font-bold uppercase tracking-tight">
              ({product.total_reviews} Reviews)
            </span>
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-lg font-black text-[var(--color-on-surface)]">₹{product.price}</span>
          </div>

          {quantity > 0 ? (
            <div className="flex items-center gap-2 rounded-full bg-slate-900 p-1 shadow-lg shadow-slate-900/10">
              <button
                type="button"
                onClick={(e) => {
                   e.preventDefault();
                   updateQuantity(product.id, quantity - 1)
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-white hover:bg-white/10 active:scale-90 transition-all"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="min-w-[24px] text-center text-sm font-black text-white">
                {quantity}
              </span>
              <button
                type="button"
                disabled={quantity >= availableStock}
                onClick={(e) => {
                  e.preventDefault();
                  updateQuantity(product.id, quantity + 1)
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-white hover:bg-white/10 active:scale-90 disabled:opacity-30 transition-all"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={disabled || outOfStock}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isStickerProduct(product)) {
                  toast('Select your device model on the product page');
                  navigate(`/product/${product.id}`);
                  return;
                }
                onAddToCart(product);
                toast.success('Added to cart');
              }}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--color-primary)] px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:opacity-90 active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary/20"
            >
              <ShoppingBag className="h-4 w-4" />
              Add
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
    <div className="flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between border-t border-[var(--color-surface-high)]">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-on-surface)]/40" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search items by name or category..."
          className="w-full h-12 rounded-2xl bg-[var(--color-surface-low)] pl-11 pr-4 text-sm font-bold text-[var(--color-on-surface)] border-none outline-none focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-[var(--color-on-surface)]/30"
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

export default function SearchPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const observerRef = useRef(null)
  const searchInputRef = useRef(null)
  const user = useStore((state) => state.user)
  const addToCart = useStore((state) => state.addToCart)
  const storeBlocked = useStore((state) => state.storeBlocked)
  
  const globalSearchQuery = useStore((state) => state.globalSearchQuery)
  const setGlobalSearchQuery = useStore((state) => state.setGlobalSearchQuery)
  
  const query = globalSearchQuery || ''
  const setQuery = setGlobalSearchQuery

  const {
    products,
    loading,
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

  const [debouncedQuery, setDebouncedQuery] = useState(query)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
    }, 400)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    fetch(`${API_BASE_URL}/categories`)
      .then(res => res.json())
      .then(json => {
        if (json.success) setCategories(json.data)
      })
      .catch(err => console.error('Failed to load categories:', err))
  }, [])

  useEffect(() => {
    const categoryId = selectedCategory === 'All' ? null : selectedCategory
    loadInitialProducts(categoryId, debouncedQuery)
  }, [selectedCategory, debouncedQuery, loadInitialProducts])

  useEffect(() => {
    if (!observerRef.current || !hasMore || initialLoading || paginationLoading) return

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadMoreProducts()
      }
    }, { threshold: 0.1 })

    observer.observe(observerRef.current)
    return () => observer.disconnect()
  }, [hasMore, initialLoading, paginationLoading, loadMoreProducts])

  const displayProducts = products

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
    <div className="space-y-8 pb-20 reveal-staggered">
      <section className="space-y-6">
        <div className="flex items-center gap-4">
           <button 
             onClick={() => navigate('/')}
             className="p-2 rounded-xl bg-[var(--color-surface-high)] hover:bg-[var(--color-surface-white)] transition-all active:scale-90 text-[var(--color-on-surface)]"
           >
             <ChevronRight size={20} className="rotate-180" />
           </button>
           <div className="space-y-1">
             <h1 className="text-3xl font-black tracking-tight text-[var(--color-on-surface)]">Explore Catalog</h1>
             <p className="text-sm text-[var(--color-on-surface)]/60 font-medium">
               {debouncedQuery ? `Showing results for "${debouncedQuery}"` : (query ? 'Searching...' : 'Discover our full range of essentials')}
             </p>
           </div>
        </div>

        <FiltersBar
          inputRef={searchInputRef}
          query={query}
          onQueryChange={setQuery}
          stockFilter={stockFilter}
          onStockFilterChange={setStockFilter}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          hasActiveFilters={hasActiveFilters}
          onClear={clearFilters}
        />

        <CategoryChips categories={categories} selected={selectedCategory} onSelect={setSelectedCategory} />
      </section>

      <section className="space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-1 bg-primary rounded-full" />
            <h2 className="text-xl font-black tracking-tight text-[var(--color-on-surface)]">
              {selectedCategory === 'All' ? (debouncedQuery ? 'Search Results' : 'All Products') : `${categories.find(c => c.id === selectedCategory)?.name || 'Filtered'} Selection`}
              {displayProducts.length > 0 && <span className="ml-2 text-sm font-medium text-[var(--color-on-surface)]/40">({displayProducts.length})</span>}
            </h2>
          </div>
          {(pageRefreshing || (loading && hasLoadedOnce)) && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/5 text-primary text-[10px] font-black uppercase tracking-widest animate-in fade-in">
              <RefreshCw size={12} className="animate-spin" />
              Updating...
            </div>
          )}
        </div>

        {initialLoading && !hasLoadedOnce ? (
          <ProductLoadingGrid count={8} />
        ) : displayProducts.length === 0 && !loading ? (
          <ProductEmptyState onClear={clearFilters} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {displayProducts.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onAddToCart={addToCart}
                disabled={storeBlocked}
              />
            ))}
          </div>
        )}

        {paginationLoading && (
          <div className="flex justify-center py-10">
            <PaginationLoader />
          </div>
        )}
        
        <div ref={observerRef} className="h-20 w-full" />
      </section>
      
      <RecommendationsSection />
    </div>
  )
}
