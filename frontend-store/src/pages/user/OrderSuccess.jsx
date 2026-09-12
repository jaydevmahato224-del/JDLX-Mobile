import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { CheckCircle2, Package, ShoppingBag, ArrowRight, Home, Truck, ShieldCheck } from 'lucide-react'
import { API_BASE_URL } from '../../config'
import LoadingScreen from '../../components/LoadingScreen'
import { apiFetch } from '../../utils/apiFetch'

function OrderSuccess() {
  const { orderId } = useParams()
  const navigate = useNavigate()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchOrder = async () => {
      try {
        const res = await apiFetch(`/order/${orderId}/status`)
        const data = await res.json()
        if (res.ok) {
          setOrder(data)
        }
      } catch (err) {
        console.error('Failed to fetch order details', err)
      } finally {
        setLoading(false)
      }
    }
    fetchOrder()
  }, [orderId])

  if (loading) return <LoadingScreen />

  return (
    <div className="container-standard py-12 flex flex-col items-center justify-center min-h-[80vh] animate-in fade-in zoom-in duration-700">
      {/* Success Icon with Glow */}
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-emerald-500/20 blur-3xl rounded-full animate-pulse" />
        <CheckCircle2 className="w-24 h-24 text-emerald-500 relative z-10 drop-shadow-[0_0_15px_rgba(16,185,129,0.4)]" />
      </div>

      <div className="text-center space-y-3 mb-10">
        <h1 className="text-4xl font-black tracking-tighter text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>
          Order Confirmed!
        </h1>
        <p className="text-[var(--color-on-surface-variant)] font-medium max-w-md mx-auto leading-relaxed">
          Thank you for your purchase. Your order <span className="text-primary font-black">#{order?.order_number || orderId}</span> has been placed successfully and is being processed.
        </p>
      </div>

      {/* Order Quick Summary Card */}
      {order && (
        <div className="w-full max-w-md glass-card p-6 border-none shadow-2xl mb-10 space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-[var(--color-surface-high)]">
            <span className="text-xs font-black uppercase tracking-widest text-slate-400">Order Details</span>
            <span className="text-xs font-black bg-primary/10 text-primary px-3 py-1 rounded-full uppercase tracking-tighter">
              {order.order_status}
            </span>
          </div>
          
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-[var(--color-on-surface-variant)] flex items-center gap-2">
                <Package size={16} /> Total Amount
              </span>
              <span className="text-lg font-black text-[var(--color-on-surface)]">₹{order.total_amount}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-[var(--color-on-surface-variant)] flex items-center gap-2">
                <Truck size={16} /> Delivery To
              </span>
              <span className="text-sm font-black text-[var(--color-on-surface)] truncate max-w-[200px]">{order.delivery_address}</span>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
        <button 
          onClick={() => navigate(`/track/${orderId}`)}
          className="flex-1 py-4 rounded-[20px] bg-primary text-[var(--color-on-primary)] font-black tracking-tight flex items-center justify-center gap-2 shadow-lg hover:bg-[var(--color-primary-dark)] active:scale-95 transition-all"
        >
          Track Order <ArrowRight size={18} />
        </button>
        <button 
          onClick={() => navigate('/')}
          className="flex-1 py-4 rounded-[20px] bg-[var(--color-surface-container)] text-[var(--color-on-surface)] font-black tracking-tight flex items-center justify-center gap-2 hover:bg-[var(--color-surface-high)] transition-all"
        >
          <ShoppingBag size={18} /> Continue Shopping
        </button>
      </div>

      {/* Footer Signals */}
      <div className="mt-12 flex flex-col items-center gap-4 opacity-40">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--color-on-surface-variant)]">
          <ShieldCheck size={14} className="text-emerald-500" />
          JDLX Guaranteed Service
        </div>
      </div>
    </div>
  )
}

export default OrderSuccess
