import { useState, useEffect, useCallback, useRef } from 'react';
import {
  History, Search, RotateCcw, ArrowLeftRight, Ban, X,
  RefreshCw, AlertCircle, Minus, Plus, Receipt, Phone, User, Filter,
  Calendar, Wallet, Clock
} from 'lucide-react';
import toast from 'react-hot-toast';
import { billingApi, formatBillDate, parseDbDate } from './BillingApi';
import InvoiceModal from './InvoiceModal';

const STATUS_STYLES = {
  active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
  partially_returned: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
  partially_exchanged: 'bg-orange-500/15 text-orange-400 border-orange-500/40',
  returned: 'bg-sky-500/15 text-sky-400 border-sky-500/40',
  exchanged: 'bg-violet-500/15 text-violet-400 border-violet-500/40',
  cancelled: 'bg-red-500/15 text-red-400 border-red-500/40',
};

const STATUS_LABELS = {
  active: 'Active',
  partially_returned: 'Partially Returned',
  partially_exchanged: 'Partially Exchanged',
  returned: 'Returned',
  exchanged: 'Exchanged',
  cancelled: 'Cancelled',
};

const FILTERS = ['ALL', 'active', 'partially_returned', 'partially_exchanged', 'returned', 'exchanged', 'cancelled'];

/* Local-day boundaries converted to UTC strings for API filtering. The DB
   stores created_at in UTC, so local midnight -> its UTC equivalent keeps
   "Today" exactly the agent's local day regardless of timezone. */
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
const toUtc = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

/* Counter-sale bills follow a 24-hour return/exchange/cancel window (offline
   POS policy only — the online store's return policy is unaffected). The
   backend enforces the same rule; these helpers just keep the UI in sync. */
const RETURN_WINDOW_HOURS = 24;
const isWithinReturnWindow = (bill) => {
  const d = parseDbDate(bill.created_at);
  if (!d) return true; // unparseable timestamp → don't block in UI (backend enforces anyway)
  return Date.now() - d.getTime() <= RETURN_WINDOW_HOURS * 60 * 60 * 1000;
};
const returnWindowDeadline = (bill) => {
  const d = parseDbDate(bill.created_at);
  return d ? new Date(d.getTime() + RETURN_WINDOW_HOURS * 60 * 60 * 1000) : null;
};
const formatDeadline = (bill) => {
  const d = returnWindowDeadline(bill);
  if (!d) return '';
  const now = new Date();
  return d.toLocaleString(undefined, {
    ...(d.toDateString() === now.toDateString() ? {} : { day: 'numeric', month: 'short' }),
    hour: '2-digit',
    minute: '2-digit',
  });
};

