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
    Loader2,
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { apiClient } from '../../utils/apiClient'
import StatCards from './components/StatCards'
import FulfillmentQueue from './components/FulfillmentQueue'
import TerminalStatus from './components/TerminalStatus'
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
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState(EMPTY_DASHBOARD)
    const [actionError, setActionError] = useState('')
    const [updatingOrderId, setUpdatingOrderId] = useState(null)
    const [updatingTerminal, setUpdatingTerminal] = useState(false)

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

    const handleUpdateOperationsStatus = async (newStatus) => {
        if (!warehouseToken) return
        
        // --- Added Location Enforcement Logic ---
        if (newStatus === 'open') {
            setUpdatingTerminal(true);
            setActionError('');
            
            try {
                const position = await new Promise((resolve, reject) => {
                    if (!navigator.geolocation) {
                        reject(new Error('Geolocation is not supported by your browser.'));
                    }
                    
                    navigator.geolocation.getCurrentPosition(
                        (pos) => resolve(pos),
                        (err) => {
                            let msg = 'Location access is REQUIRED to open the terminal.';
                            if (err.code === 1) msg = 'PERMISSION DENIED: Please enable location services in your browser settings to open the store.';
                            else if (err.code === 2) msg = 'POSITION UNAVAILABLE: System could not verify your location.';
                            else if (err.code === 3) msg = 'TIMEOUT: Location verification timed out.';
                            reject(new Error(msg));
                        },
                        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
                    );
                });
                
                console.log('Location verified for opening:', position.coords.latitude, position.coords.longitude);
            } catch (err) {
                console.error('Location check failed:', err);
                setActionError(err.message);
                setUpdatingTerminal(false);
                return; // Stop here if location check fails
            }
        }
        // ------------------------------------------

        setUpdatingTerminal(true)
        setActionError('')
        try {
            await apiClient.patch('/warehouse/settings', { operations_status: newStatus })
            const updatedUser = { ...warehouseUser, operations_status: newStatus }
            setWarehouseUser(updatedUser, warehouseToken)
        } catch (err) {
            console.error('Failed to update terminal status:', err)
            setActionError(err.message)
        } finally {
            setUpdatingTerminal(false)
        }
    }

    const handleToggleQuickMode = async (enabled) => {
        if (!warehouseToken) return
        
        setUpdatingTerminal(true)
        setActionError('')
        try {
            await apiClient.patch('/warehouse/settings', { quick_mode_enabled: enabled ? 1 : 0 })
            const updatedUser = { ...warehouseUser, quick_mode_enabled: enabled ? 1 : 0 }
            setWarehouseUser(updatedUser, warehouseToken)
        } catch (err) {
            console.error('Failed to update quick mode status:', err)
            setActionError(err.message)
        } finally {
            setUpdatingTerminal(false)
        }
    }


    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <Loader2 className="w-10 h-10 text-amber-500 animate-spin mb-4" />
                <p className="text-slate-400 font-medium tracking-tight">Syncing Operations Hub...</p>
            </div>
        )
    }

    return (
        <div className="warehouse-page-content py-4 lg:py-8">
                    <div className="warehouse-main-content">
                        <div className="pb-12 pt-[var(--app-header-height)] lg:pb-14 lg:pt-4">
                            <div className="grid gap-8 xl:grid-cols-[1fr_360px]">
                                <section className="warehouse-panel p-6 sm:p-8">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <div className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 wh-ui-label text-amber-300">
                                            Operations Hub
                                        </div>
                                    </div>

                                    <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
                                        <div>
                                            <h1 className="max-w-4xl wh-ui-h1 text-white">
                                                {warehouseUser?.warehouse_name || 'Warehouse Dashboard'}
                                            </h1>
                                            <div className="flex items-center gap-3 mt-3">
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

                                        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-1">
                                            <div className="warehouse-subtle-card p-5">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                                                        <Radio size={18} />
                                                    </div>
                                                    <div>
                                                        <p className="wh-ui-label text-slate-400/80">
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

                                    <TerminalStatus
                                        operationsStatus={warehouseUser?.operations_status || 'open'}
                                        weatherStatus={warehouseUser?.weather_status || 'clear'}
                                        pincode={warehouseUser?.pincode}
                                        onToggleStatus={handleUpdateOperationsStatus}
                                        updatingStatus={updatingTerminal}
                                        quickModeEnabled={!!warehouseUser?.quick_mode_enabled}
                                        onToggleQuickMode={handleToggleQuickMode}
                                    />

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
                                    <section className="warehouse-panel p-6 sm:p-8">
                                        <p className="wh-ui-label text-slate-400/80">
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
