import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Activity,
    LayoutDashboard,
    MapPin,
    Package,
    Radio,
    Loader2,
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { apiClient } from '../../utils/apiClient'
import StatCards from './components/StatCards'
import FulfillmentQueue from './components/FulfillmentQueue'
import InventoryAlerts from './components/InventoryAlerts'
import ScoreCards from './components/ScoreCards'

const EMPTY_DASHBOARD = {
    cards: {
        total_orders_assigned: 0,
        pending_orders: 0,
        packed_orders: 0,
        dispatched_orders: 0,
        low_stock_alerts: 0,
    },
    performance_metrics: {
        acceptance_rate: 0,
        accepted_orders: 0,
        completed_dispatches: 0,
    },
    recent_orders: [],
    inventory_summary: [],
}

const NAV_ITEMS = [
    { icon: LayoutDashboard, label: 'Dashboard', active: true },
    { icon: Package, label: 'Inventory', active: false },
    { icon: Activity, label: 'Analytics', active: false },
    { icon: MapPin, label: 'Nodes', active: false },
]

const WarehouseDashboard = () => {
    const navigate = useNavigate()
    const { warehouseUser, warehouseToken, warehouseLogout, setWarehouseUser } = useStore()
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState(EMPTY_DASHBOARD)
    const [actionError, setActionError] = useState('')
    const [updatingOrderId, setUpdatingOrderId] = useState(null)

    const fetchDashboardData = useCallback(async () => {
        if (!warehouseToken) return

        try {
            const result = await apiClient.get('/warehouse/dashboard')
            setData({
                ...EMPTY_DASHBOARD,
                ...result,
                cards: {
                    ...EMPTY_DASHBOARD.cards,
                    ...(result.cards || {}),
                },
                performance_metrics: {
                    ...EMPTY_DASHBOARD.performance_metrics,
                    ...(result.performance_metrics || {}),
                },
                recent_orders: Array.isArray(result.recent_orders) ? result.recent_orders : [],
                inventory_summary: Array.isArray(result.inventory_summary) ? result.inventory_summary : [],
            })

            // Sync global user state with current backend settings
            if (result.settings) {
                const updatedUser = { 
                    ...warehouseUser, 
                    ...result.settings 
                }
                // Only update if something actually changed to avoid unnecessary re-renders
                if (JSON.stringify(updatedUser) !== JSON.stringify(warehouseUser)) {
                    setWarehouseUser(updatedUser, warehouseToken)
                }
            }
            setActionError('')
        } catch (error) {
            console.error('Failed to fetch warehouse data:', error)
            setActionError(error.message || 'Failed to load warehouse dashboard.')
            setData(EMPTY_DASHBOARD)
        } finally {
            setLoading(false)
        }
    }, [warehouseToken, warehouseLogout, navigate])

    useEffect(() => {
        if (!warehouseToken) {
            navigate('/warehouse/login')
            return
        }
        fetchDashboardData()

        const interval = setInterval(fetchDashboardData, 30000)
        return () => clearInterval(interval)
    }, [warehouseToken, navigate, fetchDashboardData])

    const handleUpdateStatus = async (orderId, status) => {
        if (!warehouseToken) return

        setUpdatingOrderId(orderId)
        setActionError('')
        try {
            await apiClient.patch(`/warehouse/orders/${orderId}/status`, { status })
            await fetchDashboardData()
        } catch (error) {
            console.error('Failed to update warehouse order:', error)
            setActionError(error.message || 'Failed to update warehouse order.')
        } finally {
            setUpdatingOrderId(null)
        }
    }

    // Read-only terminal indicator on the dashboard. The full Terminal Status
    // controls (open/close + quick mode) live on the Profile page; tapping the
    // chip takes the partner there to manage the terminal.
    const isTerminalOpen = (warehouseUser?.operations_status || 'open') === 'open'

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <Loader2 className="w-10 h-10 text-amber-500 animate-spin mb-4" />
                <p className="text-slate-400 font-medium tracking-tight">Syncing Operations Hub...</p>
            </div>
        )
    }

    return (
        <div className="warehouse-page-content py-3 sm:py-4 lg:py-8">
            <div className="warehouse-main-content">
                <div className="pb-12 pt-[var(--app-header-height)] lg:pb-14 lg:pt-4">
                    {/* Hero — Operations identity + live terminal status */}
                    <section className="warehouse-panel p-4 sm:p-6 lg:p-8">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 wh-ui-label text-amber-300">
                                Operations Hub
                            </div>
                            <button
                                onClick={() => navigate('/warehouse/profile')}
                                title="Manage terminal status"
                                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95 ${
                                    isTerminalOpen
                                        ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                                        : 'border-rose-400/20 bg-rose-400/10 text-rose-300'
                                }`}
                            >
                                <span className={`h-2 w-2 rounded-full animate-pulse ${
                                    isTerminalOpen
                                        ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]'
                                        : 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.6)]'
                                }`} />
                                {isTerminalOpen ? 'Terminal Open' : 'Terminal Closed'}
                            </button>
                        </div>

                        <div className="mt-8 flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
                            <div className="min-w-0">
                                <h1 className="wh-ui-h1 text-white break-words">
                                    {warehouseUser?.warehouse_name || 'Warehouse Dashboard'}
                                </h1>
                                <div className="flex flex-wrap items-center gap-3 mt-3">
                                    <div className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 flex items-center gap-2">
                                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Hub ID</span>
                                        <span className="text-xs font-black text-amber-400">#{warehouseUser?.store_id || warehouseUser?.id || '--'}</span>
                                    </div>
                                    <div className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 flex items-center gap-2">
                                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Partner ID</span>
                                        <span className="text-xs font-black text-amber-400">{warehouseUser?.partner_id || '------'}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 sm:gap-5 xl:w-[440px] xl:shrink-0">
                                <div className="warehouse-subtle-card p-4 sm:p-5">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                                            <Radio size={18} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="wh-ui-label text-slate-400/80">
                                                Queue Status
                                            </p>
                                            <p className="mt-1 text-sm sm:text-base font-bold text-white tracking-tight truncate">Live feed active</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="warehouse-subtle-card p-4 sm:p-5">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-400/10 text-blue-300">
                                            <MapPin size={18} />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">
                                                Active Zone
                                            </p>
                                            <p className="mt-1 text-sm sm:text-base font-semibold text-white truncate">
                                                {warehouseUser?.pincode || 'N/A'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    {actionError ? (
                        <div className="mt-6 rounded-[24px] border border-rose-500/20 bg-rose-500/10 px-5 py-4 text-sm leading-6 text-rose-200">
                            {actionError}
                        </div>
                    ) : null}

                    <div className="mt-6 lg:mt-8">
                        <StatCards
                            totalOrdersAssigned={data.cards.total_orders_assigned}
                            pendingOrders={data.cards.pending_orders}
                            packedOrders={data.cards.packed_orders}
                            dispatchedOrders={data.cards.dispatched_orders}
                        />
                    </div>

                    <div className="mt-6 grid gap-6 lg:mt-8 lg:gap-8 xl:grid-cols-[1.72fr_0.94fr]">
                        <div className="min-w-0">
                            <FulfillmentQueue
                                recentOrders={data.recent_orders}
                                onUpdateStatus={handleUpdateStatus}
                                updatingOrderId={updatingOrderId}
                            />
                        </div>

                        <div className="grid gap-6 lg:gap-8">
                            <section className="warehouse-panel p-4 sm:p-6 lg:p-8">
                                <p className="wh-ui-label text-slate-400/80">
                                    Shift Summary
                                </p>
                                <div className="mt-6 space-y-5">
                                    <div className="warehouse-subtle-card p-4 sm:p-5">
                                        <p className="text-sm text-slate-400">Assigned queue</p>
                                        <p className="mt-2 text-3xl font-semibold tracking-tight text-white">
                                            {data.cards.total_orders_assigned || 0}
                                        </p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="warehouse-subtle-card p-4 sm:p-5">
                                            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Packed</p>
                                            <p className="mt-2 text-2xl font-semibold text-white">
                                                {data.cards.packed_orders || 0}
                                            </p>
                                        </div>
                                        <div className="warehouse-subtle-card p-4 sm:p-5">
                                            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Dispatched</p>
                                            <p className="mt-2 text-2xl font-semibold text-white">
                                                {data.cards.dispatched_orders || 0}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="rounded-[26px] border border-amber-400/14 bg-amber-400/8 px-5 py-5">
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-amber-300">
                                            Assigned partner
                                        </p>
                                        <p className="mt-2 text-base font-medium text-white">
                                            {warehouseUser?.owner_name || 'Warehouse Partner'}
                                        </p>
                                        <div className="mt-2 flex flex-col gap-1">
                                            <p className="text-[10px] font-bold tracking-[0.16em] text-amber-500/80 uppercase">
                                                Hub ID: #{warehouseUser?.store_id || warehouseUser?.id || '--'}
                                            </p>
                                            <p className="text-[10px] font-bold tracking-[0.16em] text-amber-500/80 uppercase">
                                                Partner ID: {warehouseUser?.partner_id || '------'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            <InventoryAlerts lowStockCount={data.cards.low_stock_alerts} />

                            <ScoreCards
                                acceptanceRate={data.performance_metrics.acceptance_rate}
                                ordersAccepted={data.performance_metrics.accepted_orders}
                                completedDispatches={data.performance_metrics.completed_dispatches}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default WarehouseDashboard
