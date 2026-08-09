import React, { useState, useEffect, useCallback } from 'react';
import { 
  ShoppingBag, Search, Plus, Minus, Trash2, CreditCard, 
  DollarSign, QrCode, Printer, Download, CheckCircle, AlertCircle, 
  Smartphone, ShieldAlert, Sparkles, RefreshCw, X, ArrowLeft
} from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE_URL, resolveMediaUrl } from '../../config';

export default function StaffBilling() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Cart state
  const [cart, setCart] = useState([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMode, setPaymentMode] = useState('CASH');
  const [discountAmount, setDiscountAmount] = useState(0);

  // Billing modal / invoice receipt state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatedInvoice, setGeneratedInvoice] = useState(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  // PWA Install Prompt state
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  // Auth token check
  const getToken = () =>
    localStorage.getItem('warehouseToken') ||
    localStorage.getItem('warehouse_token') ||
    localStorage.getItem('staff_token');

  useEffect(() => {
    fetchBillingProducts();

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
  }, [fetchBillingProducts]);

  const fetchBillingProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE_URL}/warehouse/billing/products`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

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
      return [...prevCart, { ...product, qty: 1 }];
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
            return newQty > 0 ? { ...item, qty: newQty } : null;
          }
          return item;
        })
        .filter(Boolean)
    );
  };

  const removeFromCart = (id) => {
    setCart((prevCart) => prevCart.filter((item) => item.id !== id));
  };

  const clearCart = () => {
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setDiscountAmount(0);
  };

  // Calculations
  const subtotal = cart.reduce((acc, item) => acc + item.price * item.qty, 0);
  const taxAmount = Math.round(subtotal * 0.18 * 100) / 100; // 18% GST
  const grandTotal = Math.max(0, Math.round((subtotal + taxAmount - Number(discountAmount || 0)) * 100) / 100);

  // Generate Bill handler
  const handleGenerateBill = async () => {
    if (cart.length === 0) {
      toast.error('Cart is empty! Add products first.');
      return;
    }

    setIsSubmitting(true);
    try {
      const token = getToken();
      const payload = {
        customer_name: customerName || 'Counter Customer',
        customer_phone: customerPhone,
        payment_mode: paymentMode,
        discount_amount: Number(discountAmount || 0),
        items: cart.map((item) => ({
          product_id: item.id,
          qty: item.qty,
          price: item.price
        }))
      };

      const res = await fetch(`${API_BASE_URL}/warehouse/billing/generate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
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
    } catch (err) {
      console.error('Generate bill error:', err);
      toast.error(err.message || 'Failed to generate bill');
    } finally {
      setIsSubmitting(false);
    }
  };

  const categories = ['ALL', ...new Set(products.map((p) => p.category || 'General'))];

  const filteredProducts = products.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'ALL' || (p.category || 'General') === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  if (error) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-6 bg-slate-950">
        <div className="max-w-md w-full bg-slate-900 border border-red-500/30 rounded-2xl p-8 text-center shadow-2xl">
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
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
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

            {/* Category selector */}
            <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap border transition ${
                    selectedCategory === cat
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-md'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Product Grid */}
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl min-h-[500px]">
            {loading ? (
              <div className="min-h-[400px] flex items-center justify-center">
                <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="min-h-[400px] flex flex-col items-center justify-center text-slate-500">
                <ShoppingBag className="w-12 h-12 mb-2 opacity-50" />
                <p>No products available for billing</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {filteredProducts.map((product) => {
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
                cart.map((item) => (
                  <div key={item.id} className="bg-slate-950 border border-slate-800 p-2.5 rounded-xl flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 truncate">{item.name}</p>
                      <p className="text-[11px] text-slate-400">₹{item.price} x {item.qty} = <span className="text-emerald-400 font-semibold">₹{item.price * item.qty}</span></p>
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
                ))
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

              {/* Price Breakdown */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>Subtotal</span>
                  <span>₹{subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>GST (18%)</span>
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

      {/* Generated Bill / Receipt Modal */}
      {showInvoiceModal && generatedInvoice && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative animate-in fade-in zoom-in-95">
            <button
              onClick={() => setShowInvoiceModal(false)}
              className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="text-center border-b border-slate-800 pb-4 mb-4">
              <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto mb-2 text-emerald-400">
                <CheckCircle className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-white">JDLX Mobile - Tax Invoice</h2>
              <p className="text-xs text-slate-400">Counter Sale Receipt</p>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <div className="flex justify-between border-b border-slate-800/60 pb-2">
                <span className="text-slate-400">Invoice No:</span>
                <span className="font-mono font-bold text-white">{generatedInvoice.order_number}</span>
              </div>
              <div className="flex justify-between border-b border-slate-800/60 pb-2">
                <span className="text-slate-400">Customer:</span>
                <span className="font-medium text-white">{generatedInvoice.customer_name}</span>
              </div>
              <div className="flex justify-between border-b border-slate-800/60 pb-2">
                <span className="text-slate-400">Payment Method:</span>
                <span className="font-medium text-emerald-400">{generatedInvoice.payment_mode}</span>
              </div>
              <div className="flex justify-between border-b border-slate-800/60 pb-2">
                <span className="text-slate-400">Date & Time:</span>
                <span className="text-slate-300">{generatedInvoice.created_at}</span>
              </div>

              {/* Items Table */}
              <div className="mt-3 bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
                <p className="font-bold text-slate-400 uppercase text-[10px] tracking-wider mb-1">Purchased Items</p>
                {generatedInvoice.items?.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-xs">
                    <span className="truncate pr-2">{item.name} x{item.qty}</span>
                    <span className="font-semibold text-white">₹{item.subtotal}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-slate-800 space-y-1">
                  <div className="flex justify-between text-slate-400 text-[11px]">
                    <span>Subtotal:</span>
                    <span>₹{generatedInvoice.subtotal}</span>
                  </div>
                  <div className="flex justify-between text-slate-400 text-[11px]">
                    <span>GST (18%):</span>
                    <span>₹{generatedInvoice.tax_amount}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-white pt-1">
                    <span>Total Amount Paid:</span>
                    <span className="text-emerald-400 text-base">₹{generatedInvoice.total_amount}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => window.print()}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg"
              >
                <Printer className="w-4 h-4" /> Print Receipt
              </button>
              <button
                onClick={() => setShowInvoiceModal(false)}
                className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
