import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    AlertTriangle,
    CalendarDays,
    CloudRain,
    LayoutDashboard,
    ListFilter,
    MapPinned,
    Menu,
    Package,
    Plus,
    RefreshCw,
    Settings,
    ShieldCheck,
    Sun,
    Truck,
    UserCircle2,
    Warehouse,
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'

const WAREHOUSE_SESSION_URL = `${API_BASE_URL}/warehouse/session`
const WAREHOUSE_DASHBOARD_URL = `${API_BASE_URL}/warehouse/dashboard`
const WAREHOUSE_SETTINGS_URL = `${API_BASE_URL}/warehouse/settings`

const headerTabs = ['Dashboard', 'Inventory', 'Analytics', 'Nodes']

const sidebarItems = [
    { icon: LayoutDashboard, label: 'Dashboard', active: true },
    { icon: Warehouse, label: 'Inventory' },
    { icon: ListFilter, label: 'Analytics' },
    { icon: Settings, label: 'Settings' },
]

const weatherOptions = [
    { value: 'clear', label: 'Clear', icon: Sun },
    { value: 'rain', label: 'Rain', icon: CloudRain },
]

const statusOptions = [
    { value: 'open', label: 'Open' },
    { value: 'busy', label: 'Busy' },
    { value: 'closed', label: 'Closed' },
]

const mobileTabs = [
    { icon: LayoutDashboard, label: 'Status', active: true },
    { icon: Warehouse, label: 'Inventory' },
    { icon: ListFilter, label: 'Analytics' },
    { icon: Settings, label: 'Config' },
]

function MobileNavItem({ icon: Icon, label, active = false }) {
    return (
        <button className="flex h-full flex-col items-center justify-center gap-1 px-2">
            <span className={`flex h-10 w-10 items-center justify-center rounded-2xl transition ${active ? 'bg-amber-500 text-white shadow-[0_10px_24px_rgba(217,119,6,0.28)]' : 'bg-slate-100 text-slate-500'}`}>
                <Icon size={18} />
            </span>
            <span className={`text-[9px] font-semibold uppercase tracking-[0.18em] ${active ? 'text-amber-700' : 'text-slate-500'}`}>{label}</span>
        </button>
    )
}

