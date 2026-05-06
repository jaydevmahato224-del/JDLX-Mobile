import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Activity,
    LayoutDashboard,
    LogOut,
    MapPin,
    Menu,
    Package,
    Radio,
    User,
    X,
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import StatCards from './components/StatCards'
import FulfillmentQueue from './components/FulfillmentQueue'
import TerminalStatus from './components/TerminalStatus'
import InventoryAlerts from './components/InventoryAlerts'
import ScoreCards from './components/ScoreCards'
import PageLoader from '../../components/PageLoader'

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
    const { warehouseUser, warehouseToken, warehouseLogout } = useStore()
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState(EMPTY_DASHBOARD)
    const [actionError, setActionError] = useState('')
    const [updatingOrderId, setUpdatingOrderId] = useState(null)

    const fetchDashboardData = useCallback(async () => {
        if (!warehouseToken) return

        try {
            const response = await fetch(`${API_BASE_URL}/warehouse/dashboard`, {
                headers: {
                    Authorization: `Bearer ${warehouseToken}`,
                },
            })
            if (response.status === 401 || response.status === 403) {
                warehouseLogout()
                navigate('/warehouse/login', { replace: true })
                return
            }
            const result = await response.json()
            if (!response.ok) {
                throw new Error(result.error || 'Failed to load warehouse dashboard.')
            }
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
            const response = await fetch(`${API_BASE_URL}/warehouse/orders/${orderId}/status`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${warehouseToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ status }),
            })

            if (response.status === 401 || response.status === 403) {
                warehouseLogout()
                navigate('/warehouse/login', { replace: true })
                return
            }

            const result = await response.json()
            if (!response.ok) {
                throw new Error(result.error || 'Failed to update warehouse order.')
            }

            await fetchDashboardData()
        } catch (error) {
            console.error('Failed to update warehouse order:', error)
            setActionError(error.message || 'Failed to update warehouse order.')
        } finally {
            setUpdatingOrderId(null)
        }
    }

    if (loading) return <PageLoader />

    return (
        <div className="warehouse-page-content py-4 lg:py-8">


                    <div className="warehouse-main-content">
                        <div className="pb-12 pt-[var(--app-header-height)] lg:pb-14 lg:pt-4">
                            <div className="grid gap-8 xl:grid-cols-[1fr_360px]">
                                <section className="warehouse-panel p-6 sm:p-8">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <div className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 ui-label text-amber-300">
                                            Operations Hub
                                        </div>
                                    </div>

                                    <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
                                        <div>
                                            <h1 className="max-w-4xl ui-h1 text-white">
                                                {warehouseUser?.warehouse_name || 'Warehouse Dashboard'}
                                            </h1>
                                        </div>

                                        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-1">
                                            <div className="warehouse-subtle-card p-5">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                                                        <Radio size={18} />
                                                    </div>
                                                    <div>
                                                        <p className="ui-label text-slate-500">
                                                            Queue Status
                                                        </p>
                                                        <p className="mt-1 text-base font-bold text-white tracking-tight">Live feed active</p>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="warehouse-subtle-card rounded-[26px] p-5">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-400/10 text-blue-300">
                                                        <MapPin size={18} />
                                                    </div>
                                                    <div>
                                                        <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">
                                                            Active Zone
                                                        </p>
                                                        <p className="mt-1 text-base font-semibold text-white">
                                                            {warehouseUser?.pincode || 'N/A'}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                <section className="warehouse-panel p-6 sm:p-8">
                                    <p className="ui-label text-slate-500">
                                        Shift Summary
                                    </p>
                                    <div className="mt-6 space-y-5">
                                        <div className="warehouse-subtle-card rounded-[26px] p-5">
                                            <p className="text-sm text-slate-400">Assigned queue</p>
                                            <p className="mt-2 text-3xl font-semibold tracking-tight text-white">
                                                {data.cards.total_orders_assigned || 0}
                                            </p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="warehouse-subtle-card rounded-[24px] p-5">
                                                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Packed</p>
                                                <p className="mt-2 text-2xl font-semibold text-white">
                                                    {data.cards.packed_orders || 0}
                                                </p>
                                            </div>
                                            <div className="warehouse-subtle-card rounded-[24px] p-5">
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
                                        </div>
                                    </div>
                                </section>
                            </div>

                            {actionError ? (
                                <div className="mt-6 rounded-[24px] border border-rose-500/20 bg-rose-500/10 px-5 py-4 text-sm leading-6 text-rose-200">
                                    {actionError}
                                </div>
                            ) : null}

                            <div className="mt-8">
                                <StatCards
                                    totalOrdersAssigned={data.cards.total_orders_assigned}
                                    pendingOrders={data.cards.pending_orders}
                                    packedOrders={data.cards.packed_orders}
                                    dispatchedOrders={data.cards.dispatched_orders}
                                />
                            </div>

                            <div className="mt-8 grid gap-8 xl:grid-cols-[1.72fr_0.94fr]">
                                <div className="min-w-0">
                                    <FulfillmentQueue
                                        recentOrders={data.recent_orders}
                                        onUpdateStatus={handleUpdateStatus}
                                        updatingOrderId={updatingOrderId}
                                    />
                                </div>

                                <div className="grid gap-8">
                                    <TerminalStatus
                                        operationsStatus={warehouseUser?.operations_status || 'open'}
                                        weatherStatus={warehouseUser?.weather_status || 'clear'}
                                        pincode={warehouseUser?.pincode}
                                    />

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
