import React, { useState, useEffect, useCallback } from 'react';
import {
  ShoppingBag, Search, Plus, Minus, Trash2, CreditCard,
  DollarSign, QrCode, Printer, Smartphone, ShieldAlert, RefreshCw, History,
  AlertTriangle, Camera, X, Clock, Eye
} from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE_URL, resolveMediaUrl } from '../../config';
import SalesHistory from './billing/SalesHistory';
import InvoiceModal from './billing/InvoiceModal';
import { billingUploadDamageImage, billingFetch } from './billing/BillingApi';
import { apiFetch } from '../../utils/apiFetch'

export default function StaffBilling() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  // 'RECENT' (recently sold at this counter) is the default landing view.
  const [selectedCategory, setSelectedCategory] = useState('RECENT');
  // Recently-sold products (from /billing/recent-products) for the RECENT view.
  const [recentProducts, setRecentProducts] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);
  // On small screens the grid collapses to the first 4 products until
  // "View All" is tapped — keeps the DOM light and the UI clean.
  const [isMobile, setIsMobile] = useState(false);
  const [visibleCount, setVisibleCount] = useState(4);

  // Cart state
  const [cart, setCart] = useState([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMode, setPaymentMode] = useState('CASH');
  const [discountAmount, setDiscountAmount] = useState(0);
  // GST is opt-in per bill — default 0% (No GST). The billing agent picks a
  // rate from the dropdown only when GST actually needs to be charged.
  const [gstRate, setGstRate] = useState(0);

  // POS / Sales History tab
  const [activeTab, setActiveTab] = useState('pos');

  // Billing modal / invoice receipt state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatedInvoice, setGeneratedInvoice] = useState(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  // PWA Install Prompt state
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  // NOTE: must be declared BEFORE the useEffect below. `const` lives in the
  // temporal dead zone until this line runs — if the effect (or its deps array)
  // referenced it earlier, the whole POS page crashed on mount with
  // "Cannot access 'fetchBillingProducts' before initialization" -> blank page.
  const fetchBillingProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/warehouse/billing/products');

      if (res.status === 403) {
        setError('Access Denied: You do not have permission to access the Billing System.');
        setLoading(false);
        return;
      }

      if (!res.ok) {
        throw new Error('Failed to load products for billing');
      }

      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Fetch billing products error:', err);
      setError(err.message || 'Error loading billing products');
    } finally {
      setLoading(false);
    }
  }, []);

  // Recently-sold products for the RECENT view. Re-fetched on mount, when
  // returning to the POS tab, and after every bill so the counter always
  // surfaces what was sold most recently.
  const fetchRecentProducts = useCallback(async () => {
    setRecentLoading(true);
    try {
      const res = await apiFetch('/warehouse/billing/recent-products');
      if (!res.ok) throw new Error('Failed to load recent products');
      const data = await res.json();
      setRecentProducts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Fetch recent products error:', err);
      setRecentProducts([]);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBillingProducts();
    fetchRecentProducts();

    // Listen for PWA installation prompt
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
      toast.success('JDLX Billing App installed successfully!');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Check if running in standalone mode (already installed)
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
      setIsInstalled(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [fetchBillingProducts, fetchRecentProducts]);

  // Refresh stock + recent list whenever the agent returns to the POS tab —
  // otherwise returns/exchanges done from Sales History leave stale counts.
  useEffect(() => {
    if (activeTab === 'pos') {
      fetchBillingProducts();
      fetchRecentProducts();
    }
  }, [activeTab, fetchBillingProducts, fetchRecentProducts]);

  // Detect small (mobile) screens so the grid can collapse to 4 products.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const apply = () => setIsMobile(mq.matches);
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else mq.addListener(apply); // older Safari
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', apply);
      else mq.removeListener(apply);
    };
  }, []);

  // Reset the mobile collapse whenever the active filter/search changes.
  useEffect(() => {
    setVisibleCount(4);
  }, [selectedCategory, searchQuery]);


  const handleInstallApp = async () => {
    if (!deferredPrompt) {
      toast('To install as App: Tap Browser Menu → "Add to Home Screen" or "Install App"', { icon: '📱' });
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      toast.success('Installing JDLX Billing App...');
    }
    setDeferredPrompt(null);
    setIsInstallable(false);
  };

  // Cart operations
  const addToCart = (product) => {
    if (product.stock <= 0) {
      toast.error('Item is out of stock!');
      return;
    }

    setCart((prevCart) => {
      const existing = prevCart.find((item) => item.id === product.id);
      if (existing) {
        if (existing.qty >= product.stock) {
          toast.error(`Cannot add more than available stock (${product.stock})`);
          return prevCart;
        }
        return prevCart.map((item) =>
          item.id === product.id ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [...prevCart, { ...product, qty: 1, damage_qty: 0, damageComment: '', damageImageUrl: '', damageMode: false }];
    });
  };

  const updateQuantity = (id, delta) => {
    setCart((prevCart) =>
      prevCart
        .map((item) => {
          if (item.id === id) {
            const newQty = item.qty + delta;
            if (newQty > item.stock) {
              toast.error(`Only ${item.stock} in stock!`);
              return item;
            }
            // Never let damage exceed the total qty (e.g. qty 3 -> 1 keeps
            // damage clamped to 1).
            const clampedDamage = Math.min(item.damage_qty || 0, newQty);
            return newQty > 0 ? { ...item, qty: newQty, damage_qty: clampedDamage } : null;
          }
          return item;
        })
        .filter(Boolean)
    );
  };

  const removeFromCart = (id) => {
    setCart((prevCart) => prevCart.filter((item) => item.id !== id));
  };

  // --- Damage handling (optional per line item) ---
  // Damaged units are excluded from the bill — the customer only pays for
  // (qty - damage_qty). Damage qty / comment / photo are kept for records.
  const toggleDamageMode = (id) => {
    setCart((prevCart) =>
      prevCart.map((item) => {
        if (item.id !== id) return item;
        const damageMode = !item.damageMode;
        return {
          ...item,
          damageMode,
          // Sensible default: mark 1 unit damaged when enabling.
          damage_qty: damageMode ? Math.min(1, item.qty) : item.damage_qty
        };
      })
    );
  };

  const setDamageQty = (id, delta) => {
    setCart((prevCart) =>
      prevCart.map((item) => {
        if (item.id !== id) return item;
        const dq = Math.min(Math.max(0, (item.damage_qty || 0) + delta), item.qty);
        return { ...item, damage_qty: dq };
      })
    );
  };

  const setDamageComment = (id, value) => {
    setCart((prevCart) =>
      prevCart.map((item) => (item.id === id ? { ...item, damageComment: value } : item))
    );
  };

  const handleDamageImage = async (id, file) => {
    if (!file) return;
    try {
      const url = await billingUploadDamageImage(file);
      if (!url) throw new Error('Upload returned no URL');
      setCart((prevCart) =>
        prevCart.map((item) => (item.id === id ? { ...item, damageImageUrl: url } : item))
      );
      toast.success('Damage photo attached');
    } catch (err) {
      console.error('Damage image upload error:', err);
      toast.error(err.message || 'Damage photo upload failed');
    }
  };

  const removeDamageImage = (id) => {
    setCart((prevCart) =>
      prevCart.map((item) => (item.id === id ? { ...item, damageImageUrl: '' } : item))
    );
  };

  const clearCart = () => {
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setDiscountAmount(0);
  };

  // Calculations — only non-damaged units are charged (damage is not billed).
  const billedQtyOf = (item) => Math.max(0, (item.qty || 0) - (item.damage_qty || 0));
  const subtotal = cart.reduce((acc, item) => acc + item.price * billedQtyOf(item), 0);
  // Tax uses the selected GST rate (0% by default = no GST charged).
  const taxAmount = Math.round(subtotal * (Number(gstRate) / 100) * 100) / 100;
  const grandTotal = Math.max(0, Math.round((subtotal + taxAmount - Number(discountAmount || 0)) * 100) / 100);

  // Generate Bill handler
  const handleGenerateBill = async () => {
    if (cart.length === 0) {
      toast.error('Cart is empty! Add products first.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        customer_name: customerName || 'Counter Customer',
        customer_phone: customerPhone,
        payment_mode: paymentMode,
        discount_amount: Number(discountAmount || 0),
        gst_rate: Number(gstRate || 0),
        items: cart.map((item) => ({
          product_id: item.id,
          qty: item.qty,
          price: item.price,
          damage_qty: item.damage_qty || 0,
          damage_comment: item.damageComment || '',
          damage_image_url: item.damageImageUrl || ''
        }))
      };

      const res = await apiFetch('/warehouse/billing/generate', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Failed to generate bill');
      }

      setGeneratedInvoice(data);
      setShowInvoiceModal(true);
      toast.success('Bill generated successfully!');
      clearCart();
      fetchBillingProducts(); // Refresh stock
      fetchRecentProducts(); // The sold items now lead the RECENT view
    } catch (err) {
      console.error('Generate bill error:', err);
      toast.error(err.message || 'Failed to generate bill');
    } finally {
      setIsSubmitting(false);
    }
  };

  // NOTE: 'ALL'/'RECENT' are intentionally excluded — the pills below render
  // ['RECENT', 'ALL', ...categories], so including them here would duplicate
  // those pills (and their React keys).
  const categories = [...new Set(products.map((p) => p.category || 'General'))]
    .filter((c) => c !== 'ALL' && c !== 'RECENT');
  const isRecentTab = selectedCategory === 'RECENT';

  // Catalog filtered by search + category (RECENT ignores category — the
  // recent list is recency-ordered instead). Guard against incomplete/bad
  // product rows (e.g. NULL name from legacy inventory) so a single bad
  // record can never crash the POS page.
  const catalogProducts = products.filter((p) => {
    const productName = (p.name || '').toString().toLowerCase();
    const matchesSearch = productName.includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'ALL' || isRecentTab || (p.category || 'General') === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const recentFiltered = recentProducts.filter((p) =>
    (p.name || '').toString().toLowerCase().includes(searchQuery.toLowerCase())
  );

  // RECENT tab: show the recency-ordered list; if the counter has no sales
  // yet, fall back to the full catalog so billing is never blocked.
  const activeList = isRecentTab && recentFiltered.length > 0 ? recentFiltered : catalogProducts;
  // Info banner only when no sales exist yet (not while actively searching,
  // where "no recent match" is expected and the catalog results stand alone).
  const recentEmptyFallback = isRecentTab && recentFiltered.length === 0 && catalogProducts.length > 0 && !searchQuery.trim();

  // On mobile show only the first 4 products until "View All" is tapped.
  const collapsedMobile = isMobile && activeList.length > 4;
  const shownProducts = collapsedMobile ? activeList.slice(0, visibleCount) : activeList;

  if (error) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4 sm:p-6 bg-slate-950">
        <div className="max-w-md w-full bg-slate-900 border border-red-500/30 rounded-2xl p-4 sm:p-6 lg:p-8 text-center shadow-2xl">
          <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4 animate-bounce" />
          <h2 className="text-2xl font-bold text-slate-100 mb-2">Billing Access Restricted</h2>
          <p className="text-slate-400 mb-6">{error}</p>
          <button 
            onClick={fetchBillingProducts}
            className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-xl transition shadow-lg"
          >
            Retry Access Check
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 lg:p-6 font-sans">
      {/* POS / Sales History tabs */}
      <div className="max-w-7xl mx-auto mb-4 grid grid-cols-2 gap-2 bg-slate-900 border border-slate-800 p-1.5 rounded-2xl">
        <button
          onClick={() => setActiveTab('pos')}
          className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition ${
            activeTab === 'pos'
              ? 'bg-indigo-600 text-white shadow-lg'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShoppingBag className="w-4 h-4" /> Counter Billing (POS)
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition ${
            activeTab === 'history'
              ? 'bg-indigo-600 text-white shadow-lg'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <History className="w-4 h-4" /> Sales History
        </button>
      </div>

      {/* Top Header Bar */}
      <div className="max-w-7xl mx-auto mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-4 rounded-2xl backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
            <ShoppingBag className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              JDLX Billing & Counter Sales (POS)
              <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2.5 py-0.5 rounded-full border border-emerald-500/40">
                LIVE
              </span>
            </h1>
            <p className="text-xs text-slate-400">Instant Billing System for Warehouse Agents</p>
          </div>
        </div>

        {/* Action Controls & App Download button */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          {!isInstalled && (
            <button
              onClick={handleInstallApp}
              className="flex-1 md:flex-initial flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-medium px-4 py-2.5 rounded-xl shadow-lg transition text-xs sm:text-sm animate-pulse"
              title="Download & Install Billing App on Device"
            >
              <Smartphone className="w-4 h-4" />
              Download Billing App
            </button>
          )}

          <button
            onClick={fetchBillingProducts}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
            title="Refresh Inventory"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Grid: Left Catalog, Right Cart/Checkout */}
      {activeTab === 'pos' && (
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        {/* Left Column: Product Selection (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          {/* Search & Category Filter */}
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search products by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>

            {/* Filter pills: Recent (default) | All | Categories */}
            <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
              {['RECENT', 'ALL', ...categories].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap border transition ${
                    selectedCategory === cat
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-md'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {cat === 'RECENT' && <Clock className="w-3.5 h-3.5" />}
                  {cat === 'RECENT' ? 'Recent' : cat}
                </button>
              ))}
            </div>
          </div>

          {/* Product Grid */}
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl min-h-[500px]">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 uppercase tracking-wider">
                {isRecentTab ? (
                  <>
                    <Clock className="w-3.5 h-3.5 text-indigo-400" />
                    Recently Sold
                  </>
                ) : selectedCategory === 'ALL' ? 'All Products' : selectedCategory}
              </div>
              <span className="text-[11px] text-slate-500">{activeList.length} items</span>
            </div>

            {recentEmptyFallback && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-[11px] text-indigo-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                No recent counter sales yet — showing all products.
              </div>
            )}

            {loading || (isRecentTab && recentLoading) ? (
              <div className="min-h-[400px] flex items-center justify-center">
                <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
              </div>
            ) : activeList.length === 0 ? (
              <div className="min-h-[400px] flex flex-col items-center justify-center text-slate-500">
                <ShoppingBag className="w-12 h-12 mb-2 opacity-50" />
                <p>No products available for billing</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {shownProducts.map((product) => {
                  const inCart = cart.find((item) => item.id === product.id);
                  const isOutOfStock = product.stock <= 0;

                  return (
                    <div
                      key={product.id}
                      onClick={() => !isOutOfStock && addToCart(product)}
                      className={`relative bg-slate-950 border p-3 rounded-xl flex flex-col justify-between cursor-pointer transition transform hover:-translate-y-0.5 hover:shadow-lg ${
                        inCart
                          ? 'border-indigo-500 ring-1 ring-indigo-500/50'
                          : isOutOfStock
                          ? 'border-slate-800 opacity-50 cursor-not-allowed'
                          : 'border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {inCart && (
                        <div className="absolute top-2 right-2 bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">
                          {inCart.qty} in cart
                        </div>
                      )}

                      <div>
                        <div className="w-full h-24 bg-slate-900 rounded-lg mb-2 flex items-center justify-center overflow-hidden border border-slate-800/80">
                          {product.image_url ? (
                            <img src={resolveMediaUrl(product.image_url)} alt={product.name} className="w-full h-full object-cover" />
                          ) : (
                            <ShoppingBag className="w-8 h-8 text-slate-700" />
                          )}
                        </div>
                        <h3 className="text-xs font-semibold text-slate-200 line-clamp-2 mb-1">{product.name}</h3>
                        <p className="text-[11px] text-slate-400 mb-2">{product.category || 'General'}</p>
                      </div>

                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-900">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-emerald-400">₹{product.price}</span>
                          {product.regular_price && Number(product.price) !== Number(product.regular_price) && (
                            <span className="text-[10px] text-slate-500 line-through">₹{product.regular_price}</span>
                          )}
                          {product.offline_price && (
                            <span className="mt-0.5 self-start px-1.5 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-[10px] font-black uppercase tracking-widest text-violet-300">Offline</span>
                          )}
                        </div>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${
                          isOutOfStock ? 'bg-red-500/20 text-red-400' : 'bg-slate-800 text-slate-300'
                        }`}>
                          {isOutOfStock ? 'Out of stock' : `Stock: ${product.stock}`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Mobile: collapse to 4 products until "View All" is tapped */}
            {collapsedMobile && (
              <div className="mt-4 flex justify-center">
                {visibleCount < activeList.length ? (
                  <button
                    onClick={() => setVisibleCount(activeList.length)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white rounded-xl border border-slate-700 text-xs font-bold transition active:scale-95"
                  >
                    <Eye className="w-4 h-4" />
                    View All ({activeList.length} Products)
                  </button>
                ) : (
                  <button
                    onClick={() => setVisibleCount(4)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-xl border border-slate-700 text-xs font-semibold transition active:scale-95"
                  >
                    Show Less
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Active Cart & Billing Form (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col h-full">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-indigo-400" />
                <h2 className="text-base font-bold text-white">Current Cart ({cart.length})</h2>
              </div>
              {cart.length > 0 && (
                <button
                  onClick={clearCart}
                  className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 font-medium"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear
                </button>
              )}
            </div>

            {/* Items List */}
            <div className="flex-1 overflow-y-auto max-h-[300px] space-y-2 pr-1 scrollbar-thin">
              {cart.length === 0 ? (
                <div className="h-40 flex flex-col items-center justify-center text-slate-500 text-xs">
                  <ShoppingBag className="w-8 h-8 mb-2 opacity-30" />
                  <p>Click items from catalog to add</p>
                </div>
              ) : (
                cart.map((item) => {
                  const damageQty = item.damage_qty || 0;
                  const billedQty = billedQtyOf(item);
                  const hasDamage = damageQty > 0;
                  return (
                    <div key={item.id} className={`bg-slate-950 border p-2.5 rounded-xl ${hasDamage ? 'border-red-500/40' : 'border-slate-800'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-200 truncate">{item.name}</p>
                          <p className="text-[11px] text-slate-400">
                            ₹{item.price} x {billedQty} = <span className="text-emerald-400 font-semibold">₹{(item.price * billedQty).toFixed(2)}</span>
                            {hasDamage && (
                              <span className="text-red-400 ml-1">({damageQty} damaged — not billed)</span>
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
                          <button
                            onClick={() => updateQuantity(item.id, -1)}
                            className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="text-xs font-bold w-5 text-center">{item.qty}</span>
                          <button
                            onClick={() => updateQuantity(item.id, 1)}
                            className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>

                        <button
                          onClick={() => removeFromCart(item.id)}
                          className="p-1 text-slate-500 hover:text-red-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Damage section — the comment/photo options only appear
                          once damage mode is switched on for this line. */}
                      <div className="mt-2 pt-2 border-t border-slate-900 flex flex-col items-start">
                        <button
                          type="button"
                          onClick={() => toggleDamageMode(item.id)}
                          className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border transition ${
                            item.damageMode
                              ? 'bg-red-500/15 text-red-400 border-red-500/40'
                              : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-red-400 hover:border-red-500/40'
                          }`}
                        >
                          <AlertTriangle className="w-3 h-3" />
                          {item.damageMode ? 'Damage On' : 'Add Damage'}
                        </button>

                        {item.damageMode && (
                          <div className="w-full mt-2 space-y-2 bg-red-950/20 border border-red-500/20 rounded-lg p-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-semibold text-red-300">Damaged Qty (max {item.qty})</span>
                              <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
                                <button
                                  onClick={() => setDamageQty(item.id, -1)}
                                  className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <span className="text-xs font-bold w-5 text-center">{damageQty}</span>
                                <button
                                  onClick={() => setDamageQty(item.id, 1)}
                                  className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                            </div>

                            <div>
                              <label className="block text-[10px] font-medium text-slate-400 mb-1">Damage Comment (optional)</label>
                              <input
                                type="text"
                                placeholder="e.g. Screen cracked while unboxing"
                                value={item.damageComment || ''}
                                onChange={(e) => setDamageComment(item.id, e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-red-500"
                              />
                            </div>

                            <div>
                              <label className="block text-[10px] font-medium text-slate-400 mb-1">Damage Photo (optional)</label>
                              {item.damageImageUrl ? (
                                <div className="flex items-center gap-2">
                                  <img
                                    src={resolveMediaUrl(item.damageImageUrl)}
                                    alt="Damage proof"
                                    className="w-12 h-12 rounded-lg object-cover border border-red-500/40"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeDamageImage(item.id)}
                                    className="p-1.5 bg-slate-900 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-lg"
                                    title="Remove photo"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <label className="flex items-center gap-2 w-full bg-slate-950 border border-dashed border-slate-700 rounded-lg px-2.5 py-2 text-[11px] text-slate-400 hover:border-red-500/50 hover:text-red-300 cursor-pointer">
                                  <Camera className="w-3.5 h-3.5" />
                                  Choose photo
                                  <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files && e.target.files[0];
                                      if (file) handleDamageImage(item.id, file);
                                      e.target.value = '';
                                    }}
                                  />
                                </label>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Customer & Payment Inputs */}
            <div className="mt-4 pt-4 border-t border-slate-800 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Customer Name</label>
                  <input
                    type="text"
                    placeholder="Walk-in Customer"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Customer Phone</label>
                  <input
                    type="text"
                    placeholder="Optional phone"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Payment Mode</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'CASH', label: 'Cash', icon: DollarSign },
                    { id: 'UPI', label: 'UPI / QR', icon: QrCode },
                    { id: 'CARD', label: 'Card', icon: CreditCard }
                  ].map((mode) => {
                    const Icon = mode.icon;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => setPaymentMode(mode.id)}
                        className={`flex items-center justify-center gap-1.5 py-2 rounded-xl border text-xs font-semibold transition ${
                          paymentMode === mode.id
                            ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {mode.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Discount (₹)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">GST (Tax)</label>
                <select
                  value={gstRate}
                  onChange={(e) => setGstRate(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value={0}>No GST (0%)</option>
                  <option value={5}>GST 5%</option>
                  <option value={12}>GST 12%</option>
                  <option value={18}>GST 18%</option>
                  <option value={28}>GST 28%</option>
                </select>
              </div>

              {/* Price Breakdown */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>Subtotal</span>
                  <span>₹{subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>{Number(gstRate) > 0 ? `GST (${gstRate}%)` : 'No GST'}</span>
                  <span>₹{taxAmount.toFixed(2)}</span>
                </div>
                {Number(discountAmount) > 0 && (
                  <div className="flex justify-between text-emerald-400">
                    <span>Discount</span>
                    <span>-₹{Number(discountAmount).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-white pt-2 border-t border-slate-800">
                  <span>Grand Total</span>
                  <span className="text-emerald-400 font-extrabold text-base">₹{grandTotal.toFixed(2)}</span>
                </div>
              </div>

              <button
                onClick={handleGenerateBill}
                disabled={cart.length === 0 || isSubmitting}
                className={`w-full py-3 rounded-xl font-bold text-sm shadow-xl flex items-center justify-center gap-2 transition ${
                  cart.length === 0 || isSubmitting
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
                }`}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Generating Bill...
                  </>
                ) : (
                  <>
                    <Printer className="w-4 h-4" />
                    Complete Sale & Print Bill (₹{grandTotal.toFixed(2)})
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
      )}

      {activeTab === 'history' && <SalesHistory />}

      {/* Generated Bill / Receipt Modal */}
      {showInvoiceModal && generatedInvoice && (
        <InvoiceModal invoice={generatedInvoice} onClose={() => setShowInvoiceModal(false)} />
      )}
    </div>
  );
}