function WarehouseDashboard() {
    const navigate = useNavigate()
    const warehouseUser = useStore((state) => state.warehouseUser)
    const warehouseToken = useStore((state) => state.warehouseToken)
    const setWarehouseUser = useStore((state) => state.setWarehouseUser)
    const warehouseLogout = useStore((state) => state.warehouseLogout)

    const [sessionData, setSessionData] = useState(null)
    const [dashboardData, setDashboardData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [savingAvailability, setSavingAvailability] = useState(false)
    const [error, setError] = useState('')
    const [isBottomNavVisible, setIsBottomNavVisible] = useState(true)
    const scrollContainerRef = useRef(null)
    const [availabilityForm, setAvailabilityForm] = useState({
        operations_status: 'open',
        weather_status: 'clear',
        service_radius_km: 4,
    })

    const warehouse = sessionData?.warehouse || warehouseUser
    const layoutOffsetStyle = {
        '--warehouse-header-height': '92px',
        '--warehouse-bottom-nav-height': '74px',
        '--warehouse-bottom-nav-gap': '16px',
        '--warehouse-bottom-nav-offset': 'calc(var(--warehouse-bottom-nav-height) + var(--warehouse-bottom-nav-gap) + env(safe-area-inset-bottom, 0px))',
    }

    useEffect(() => {
        if (!warehouseToken) {
            navigate('/warehouse/login', { replace: true })
        }
    }, [navigate, warehouseToken])

    useEffect(() => {
        if (!warehouse) {
            return
        }

        setAvailabilityForm({
            operations_status: warehouse.operations_status || 'open',
            weather_status: warehouse.weather_status || 'clear',
            service_radius_km: warehouse.service_radius_km || 4,
        })
    }, [warehouse])

    useEffect(() => {
        const scrollElement = scrollContainerRef.current
        if (!scrollElement) {
            return undefined
        }

        let oldScroll = scrollElement.scrollTop
        const onScroll = () => {
            const currentScroll = scrollElement.scrollTop
            setIsBottomNavVisible(currentScroll <= oldScroll || currentScroll < 40)
            oldScroll = currentScroll
        }

        scrollElement.addEventListener('scroll', onScroll, { passive: true })
        return () => scrollElement.removeEventListener('scroll', onScroll)
    }, [])

    useEffect(() => {
        if (!warehouseToken) {
            return undefined
        }

        const controller = new AbortController()

        const loadDashboard = async () => {
            setLoading(true)
            setError('')
            try {
                const headers = {
                    Authorization: `Bearer ${warehouseToken}`,
                }

                const [sessionRes, dashboardRes] = await Promise.all([
                    fetch(WAREHOUSE_SESSION_URL, { headers, signal: controller.signal }),
                    fetch(WAREHOUSE_DASHBOARD_URL, { headers, signal: controller.signal }),
                ])

                if (sessionRes.status === 401 || sessionRes.status === 403 || dashboardRes.status === 401 || dashboardRes.status === 403) {
                    warehouseLogout()
                    navigate('/warehouse/login?error=session_expired', { replace: true })
                    return
                }

                if (!sessionRes.ok) {
                    throw new Error('Warehouse session could not be loaded.')
                }

                const sessionJson = await sessionRes.json()
                setSessionData(sessionJson)
                if (sessionJson?.user) {
                    setWarehouseUser(sessionJson.user, warehouseToken)
                }

                if (!dashboardRes.ok) {
                    setDashboardData(null)
                    throw new Error('Warehouse dashboard could not be loaded.')
                }

                const dashboardJson = await dashboardRes.json()
                setDashboardData(dashboardJson)
            } catch (fetchError) {
                if (fetchError.name === 'AbortError') {
                    return
                }
                console.error(fetchError)
                setError(fetchError.message || 'Warehouse dashboard load failed.')
            } finally {
                setLoading(false)
            }
        }

        loadDashboard()
        return () => controller.abort()
    }, [navigate, setWarehouseUser, warehouseLogout, warehouseToken])

    const handleRefresh = async () => {
        if (!warehouseToken) {
            return
        }

        setRefreshing(true)
        setError('')
        try {
            const headers = {
                Authorization: `Bearer ${warehouseToken}`,
            }

            const [sessionRes, dashboardRes] = await Promise.all([
                fetch(WAREHOUSE_SESSION_URL, { headers }),
                fetch(WAREHOUSE_DASHBOARD_URL, { headers }),
            ])

            if (!sessionRes.ok || !dashboardRes.ok) {
                if (sessionRes.ok) {
                    const sessionJson = await sessionRes.json()
                    setSessionData(sessionJson)
                    if (sessionJson?.user) {
                        setWarehouseUser(sessionJson.user, warehouseToken)
                    }
                }
                throw new Error('Refresh failed.')
            }

            const [sessionJson, dashboardJson] = await Promise.all([
                sessionRes.json(),
                dashboardRes.json(),
            ])

            setSessionData(sessionJson)
            setDashboardData(dashboardJson)
            if (sessionJson?.user) {
                setWarehouseUser(sessionJson.user, warehouseToken)
            }
        } catch (refreshError) {
            console.error(refreshError)
            setError(refreshError.message || 'Refresh failed.')
        } finally {
            setRefreshing(false)
        }
    }

    const handleLogout = () => {
        warehouseLogout()
        navigate('/warehouse/login', { replace: true })
    }

    const handleAvailabilitySave = async () => {
        if (!warehouseToken) {
            return
        }

        setSavingAvailability(true)
        setError('')
        try {
            const response = await fetch(WAREHOUSE_SETTINGS_URL, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${warehouseToken}`,
                },
                body: JSON.stringify(availabilityForm),
            })

            const data = await response.json()
            if (!response.ok) {
                throw new Error(data.error || 'Availability settings could not be updated.')
            }

            await handleRefresh()
        } catch (saveError) {
            console.error(saveError)
            setError(saveError.message || 'Availability settings could not be updated.')
        } finally {
            setSavingAvailability(false)
        }
    }

    const handleDispatchAll = async (pincode) => {
        if (!pincode) {
            return
        }
        setRefreshing(true)
        try {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            await handleRefresh()
        } finally {
            setRefreshing(false)
        }
    }

    const cards = dashboardData?.cards || {}
    const performanceData = dashboardData?.performance_metrics?.performance_score || cards?.performance_score || 98.4
    const recentOrders = dashboardData?.recent_orders || []
    const inventorySummary = dashboardData?.inventory_summary || []

    const weatherLabel = availabilityForm.weather_status === 'rain' ? 'Rain Mode' : 'Clear Sky'
    const operationLabel = useMemo(
        () => statusOptions.find((option) => option.value === availabilityForm.operations_status)?.label || 'Open',
        [availabilityForm.operations_status],
    )

    const statCards = [
        {
            icon: Truck,
            accent: 'bg-amber-100 text-amber-700',
            delta: '+12.4%',
            deltaTone: 'text-emerald-600',
            label: 'Active Deliveries',
            value: Number(cards.total_orders_assigned || 0).toLocaleString(),
            progress: '58%',
            progressTone: 'bg-amber-600',
        },
        {
            icon: Warehouse,
            accent: 'bg-teal-100 text-teal-700',
            delta: '+3.2%',
            deltaTone: 'text-emerald-600',
            label: 'Inventory Flow',
            value: `${Number(cards.total_orders_unassigned || 0).toLocaleString()}`,
            progress: '42%',
            progressTone: 'bg-teal-700',
        },
        {
            icon: RefreshCw,
            accent: 'bg-cyan-100 text-cyan-700',
            delta: '-0.8%',
            deltaTone: 'text-rose-500',
            label: 'Avg. Fulfillment',
            value: `${Number(performanceData || 0).toFixed(1)}m`,
            progress: `${Math.max(12, Math.min(Number(performanceData || 0), 100))}%`,
            progressTone: 'bg-cyan-700',
        },
        {
            icon: MapPinned,
            accent: 'bg-stone-100 text-stone-700',
            delta: `+${inventorySummary.length || 0} Nodes`,
            deltaTone: 'text-emerald-600',
            label: 'Active Nodes',
            value: `${Math.max(warehouse?.service_radius_km || availabilityForm.service_radius_km || 4, 1) * 31}`,
            progress: '30%',
            progressTone: 'bg-stone-400',
        },
    ]

    const tableRows = recentOrders.slice(0, 4).map((order, index) => ({
        id: order.order_id || order.id || `JDLX-${8800 + index}`,
        subtitle: order.product_names || 'Warehouse Order',
        destination: order.delivery_address || order.customer_name || warehouse?.pincode || 'Node Dispatch',
        status: order.assignment_status || 'processing',
        priority: Math.min(3, Math.max(1, (index % 3) + 1)),
    }))

    const fallbackRows = [
        {
            id: 'JDLX-8821',
            subtitle: 'Electronic Components',
            destination: 'Seattle Metropolitan',
            status: 'in transit',
            priority: 3,
        },
        {
            id: 'JDLX-9012',
            subtitle: 'Cold Chain Storage',
            destination: 'Chicago Hub A4',
            status: 'delivered',
            priority: 2,
        },
        {
            id: 'JDLX-7762',
            subtitle: 'Bio-Medical Kit',
            destination: 'Austin Research Lab',
            status: 'processing',
            priority: 2,
        },
    ]

    const registryRows = tableRows.length > 0 ? tableRows : fallbackRows
    const statusBadgeTone = (status) => {
        const normalized = String(status).toLowerCase()
        if (normalized.includes('deliver')) return 'bg-emerald-100 text-emerald-700'
        if (normalized.includes('transit') || normalized.includes('dispatch')) return 'bg-amber-100 text-amber-700'
        return 'bg-blue-100 text-blue-700'
    }

    if (loading) {
        return (
            <div className="min-h-[100dvh] bg-[#f6f3ec]">
                <div className="mx-auto flex max-w-[1600px] animate-pulse gap-8 px-4 py-6 sm:px-6">
                    <div className="hidden w-[280px] shrink-0 rounded-[32px] bg-white lg:block" />
                    <div className="flex-1 space-y-6">
                        <div className="h-20 rounded-[32px] bg-white" />
                        <div className="h-40 rounded-[32px] bg-white" />
                        <div className="grid gap-5 xl:grid-cols-[1.6fr_0.75fr]">
                            <div className="h-[620px] rounded-[32px] bg-white" />
                            <div className="h-[620px] rounded-[32px] bg-white" />
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-[100dvh] bg-[#f6f3ec] text-slate-900" style={layoutOffsetStyle}>
            <style>{`
                .warehouse-soft-shell {
                    background:
                        radial-gradient(circle at top left, rgba(250, 204, 21, 0.08), transparent 20%),
                        linear-gradient(180deg, #faf9f6 0%, #f5f2ea 100%);
                }
                .warehouse-card {
                    background: rgba(255, 255, 255, 0.82);
                    border: 1px solid rgba(148, 163, 184, 0.15);
                    box-shadow: 0 18px 40px rgba(15, 23, 42, 0.06);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                }
                .warehouse-scroll::-webkit-scrollbar {
                    width: 7px;
                }
                .warehouse-scroll::-webkit-scrollbar-thumb {
                    background: rgba(148, 163, 184, 0.45);
                    border-radius: 999px;
                }
                .warehouse-scroll::-webkit-scrollbar-track {
                    background: transparent;
                }
            `}</style>
            <div className="warehouse-soft-shell mx-auto min-h-[100dvh] max-w-[1600px]">
                <aside className="warehouse-card fixed left-0 top-[var(--warehouse-header-height)] bottom-0 hidden w-[280px] rounded-none border-y-0 border-l-0 border-r px-7 py-8 2xl:flex 2xl:flex-col">
                    <div>
                        <p className="text-xs font-medium uppercase tracking-[0.28em] text-slate-400">Navigation</p>
                        <div className="mt-8 space-y-3">
                            {sidebarItems.map((item) => {
                                const Icon = item.icon
                                return (
                                    <button
                                        key={item.label}
                                        className={`flex w-full items-center gap-4 rounded-[20px] px-5 py-4 text-left transition ${item.active ? 'bg-amber-50 text-amber-700 shadow-[inset_0_0_0_1px_rgba(217,119,6,0.08)]' : 'text-slate-600 hover:bg-white'}`}
                                    >
                                        <Icon size={22} />
                                        <span className="text-[18px] font-medium">{item.label}</span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    <div className="warehouse-card mt-auto w-full rounded-[28px] p-6">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">System Status</p>
                        <div className="mt-6 flex items-center gap-3 text-[15px] text-slate-800">
                            <span className="h-3 w-3 rounded-full bg-emerald-500" />
                            <span>All Nodes Active</span>
                        </div>
                        <button
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className="mt-6 flex h-12 w-full items-center justify-center rounded-2xl bg-slate-800 px-4 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:opacity-60"
                        >
                            {refreshing ? 'Refreshing...' : 'View Logs'}
                        </button>
                    </div>
                </aside>

                <div className="flex min-h-[100dvh] flex-col 2xl:pl-[280px]">
                    <header className="fixed inset-x-0 top-0 z-[110] bg-[#faf9f6]/92 shadow-[0_1px_0_rgba(148,163,184,0.12)] backdrop-blur-xl">
                        <div className="mx-auto flex h-[var(--warehouse-header-height)] max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
                            <div className="flex items-center gap-4">
                                <button className="flex h-11 w-11 items-center justify-center rounded-2xl text-amber-700 transition hover:bg-amber-50">
                                    <Menu size={24} />
                                </button>
                                <div className="text-[24px] font-black tracking-tight text-slate-900">JDLXMOBILE</div>
                            </div>

                            <nav className="hidden items-center gap-10 xl:flex">
                                {headerTabs.map((tab, index) => (
                                    <button
                                        key={tab}
                                        className={`text-[17px] font-medium transition ${index === 0 ? 'text-amber-700' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        {tab}
                                    </button>
                                ))}
                            </nav>

                            <div className="flex items-center gap-3">
                                <div className="hidden text-right md:block">
                                    <div className="text-[18px] font-semibold text-slate-900">{warehouse?.owner_name || 'Alex Rivera'}</div>
                                    <div className="text-[12px] font-medium uppercase tracking-[0.18em] text-slate-400">Fleet Manager</div>
                                </div>
                                <button
                                    onClick={handleLogout}
                                    className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-amber-500 bg-white shadow-[0_12px_24px_rgba(245,158,11,0.18)]"
                                    aria-label="Logout"
                                >
                                    <UserCircle2 size={28} className="text-slate-700" />
                                </button>
                            </div>
                        </div>
                    </header>

                    <main
                        ref={scrollContainerRef}
                        className="warehouse-scroll flex-1 overflow-y-auto overflow-x-hidden pt-[calc(var(--warehouse-header-height)+10px)] pb-[var(--warehouse-bottom-nav-offset)]"
                    >
                        <div className="mx-auto w-full max-w-[1280px] px-5 py-8 sm:px-8">
                            {error ? (
                                <div className="mb-6 rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-medium text-rose-700">
                                    {error}
                                </div>
                            ) : null}

                            <section className="grid gap-6 xl:grid-cols-[1fr_auto] xl:items-start">
                                <div>
                                    <h1 className="text-4xl font-black tracking-tight text-slate-950 sm:text-6xl">Operations Hub</h1>
                                    <p className="mt-3 max-w-2xl text-lg text-teal-900/80 sm:text-[20px]">
                                        Real-time logistics monitoring and node distribution.
                                    </p>
                                </div>

                                <div className="flex flex-col gap-3 sm:flex-row">
                                    <button className="warehouse-card flex h-16 items-center gap-3 rounded-full px-8 text-lg font-medium text-slate-900">
                                        <CalendarDays size={20} />
                                        Oct 24, 2023
                                    </button>
                                    <button
                                        onClick={() => handleDispatchAll(warehouse?.pincode)}
                                        disabled={refreshing}
                                        className="flex h-16 items-center gap-3 rounded-full bg-gradient-to-r from-amber-500 to-yellow-400 px-8 text-lg font-medium text-slate-950 shadow-[0_18px_30px_rgba(245,158,11,0.26)] transition hover:scale-[1.01] disabled:opacity-60"
                                    >
                                        <Plus size={20} />
                                        {refreshing ? 'Dispatching...' : 'New Dispatch'}
                                    </button>
                                </div>
                            </section>

                            <section className="mt-8 grid items-stretch gap-5 md:grid-cols-2 2xl:grid-cols-4">
                                {statCards.map((card) => {
                                    const Icon = card.icon
                                    return (
                                        <div key={card.label} className="warehouse-card flex min-h-[220px] flex-col rounded-[28px] p-7">
                                            <div className="flex items-start justify-between gap-4">
                                                <span className={`flex h-16 w-16 items-center justify-center rounded-[20px] ${card.accent}`}>
                                                    <Icon size={28} />
                                                </span>
                                                <span className={`text-[16px] font-semibold ${card.deltaTone}`}>{card.delta}</span>
                                            </div>
                                            <div className="mt-7 flex-1">
                                                <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-slate-500">{card.label}</p>
                                                <div className="mt-3 break-words text-4xl font-black leading-none tracking-tight text-slate-950 xl:text-[3.1rem]">{card.value}</div>
                                            </div>
                                            <div className="mt-8 h-1.5 rounded-full bg-slate-200">
                                                <div className={`h-full rounded-full ${card.progressTone}`} style={{ width: card.progress }} />
                                            </div>
                                        </div>
                                    )
                                })}
                            </section>

                            <section className="mt-10 grid items-start gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.78fr)]">
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between gap-4">
                                        <h2 className="text-3xl font-black tracking-tight text-slate-950">Fulfillment Queue</h2>
                                        <button
                                            onClick={handleRefresh}
                                            disabled={refreshing}
                                            className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700 transition hover:text-amber-800 disabled:opacity-60"
                                        >
                                            {refreshing ? 'Refreshing Registry' : 'View Full Registry'}
                                        </button>
                                    </div>

                                    <div className="warehouse-card overflow-hidden rounded-[36px]">
                                        <div className="grid grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,0.8fr)_120px] gap-4 border-b border-slate-200/80 px-8 py-6 text-xs font-semibold uppercase tracking-[0.24em] text-teal-900/80 xl:px-10">
                                            <span>Order ID</span>
                                            <span>Destination</span>
                                            <span>Status</span>
                                            <span>Priority</span>
                                        </div>

                                        <div>
                                            {registryRows.map((row, index) => (
                                                <div
                                                    key={`${row.id}-${index}`}
                                                    className="grid grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,0.8fr)_120px] gap-4 border-b border-slate-100 px-8 py-8 last:border-b-0 xl:px-10"
                                                >
                                                    <div className="min-w-0">
                                                        <div className="truncate text-[20px] font-black tracking-tight text-slate-950">#{row.id}</div>
                                                        <div className="mt-2 line-clamp-2 text-[15px] text-slate-400">{row.subtitle}</div>
                                                    </div>
                                                    <div className="min-w-0 self-center text-[17px] leading-8 text-slate-800">
                                                        <div className="line-clamp-2 break-words">{row.destination}</div>
                                                    </div>
                                                    <div className="self-center">
                                                        <span className={`inline-flex max-w-full rounded-full px-4 py-2 text-sm font-semibold uppercase tracking-[0.18em] ${statusBadgeTone(row.status)}`}>
                                                            {String(row.status).replace(/_/g, ' ')}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 self-center justify-start">
                                                        {[1, 2, 3].map((dot) => (
                                                            <span
                                                                key={dot}
                                                                className={`h-3 w-3 rounded-full ${dot <= row.priority ? 'bg-amber-700' : 'bg-slate-200'}`}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    <div className="flex items-center justify-between gap-4">
                                        <h2 className="text-3xl font-black tracking-tight text-slate-950">Node Distribution</h2>
                                        <button className="flex h-12 w-12 items-center justify-center rounded-2xl text-teal-900 transition hover:bg-white">
                                            <ListFilter size={22} />
                                        </button>
                                    </div>

                                    <div className="warehouse-card overflow-hidden rounded-[36px] p-5">
                                        <div className="relative overflow-hidden rounded-[32px] bg-[#bdb9b1]">
                                            <div className="absolute inset-0 bg-gradient-to-b from-white/25 to-slate-900/12" />
                                            <img
                                                src="/map_bg.png"
                                                alt="Node distribution map"
                                                className="h-[520px] w-full object-cover grayscale opacity-45"
                                            />
                                            <span className="absolute right-[20%] top-[24%] h-5 w-5 rounded-full bg-amber-600 shadow-[0_0_0_10px_rgba(217,119,6,0.12)]" />
                                            <span className="absolute left-[56%] top-[65%] h-7 w-7 rounded-full bg-amber-700 shadow-[0_0_0_12px_rgba(217,119,6,0.12)]" />
                                            <span className="absolute right-[30%] top-[50%] h-4 w-4 rounded-full bg-amber-700 shadow-[0_0_0_8px_rgba(217,119,6,0.12)]" />

                                            <div className="absolute inset-x-4 bottom-4 rounded-[24px] bg-white/88 px-5 py-5 backdrop-blur-xl">
                                                <div className="flex items-end justify-between gap-4">
                                                    <div>
                                                        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Top Region</div>
                                                        <div className="mt-2 text-[18px] font-semibold text-slate-950">Pacific Northwest</div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">Load</div>
                                                        <div className="mt-2 text-[18px] font-semibold text-slate-950">92%</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </section>
                            <section className="mt-6 grid items-stretch gap-6 xl:grid-cols-[minmax(0,1.02fr)_minmax(0,1.15fr)_minmax(320px,0.88fr)]">
                                <div className="warehouse-card rounded-[30px] p-6">
                                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Availability</p>
                                    <div className="mt-5 grid gap-4">
                                        <div>
                                            <div className="mb-3 text-sm font-semibold text-slate-700">Operations Status</div>
                                            <div className="flex flex-wrap gap-2">
                                                {statusOptions.map((option) => (
                                                    <button
                                                        key={option.value}
                                                        type="button"
                                                        onClick={() => setAvailabilityForm((current) => ({ ...current, operations_status: option.value }))}
                                                        className={`rounded-full px-4 py-2 text-sm font-semibold transition ${availabilityForm.operations_status === option.value ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                                    >
                                                        {option.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div>
                                            <div className="mb-3 text-sm font-semibold text-slate-700">Weather Mode</div>
                                            <div className="flex flex-wrap gap-2">
                                                {weatherOptions.map((option) => {
                                                    const Icon = option.icon
                                                    const active = availabilityForm.weather_status === option.value
                                                    return (
                                                        <button
                                                            key={option.value}
                                                            type="button"
                                                            onClick={() => setAvailabilityForm((current) => ({ ...current, weather_status: option.value }))}
                                                            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${active ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                                        >
                                                            <Icon size={16} />
                                                            {option.label}
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        </div>

                                        <div>
                                            <div className="mb-3 flex items-center justify-between gap-3">
                                                <span className="text-sm font-semibold text-slate-700">Service Radius</span>
                                                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">
                                                    {availabilityForm.service_radius_km} KM
                                                </span>
                                            </div>
                                            <input
                                                type="range"
                                                min="1"
                                                max="15"
                                                step="1"
                                                value={availabilityForm.service_radius_km}
                                                onChange={(event) => setAvailabilityForm((current) => ({ ...current, service_radius_km: Number(event.target.value) }))}
                                                className="w-full accent-amber-600"
                                            />
                                        </div>

                                        <button
                                            onClick={handleAvailabilitySave}
                                            disabled={savingAvailability}
                                            className="mt-2 flex h-12 items-center justify-center rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-950 disabled:opacity-60"
                                        >
                                            {savingAvailability ? 'Saving Availability...' : 'Save Availability'}
                                        </button>
                                    </div>
                                </div>

                                <div className="warehouse-card rounded-[30px] p-6">
                                    <div className="flex items-center justify-between gap-4">
                                        <div>
                                            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">System Status</p>
                                            <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-950">{operationLabel}</h3>
                                        </div>
                                        <span className="rounded-full bg-emerald-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                                            {weatherLabel}
                                        </span>
                                    </div>
                                    <div className="mt-6 grid gap-4 md:grid-cols-3">
                                        <div className="rounded-[22px] bg-amber-50 p-4">
                                            <div className="flex items-center gap-3">
                                                <Truck size={20} className="text-amber-700" />
                                                <div>
                                                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Packed Orders</div>
                                                    <div className="mt-1 text-2xl font-black text-slate-950">{cards.packed_orders || 0}</div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="rounded-[22px] bg-teal-50 p-4">
                                            <div className="flex items-center gap-3">
                                                <ShieldCheck size={20} className="text-teal-700" />
                                                <div>
                                                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Performance</div>
                                                    <div className="mt-1 text-2xl font-black text-slate-950">{performanceData}%</div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="rounded-[22px] bg-slate-100 p-4">
                                            <div className="flex items-center gap-3">
                                                <AlertTriangle size={20} className="text-slate-700" />
                                                <div>
                                                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Alerts</div>
                                                    <div className="mt-1 text-2xl font-black text-slate-950">{inventorySummary.length}</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="warehouse-card rounded-[30px] p-6">
                                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Dispatch Actions</p>
                                    <div className="mt-5 grid gap-3">
                                        <button
                                            onClick={() => handleDispatchAll(warehouse?.pincode)}
                                            disabled={refreshing}
                                            className="flex h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-400 px-4 text-sm font-semibold text-slate-950 transition hover:scale-[1.01] disabled:opacity-60"
                                        >
                                            {refreshing ? 'Dispatching...' : 'Dispatch Units'}
                                        </button>
                                        <button
                                            onClick={handleRefresh}
                                            disabled={refreshing}
                                            className="flex h-12 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-60"
                                        >
                                            {refreshing ? 'Refreshing...' : 'Refresh Dashboard'}
                                        </button>
                                        <div className="rounded-[22px] bg-slate-50 p-4 text-sm text-slate-600">
                                            Active hub <span className="font-semibold text-slate-900">{warehouse?.pincode || '832108'}</span> with radius <span className="font-semibold text-slate-900">{availabilityForm.service_radius_km} km</span>.
                                        </div>
                                    </div>
                                </div>
                            </section>
                        </div>
                    </main>

                    <nav
                        className={`fixed bottom-0 left-0 z-[140] w-full px-4 transition-transform duration-300 lg:hidden ${isBottomNavVisible ? 'translate-y-0' : 'translate-y-full'}`}
                        style={{ bottom: 'calc(var(--warehouse-bottom-nav-gap) + env(safe-area-inset-bottom, 0px))' }}
                    >
                        <div className="mx-auto flex h-[var(--warehouse-bottom-nav-height)] max-w-md items-center justify-between rounded-[28px] border border-slate-200 bg-white/95 px-3 shadow-[0_18px_40px_rgba(15,23,42,0.12)] backdrop-blur-xl">
                            {mobileTabs.map((item) => (
                                <MobileNavItem key={item.label} icon={item.icon} label={item.label} active={item.active} />
                            ))}
                        </div>
                    </nav>
                </div>
            </div>
        </div>
    )
}

export default WarehouseDashboard