function StatusBadge({ status }) {
  const key = status || 'active';
  const style = STATUS_STYLES[key] || STATUS_STYLES.active;
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${style}`}>
      {STATUS_LABELS[key] || key}
    </span>
  );
}

/* ---------------- Shared qty stepper ---------------- */
function QtyStepper({ value, onChange, max, disabled }) {
  return (
    <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-0.5 shrink-0">
      <button
        type="button"
        disabled={disabled || value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
        className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Minus className="w-3 h-3" />
      </button>
      <span className="text-xs font-bold w-6 text-center text-slate-200">{value}</span>
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
}

/* ---------------- Modal shell (bottom sheet on mobile) ---------------- */
function Sheet({ title, icon, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl max-w-lg w-full sm:max-h-[90vh] max-h-[92vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-indigo-400">
              {icon}
            </div>
            <h3 className="text-sm font-bold text-white">{title}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-slate-800 shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

function SubmitButton({ onClick, disabled, loading, children, color = 'indigo' }) {
  const palette = {
    indigo: 'bg-indigo-600 hover:bg-indigo-500 text-white',
    emerald: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    red: 'bg-red-600 hover:bg-red-500 text-white',
    amber: 'bg-amber-600 hover:bg-amber-500 text-white',
    sky: 'bg-sky-600 hover:bg-sky-500 text-white',
  }[color];
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`w-full py-3 rounded-xl font-bold text-sm shadow-xl flex items-center justify-center gap-2 transition disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed ${palette}`}
    >
      {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : children}
    </button>
  );
}

/* ---------------- Main: Sales History ---------------- */
export default function SalesHistory() {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  // Date & payment filters (server-side on created_at / payment_type)
  const [dateFilter, setDateFilter] = useState('ALL'); // ALL|TODAY|YESTERDAY|WEEK|MONTH|CUSTOM
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('ALL'); // ALL|CASH|UPI|CARD
  const [expandedId, setExpandedId] = useState(null);

  // Products cache for the exchange picker
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState('');

  // Modals
  const [returnBill, setReturnBill] = useState(null);
  const [returnQtys, setReturnQtys] = useState({});
  const [exchangeBill, setExchangeBill] = useState(null);
  const [exchangeQtys, setExchangeQtys] = useState({});
  const [exchangeNew, setExchangeNew] = useState([]);
  const [exchangeGst, setExchangeGst] = useState(0);
  const [cancelBill, setCancelBill] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  /* -------- Date & payment filter helpers -------- */
  const dateRangeFor = useCallback(() => {
    const now = new Date();
    switch (dateFilter) {
      case 'TODAY':
        return { from: toUtc(startOfDay(now)), to: toUtc(endOfDay(now)) };
      case 'YESTERDAY': {
        const y = new Date(now);
        y.setDate(now.getDate() - 1);
        return { from: toUtc(startOfDay(y)), to: toUtc(endOfDay(y)) };
      }
      case 'WEEK': {
        const monday = new Date(now);
        monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
        return { from: toUtc(startOfDay(monday)), to: toUtc(endOfDay(now)) };
      }
      case 'MONTH': {
        const first = new Date(now.getFullYear(), now.getMonth(), 1);
        return { from: toUtc(startOfDay(first)), to: toUtc(endOfDay(now)) };
      }
      case 'CUSTOM':
        if (customFrom && customTo) {
          return {
            from: toUtc(startOfDay(new Date(`${customFrom}T00:00:00`))),
            to: toUtc(endOfDay(new Date(`${customTo}T00:00:00`))),
          };
        }
        return null;
      default:
        return null;
    }
  }, [dateFilter, customFrom, customTo]);

  const dateFilterLabel = ({
    ALL: 'All Time',
    TODAY: 'Today',
    YESTERDAY: 'Yesterday',
    WEEK: 'This Week',
    MONTH: 'This Month',
    CUSTOM: customFrom && customTo ? `${customFrom} → ${customTo}` : 'Custom Range',
  }[dateFilter] || 'All Time');

  const buildParams = useCallback(() => {
    const range = dateRangeFor();
    return {
      q: search.trim(),
      from: range ? range.from : '',
      to: range ? range.to : '',
      payment: paymentFilter === 'ALL' ? '' : paymentFilter,
    };
  }, [search, paymentFilter, dateRangeFor]);

  const fetchBills = useCallback(async (params) => {
    setLoading(true);
    setError(null);
    try {
      const data = await billingApi.history(params);
      setBills(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Failed to load sales history');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load (no filters)
  useEffect(() => { fetchBills({}); }, [fetchBills]);

  // Debounced refetch whenever search/date/payment filters change (skips the
  // first run — the initial load above already fetched).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    const t = setTimeout(() => fetchBills(buildParams()), 350);
    return () => clearTimeout(t);
  }, [buildParams, fetchBills]);

  // Products for exchange picker
  useEffect(() => {
    billingApi.products()
      .then((d) => setProducts(Array.isArray(d) ? d : []))
      .catch(() => { /* non-blocking */ });
  }, []);

  const filtered = bills.filter((b) => {
    const st = b.billing_status || 'active';
    return statusFilter === 'ALL' || st === statusFilter;
  });

  // Group the (already date/payment/status filtered) bills by LOCAL day so the
  // agent can scan "Today" / "Yesterday" / a specific date at a glance.
  const localDayKey = (value) => {
    const d = parseDbDate(value);
    if (!d) return 'unknown';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dayLabel = (key) => {
    if (key === 'unknown') return 'Unknown date';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const d = new Date(`${key}T00:00:00`);
    if (d.getTime() === today.getTime()) return 'Today';
    if (d.getTime() === yesterday.getTime()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };
  const dayGroups = [];
  const byDay = {};
  filtered.forEach((b) => {
    const k = localDayKey(b.created_at);
    (byDay[k] = byDay[k] || []).push(b);
  });
  Object.keys(byDay).sort().reverse().forEach((k) => {
    dayGroups.push({ key: k, label: dayLabel(k), bills: byDay[k] });
  });

  // Only money still collected counts — cancelled bills were refunded.
  const totalCollected = bills
    .filter((b) => (b.billing_status || 'active') !== 'cancelled')
    .reduce((a, b) => a + (Number(b.total_amount) || 0), 0);

  /* -------- Return handlers -------- */
  const openReturn = (bill) => {
    const q = {};
    bill.items.forEach((i) => { q[i.id] = 0; });
    setReturnQtys(q);
    setReturnBill(bill);
  };

  const returnRefund = returnBill
    ? returnBill.items.reduce(
        (a, i) => a + (Number(i.price) || 0) * (Number(returnQtys[i.id]) || 0),
        0
      )
    : 0;

  const submitReturn = async () => {
    const items = returnBill.items
      .filter((i) => (Number(returnQtys[i.id]) || 0) > 0)
      .map((i) => ({ item_id: i.id, qty: Number(returnQtys[i.id]) }));
    if (!items.length) { toast.error('Select at least one item to return'); return; }
    setSubmitting(true);
    try {
      const res = await billingApi.returnItems({ order_id: returnBill.id, items });
      toast.success(`Return processed — refund ₹${Number(res.refund_amount || 0).toFixed(2)}`);
      setReturnBill(null);
      fetchBills(buildParams());
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  /* -------- Exchange handlers -------- */
  const openExchange = (bill) => {
    const q = {};
    bill.items.forEach((i) => { q[i.id] = 0; });
    setExchangeQtys(q);
    setExchangeNew([]);
    setExchangeGst(0);
    setProductSearch('');
    setExchangeBill(bill);
  };

  const addExchangeProduct = (p) => {
    if ((Number(p.stock) || 0) <= 0) { toast.error('Item is out of stock'); return; }
    setExchangeNew((prev) => {
      const ex = prev.find((x) => x.product_id === p.id);
      if (ex) {
        return prev.map((x) =>
          x.product_id === p.id ? { ...x, qty: Math.min(x.qty + 1, Number(p.stock)) } : x
        );
      }
      return [...prev, { product_id: p.id, name: p.name, price: Number(p.price) || 0, qty: 1, stock: Number(p.stock) || 0 }];
    });
  };

  const changeExchangeQty = (pid, qty) =>
    setExchangeNew((prev) =>
      prev.map((x) => (x.product_id === pid ? { ...x, qty: Math.max(0, Math.min(qty, x.stock)) } : x))
    );

  const exchangeRefund = exchangeBill
    ? exchangeBill.items.reduce(
        (a, i) => a + (Number(i.price) || 0) * (Number(exchangeQtys[i.id]) || 0),
        0
      )
    : 0;
  const newSubtotal = exchangeNew.reduce((a, x) => a + x.price * x.qty, 0);
  const newTax = Math.round(newSubtotal * (Number(exchangeGst) / 100) * 100) / 100;
  const newTotal = newSubtotal + newTax;
  const exchangeDiff = newTotal - exchangeRefund;

  const submitExchange = async () => {
    const returnItems = exchangeBill.items
      .filter((i) => (Number(exchangeQtys[i.id]) || 0) > 0)
      .map((i) => ({ item_id: i.id, qty: Number(exchangeQtys[i.id]) }));
    if (!returnItems.length) { toast.error('Select the items being returned'); return; }
    if (!exchangeNew.length) { toast.error('Add at least one replacement product'); return; }
    setSubmitting(true);
    try {
      const res = await billingApi.exchange({
        order_id: exchangeBill.id,
        return_items: returnItems,
        new_items: exchangeNew.map((x) => ({ product_id: x.product_id, qty: x.qty })),
        gst_rate: exchangeGst,
        payment_mode: 'CASH',
      });
      const diff = Number(res.exchange_difference || 0);
      if (diff > 0) {
        toast.success(`Exchange done — customer pays extra ₹${diff.toFixed(2)}`);
      } else {
        toast.success(`Exchange done — refund due ₹${Math.abs(diff).toFixed(2)}`);
      }
      setExchangeBill(null);
      fetchBills(buildParams());
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  /* -------- Cancel handlers -------- */
  const cancelRefund = cancelBill
    ? cancelBill.items.reduce(
        (a, i) => a + (Number(i.price) || 0) * (Number(i.quantity) - Number(i.returned_qty || 0)),
        0
      )
    : 0;

  const submitCancel = async () => {
    setSubmitting(true);
    try {
      const res = await billingApi.cancel({ order_id: cancelBill.id });
      toast.success(`Bill cancelled — refund ₹${Number(res.refund_amount || 0).toFixed(2)}`);
      setCancelBill(null);
      fetchBills(buildParams());
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  /* -------- Invoice re-view -------- */
  const openInvoice = (b) =>
    setInvoice({
      ...b,
      items: (b.items || []).map((i) => ({
        ...i,
        name: i.product_name || i.name,
        qty: i.quantity ?? i.qty,
      })),
    });

  /* ============================================================ */
  const filterProducts = products.filter((p) =>
    (p.name || '').toLowerCase().includes(productSearch.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-indigo-400">
            <History className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">Sales History</h1>
            <p className="text-xs text-slate-400">
              {bills.length} bills · ₹{totalCollected.toFixed(2)} collected
              {dateFilter !== 'ALL' && (
                <span className="text-indigo-400 font-semibold"> · {dateFilterLabel}</span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchBills(buildParams())}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 text-xs font-semibold transition w-full sm:w-auto justify-center"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Search + Filter */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search bill no. / customer / phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition"
          />
        </div>

        {/* Date range quick filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          {[['ALL', 'All Time'], ['TODAY', 'Today'], ['YESTERDAY', 'Yesterday'], ['WEEK', 'This Week'], ['MONTH', 'This Month'], ['CUSTOM', 'Custom']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setDateFilter(val)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap border transition ${
                dateFilter === val
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Custom date range pickers */}
        {dateFilter === 'CUSTOM' && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 [color-scheme:dark]"
              />
              <span className="text-xs text-slate-500">to</span>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 [color-scheme:dark]"
              />
            </div>
            {(!customFrom || !customTo) && (
              <p className="text-[11px] text-slate-500">Select both dates to filter bills by range</p>
            )}
          </div>
        )}

        {/* Payment mode filter */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <Wallet className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          {[['ALL', 'All Payments'], ['CASH', 'Cash'], ['UPI', 'UPI / QR'], ['CARD', 'Card']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setPaymentFilter(val)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap border transition ${
                paymentFilter === val
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Bill status filter */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <Filter className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap border transition ${
                statusFilter === f
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
              }`}
            >
              {f === 'ALL' ? 'All Bills' : STATUS_LABELS[f] || f}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-slate-900 border border-red-500/30 rounded-2xl p-8 text-center">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <p className="text-slate-300 text-sm mb-4">{error}</p>
          <button
            onClick={() => fetchBills()}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-xl text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Bill list */}
      {!error && loading && bills.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl min-h-[300px] flex items-center justify-center">
          <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
        </div>
      )}

      {!error && !loading && filtered.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl min-h-[300px] flex flex-col items-center justify-center text-slate-500">
          <Receipt className="w-12 h-12 mb-2 opacity-40" />
          <p className="text-sm">No bills found</p>
          <p className="text-xs text-slate-600 mt-1">Complete a counter sale to see it here</p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="space-y-5">
          {dayGroups.map((g) => (
            <div key={g.key}>
              <div className="flex items-center gap-2 mb-2 px-1">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{g.label}</p>
                <div className="flex-1 h-px bg-slate-800" />
                <p className="text-[10px] text-slate-500 shrink-0">
                  {g.bills.length} bill{g.bills.length > 1 ? 's' : ''} · ₹{g.bills.reduce((a, b) => a + (Number(b.total_amount) || 0), 0).toFixed(2)}
                </p>
              </div>
              <div className="space-y-3">
                {g.bills.map((b) => {
          const expanded = expandedId === b.id;
          const st = b.billing_status || 'active';
          const canAct = !['returned', 'exchanged', 'cancelled'].includes(st);
          return (
            <div
              key={b.id}
              className={`bg-slate-900 border rounded-2xl transition ${
                expanded ? 'border-indigo-500/60' : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              {/* Card header (tap to expand) */}
              <button
                onClick={() => setExpandedId(expanded ? null : b.id)}
                className="w-full p-4 flex items-center justify-between gap-3 text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`p-2.5 rounded-xl border shrink-0 ${
                    st === 'cancelled' ? 'bg-red-500/10 border-red-500/30 text-red-400'
                    : ['returned', 'exchanged'].includes(st) ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  }`}>
                    <Receipt className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-mono text-xs sm:text-sm font-bold text-white truncate">{b.order_number}</p>
                    <p className="text-[11px] text-slate-400 truncate flex items-center gap-1">
                      <User className="w-3 h-3 shrink-0" />
                      {b.customer_name || 'Counter Customer'}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0 flex flex-col items-end gap-1">
                  <p className="font-bold text-emerald-400 text-sm">₹{Number(b.total_amount || 0).toFixed(2)}</p>
                  <StatusBadge status={st} />
                </div>
              </button>

              {/* Expanded details */}
              {expanded && (
                <div className="px-4 pb-4 space-y-3 animate-in fade-in">
                  <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
                    <span className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {b.customer_phone || '—'}
                    </span>
                    <span className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1">{b.payment_mode || 'CASH'}</span>
                    <span className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1">{formatBillDate(b.created_at)}</span>
                    {/* 24h window chip — only while the bill is still actionable,
                        and only when its timestamp can be parsed. */}
                    {canAct && returnWindowDeadline(b) && (
                      <span className={`bg-slate-950 border rounded-lg px-2.5 py-1 flex items-center gap-1 ${
                        isWithinReturnWindow(b)
                          ? 'border-emerald-500/30 text-emerald-400'
                          : 'border-red-500/30 text-red-400'
                      }`}>
                        <Clock className="w-3 h-3 shrink-0" />
                        {isWithinReturnWindow(b)
                          ? `Return/Exchange/Cancel till ${formatDeadline(b)}`
                          : 'Return/Exchange/Cancel window closed'}
                      </span>
                    )}
                    {Number(b.gst_rate) > 0 && (
                      <span className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1">GST {b.gst_rate}%</span>
                    )}
                  </div>

                  {/* Items */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
                    {(b.items || []).map((i) => {
                      const returned = Number(i.returned_qty || 0);
                      return (
                        <div key={i.id} className="flex justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <p className="text-slate-200 font-medium truncate">{i.product_name}</p>
                            <p className="text-[10px] text-slate-500">
                              ₹{Number(i.price || 0).toFixed(2)} × {i.quantity}
                              {returned > 0 && <span className="text-amber-400"> · {returned} returned</span>}
                            </p>
                          </div>
                          <span className="font-semibold text-white shrink-0">₹{Number(i.subtotal || 0).toFixed(2)}</span>
                        </div>
                      );
                    })}
                    <div className="pt-2 border-t border-slate-800 space-y-1 text-[11px]">
                      {Number(b.discount_amount) > 0 && (
                        <div className="flex justify-between text-slate-400">
                          <span>Discount</span><span>-₹{Number(b.discount_amount).toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm font-bold">
                        <span className="text-slate-300">Total Paid</span>
                        <span className="text-emerald-400">₹{Number(b.total_amount || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions — Return/Exchange/Cancel only inside the 24h window */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      onClick={() => openInvoice(b)}
                      className="flex items-center justify-center gap-1.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 text-[11px] font-semibold transition"
                    >
                      <Receipt className="w-3.5 h-3.5" /> Invoice
                    </button>
                    {canAct && isWithinReturnWindow(b) && (
                      <>
                        <button
                          onClick={() => openReturn(b)}
                          className="flex items-center justify-center gap-1.5 py-2.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 rounded-xl border border-amber-500/40 text-[11px] font-semibold transition"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Return
                        </button>
                        <button
                          onClick={() => openExchange(b)}
                          className="flex items-center justify-center gap-1.5 py-2.5 bg-sky-500/15 hover:bg-sky-500/25 text-sky-400 rounded-xl border border-sky-500/40 text-[11px] font-semibold transition"
                        >
                          <ArrowLeftRight className="w-3.5 h-3.5" /> Exchange
                        </button>
                        <button
                          onClick={() => setCancelBill(b)}
                          className="flex items-center justify-center gap-1.5 py-2.5 bg-red-500/15 hover:bg-red-500/25 text-red-400 rounded-xl border border-red-500/40 text-[11px] font-semibold transition"
                        >
                          <Ban className="w-3.5 h-3.5" /> Cancel Bill
                        </button>
                      </>
                    )}
                    {canAct && !isWithinReturnWindow(b) && (
                      <div className="col-span-2 sm:col-span-3 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-500">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        Return/Exchange closed — only available within 24 hours of the bill
                      </div>
                    )}
                  </div>
                </div>
              )}
              </div>
            );
            })}
            </div>
          </div>
          ))}
        </div>
      )}

      {/* ============ RETURN MODAL ============ */}
      {returnBill && (
        <Sheet
          title={`Return Items — ${returnBill.order_number}`}
          icon={<RotateCcw className="w-4 h-4" />}
          onClose={() => setReturnBill(null)}
          footer={
            <div className="space-y-3">
              <div className="flex justify-between text-sm bg-slate-950 border border-slate-800 rounded-xl px-4 py-3">
                <span className="text-slate-400">Total Refund</span>
                <span className="font-bold text-amber-400">₹{returnRefund.toFixed(2)}</span>
              </div>
              <SubmitButton onClick={submitReturn} loading={submitting} disabled={returnRefund <= 0} color="amber">
                Confirm Return (Refund ₹{returnRefund.toFixed(2)})
              </SubmitButton>
            </div>
          }
        >
          <p className="text-xs text-slate-400 mb-3">Select how many of each item the customer is returning. Stock will be added back automatically.</p>
          <div className="space-y-2">
            {returnBill.items.map((i) => {
              const remaining = Number(i.quantity) - Number(i.returned_qty || 0);
              if (remaining <= 0) return null;
              return (
                <div key={i.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-200 truncate">{i.product_name}</p>
                    <p className="text-[10px] text-slate-500">Max returnable: {remaining}</p>
                  </div>
                  <QtyStepper
                    value={Number(returnQtys[i.id]) || 0}
                    max={remaining}
                    onChange={(v) => setReturnQtys((q) => ({ ...q, [i.id]: v }))}
                  />
                </div>
              );
            })}
          </div>
        </Sheet>
      )}

      {/* ============ EXCHANGE MODAL ============ */}
      {exchangeBill && (
        <Sheet
          title={`Exchange — ${exchangeBill.order_number}`}
          icon={<ArrowLeftRight className="w-4 h-4" />}
          onClose={() => setExchangeBill(null)}
          footer={
            <div className="space-y-3">
              <div className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 space-y-1 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>Returning value</span><span>-₹{exchangeRefund.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>New items</span><span>₹{newTotal.toFixed(2)}</span>
                </div>
                <div className={`flex justify-between text-sm font-bold pt-1 border-t border-slate-800 ${
                  exchangeDiff > 0 ? 'text-red-400' : exchangeDiff < 0 ? 'text-emerald-400' : 'text-slate-200'
                }`}>
                  <span>{exchangeDiff > 0 ? 'Customer pays extra' : exchangeDiff < 0 ? 'Refund due' : 'No difference'}</span>
                  <span>{exchangeDiff !== 0 ? `₹${Math.abs(exchangeDiff).toFixed(2)}` : '—'}</span>
                </div>
              </div>
              <SubmitButton
                onClick={submitExchange}
                loading={submitting}
                disabled={exchangeRefund <= 0 || !exchangeNew.length}
                color="sky"
              >
                Complete Exchange
              </SubmitButton>
            </div>
          }
        >
          {/* Returned items */}
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">1 · Items being returned</p>
          <div className="space-y-2 mb-5">
            {exchangeBill.items.map((i) => {
              const remaining = Number(i.quantity) - Number(i.returned_qty || 0);
              if (remaining <= 0) return null;
              return (
                <div key={i.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-200 truncate">{i.product_name}</p>
                    <p className="text-[10px] text-slate-500">₹{Number(i.price || 0).toFixed(2)} · max {remaining}</p>
                  </div>
                  <QtyStepper
                    value={Number(exchangeQtys[i.id]) || 0}
                    max={remaining}
                    onChange={(v) => setExchangeQtys((q) => ({ ...q, [i.id]: v }))}
                  />
                </div>
              );
            })}
          </div>

          {/* Replacement products */}
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">2 · Replacement products</p>
          <div className="relative mb-2">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search replacement products..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="max-h-44 overflow-y-auto space-y-2 mb-4 pr-1">
            {filterProducts.map((p) => (
              <button
                key={p.id}
                onClick={() => addExchangeProduct(p)}
                disabled={Number(p.stock) <= 0}
                className="w-full bg-slate-950 border border-slate-800 hover:border-indigo-500/60 disabled:opacity-40 rounded-xl p-2.5 flex items-center justify-between gap-2 text-left transition"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-200 truncate">{p.name}</p>
                  <p className="text-[10px] text-slate-500">Stock: {p.stock || 0}</p>
                </div>
                <span className="text-xs font-bold text-emerald-400 shrink-0">₹{Number(p.price || 0).toFixed(2)}</span>
              </button>
            ))}
            {!filterProducts.length && (
              <p className="text-center text-xs text-slate-500 py-3">No products match</p>
            )}
          </div>

          {/* Selected replacements */}
          {exchangeNew.length > 0 && (
            <div className="space-y-2 mb-5">
              {exchangeNew.map((x) => (
                <div key={x.product_id} className="bg-indigo-500/10 border border-indigo-500/40 rounded-xl p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-200 truncate">{x.name}</p>
                    <p className="text-[10px] text-slate-400">₹{x.price.toFixed(2)} each</p>
                  </div>
                  <QtyStepper value={x.qty} max={x.stock} onChange={(v) => changeExchangeQty(x.product_id, v)} />
                </div>
              ))}
            </div>
          )}

          {/* GST for the new bill */}
          <div>
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">GST on new items</label>
            <div className="flex gap-2 flex-wrap">
              {[0, 5, 12, 18, 28].map((r) => (
                <button
                  key={r}
                  onClick={() => setExchangeGst(r)}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-bold transition ${
                    exchangeGst === r
                      ? 'bg-indigo-600 text-white border-indigo-500'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {r === 0 ? 'No GST' : `${r}%`}
                </button>
              ))}
            </div>
          </div>
        </Sheet>
      )}

      {/* ============ CANCEL MODAL ============ */}
      {cancelBill && (
        <Sheet
          title="Cancel Bill"
          icon={<Ban className="w-4 h-4" />}
          onClose={() => setCancelBill(null)}
          footer={
            <div className="space-y-3">
              <div className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 space-y-1 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>Bill</span><span className="font-mono text-white">{cancelBill.order_number}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Refund to customer</span><span className="font-bold text-red-400">₹{cancelRefund.toFixed(2)}</span>
                </div>
              </div>
              <SubmitButton onClick={submitCancel} loading={submitting} color="red">
                Yes, Cancel & Refund Bill
              </SubmitButton>
            </div>
          }
        >
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-300 leading-relaxed">
              This will <b className="text-red-300">cancel the entire bill</b>, add all remaining items back to
              stock, and mark it refunded. This cannot be undone. Use <b>Return</b> for partial quantities instead.
            </p>
          </div>
        </Sheet>
      )}

      {/* Invoice re-view modal */}
      {invoice && <InvoiceModal invoice={invoice} onClose={() => setInvoice(null)} />}
    </div>
  );
}
