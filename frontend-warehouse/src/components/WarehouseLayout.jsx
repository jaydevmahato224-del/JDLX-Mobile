import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom'
import { LayoutDashboard, Package, MapPin, LogOut, Bell, FileText, Activity, Warehouse, Menu, X, Users, ChevronDown, ChevronUp, CheckCheck, ShoppingBag, Truck } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE_URL } from '../config'

export default function WarehouseLayout() {
    const location = useLocation();
    const navigate = useNavigate();
    const user = useStore((state) => state.warehouseUser);
    const warehouseToken = useStore((state) => state.warehouseToken);
    const setWarehouseUser = useStore((state) => state.setWarehouseUser);
    const logout = useStore((state) => state.warehouseLogout);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isRiderMenuOpen, setIsRiderMenuOpen] = useState(false);
    const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [notificationsLoading, setNotificationsLoading] = useState(false);
    const notificationsPanelRef = useRef(null);

    const unreadCount = notifications.reduce((count, item) => count + (item.is_read ? 0 : 1), 0);

    const formatNotificationTime = (value) => {
        if (!value) return 'Just now';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return 'Just now';
        return parsed.toLocaleString();
    };

    const fetchWarehouseSession = useCallback(async () => {
        if (!warehouseToken) return;
        try {
            const response = await fetch(`${API_BASE_URL}/warehouse/session`, {
                headers: { Authorization: `Bearer ${warehouseToken}` },
            });
            if (response.status === 401 || response.status === 403) {
                logout();
                navigate('/warehouse/login', { replace: true });
                return;
            }
            if (!response.ok) return;
            const payload = await response.json();
            if (!payload?.user) return;
            setWarehouseUser(payload.user, warehouseToken);
        } catch (error) {
            console.error('Failed to sync warehouse session:', error);
        }
    }, [warehouseToken, logout, navigate, setWarehouseUser]);

    const fetchNotifications = useCallback(async () => {
        if (!warehouseToken) return;
        setNotificationsLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/warehouse/notifications?limit=30`, {
                headers: { Authorization: `Bearer ${warehouseToken}` },
            });
            if (response.status === 401 || response.status === 403) {
                logout();
                navigate('/warehouse/login', { replace: true });
                return;
            }
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload?.error || 'Failed to load notifications.');
            }
            setNotifications(Array.isArray(payload?.notifications) ? payload.notifications : []);
        } catch (error) {
            console.error('Failed to fetch warehouse notifications:', error);
        } finally {
            setNotificationsLoading(false);
        }
    }, [warehouseToken, logout, navigate]);

    const markNotificationRead = useCallback(async (notificationId) => {
        if (!warehouseToken || !notificationId) return;
        try {
            await fetch(`${API_BASE_URL}/warehouse/notifications/${notificationId}/read`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${warehouseToken}` },
            });
            setNotifications((prev) =>
                prev.map((entry) =>
                    entry.id === notificationId ? { ...entry, is_read: 1 } : entry
                )
            );
        } catch (error) {
            console.error('Failed to mark notification as read:', error);
        }
    }, [warehouseToken]);

    const markAllNotificationsRead = useCallback(async () => {
        if (!warehouseToken) return;
        try {
            await fetch(`${API_BASE_URL}/warehouse/notifications/read-all`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${warehouseToken}` },
            });
            setNotifications((prev) => prev.map((entry) => ({ ...entry, is_read: 1 })));
        } catch (error) {
            console.error('Failed to mark all notifications as read:', error);
        }
    }, [warehouseToken]);

    useEffect(() => {
        if (!warehouseToken) return;
        fetchWarehouseSession();
        fetchNotifications();
        const interval = setInterval(fetchNotifications, 45000);
        return () => clearInterval(interval);
    }, [warehouseToken, fetchWarehouseSession, fetchNotifications]);

    useEffect(() => {
        if (!isNotificationsOpen) return;
        const handleOutsideClick = (event) => {
            if (notificationsPanelRef.current && !notificationsPanelRef.current.contains(event.target)) {
                setIsNotificationsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [isNotificationsOpen]);

    const navLinks = [
        { path: '/warehouse/dashboard', icon: LayoutDashboard, label: 'Operations Hub' },
        { path: '/warehouse/orders', icon: ShoppingBag, label: 'Orders' },
        { path: '/warehouse/procurement', icon: Truck, label: 'Material Purchase' },
        { path: '/warehouse/inventory', icon: Package, label: 'Inventory' },
        { path: '/warehouse/analytics', icon: Activity, label: 'Analytics' },
        { 
            path: '/warehouse/manage-riders',
            label: 'Manage Riders', 
            icon: Users, 
            isOpen: isRiderMenuOpen,
            toggle: (e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsRiderMenuOpen(!isRiderMenuOpen);
            },
            children: [
                { path: '/warehouse/rider-requests', icon: FileText, label: 'Rider Requests' },
            ]
        },
    ];

    const handleLogout = () => {
        logout();
        navigate('/warehouse/login', { replace: true });
    };

    return (
        <div className="flex h-screen overflow-hidden bg-[#0f172a]">
            {/* Sidebar Overlay */}
            {isSidebarOpen && (
                <div 
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar Desktop & Mobile */}
            <aside className={`fixed inset-y-0 left-0 z-50 w-72 bg-[#0f172a] border-r border-white/5 transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:sticky top-0 h-screen flex flex-col ${isSidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}>
                <div className="flex items-center justify-between p-6 border-b border-white/5 h-20">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-inner">
                            <Warehouse className="w-5 h-5 text-slate-900" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-base font-black tracking-widest text-white uppercase">JDLX</span>
                            <span className="text-[10px] font-bold text-amber-500/80 uppercase tracking-[0.2em]">Warehouse</span>
                        </div>
                    </div>
                    <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 text-slate-400 hover:text-white">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <nav className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                    <p className="px-4 py-2 text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Core Engine</p>
                    {navLinks.map((link, idx) => {
                        const Icon = link.icon;
                        
                        if (link.children) {
                            return (
                                <div key={idx} className="space-y-1">
                                    <div className="flex items-center gap-1 group">
                                        <Link
                                            to={link.path}
                                            onClick={() => setIsSidebarOpen(false)}
                                            className={`flex-1 flex items-center gap-4 px-4 py-4 rounded-2xl transition-all duration-300 ${location.pathname === link.path ? 'bg-amber-400/10 text-amber-400 border border-amber-400/20' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}
                                        >
                                            <Icon className={`w-5 h-5 transition-transform duration-300 group-hover:scale-110 ${isRiderMenuOpen ? 'text-amber-400' : 'text-slate-500'}`} />
                                            <span className="text-sm font-bold tracking-tight">{link.label}</span>
                                        </Link>
                                        <button 
                                            onClick={link.toggle}
                                            className="p-3 text-slate-500 hover:text-white transition-colors"
                                        >
                                            {link.isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                        </button>
                                    </div>
                                    
                                    {link.isOpen && (
                                        <div className="pl-12 space-y-1 animate-in slide-in-from-top-2 duration-300">
                                            {link.children.map((child) => {
                                                const ChildIcon = child.icon;
                                                const isChildActive = location.pathname === child.path;
                                                return (
                                                    <Link
                                                        key={child.path}
                                                        to={child.path}
                                                        onClick={() => setIsSidebarOpen(false)}
                                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group ${isChildActive ? 'text-amber-400 font-bold' : 'text-slate-500 hover:text-slate-300'}`}
                                                    >
                                                        <ChildIcon size={14} className={isChildActive ? 'text-amber-400' : 'text-slate-600'} />
                                                        <span className="text-xs uppercase tracking-widest font-black">{child.label}</span>
                                                    </Link>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            )
                        }

                        const isActive = location.pathname === link.path;
                        return (
                            <Link
                                key={link.path}
                                to={link.path}
                                onClick={() => setIsSidebarOpen(false)}
                                className={`flex items-center gap-4 px-4 py-4 rounded-2xl transition-all duration-300 group ${isActive ? 'bg-amber-400/10 text-amber-400 border border-amber-400/20 shadow-[0_0_20px_rgba(245,158,11,0.05)]' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'}`}
                            >
                                <Icon className={`w-5 h-5 transition-transform duration-300 group-hover:scale-110 ${isActive ? 'text-amber-400' : 'text-slate-500'}`} />
                                <span className="text-sm font-bold tracking-tight">{link.label}</span>
                            </Link>
                        )
                    })}
                </nav>

                <div className="p-4 border-t border-white/5">
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-4 w-full px-4 py-4 rounded-2xl text-rose-400 hover:bg-rose-400/10 transition-all border border-transparent hover:border-rose-400/20"
                    >
                        <LogOut className="w-5 h-5" />
                        <span className="text-sm font-bold tracking-tight">System Logout</span>
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
                {/* Header */}
                <header className="h-20 bg-[#0f172a]/80 backdrop-blur-xl border-b border-white/5 px-6 flex items-center justify-between z-10 sticky top-0">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            className="lg:hidden p-2.5 bg-white/5 border border-white/10 rounded-xl text-slate-300"
                        >
                            <Menu className="w-6 h-6" />
                        </button>
                        <div className="hidden sm:block">
                            <h2 className="text-lg font-black text-white tracking-tight capitalize">
                                {location.pathname.split('/').pop() || 'Dashboard'}
                            </h2>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="relative" ref={notificationsPanelRef}>
                            <button
                                onClick={() => setIsNotificationsOpen((prev) => !prev)}
                                className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300 transition-all hover:border-amber-400/30 hover:text-amber-300"
                                aria-label="Open notifications"
                            >
                                <Bell className="h-5 w-5" />
                                {unreadCount > 0 ? (
                                    <span className="absolute -right-1 -top-1 min-w-[20px] rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white">
                                        {unreadCount > 9 ? '9+' : unreadCount}
                                    </span>
                                ) : null}
                            </button>

                            {isNotificationsOpen ? (
                                <div className="absolute right-0 top-14 z-30 w-[320px] rounded-2xl border border-white/10 bg-[#0b1224] p-4 shadow-2xl">
                                    <div className="mb-3 flex items-center justify-between">
                                        <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Notifications</p>
                                        <button
                                            onClick={markAllNotificationsRead}
                                            className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-300 transition-colors hover:border-amber-400/30 hover:text-amber-300"
                                        >
                                            <CheckCheck size={12} />
                                            Mark all
                                        </button>
                                    </div>

                                    <div className="max-h-80 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                                        {notificationsLoading ? (
                                            <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-4 text-xs text-slate-400">
                                                Loading notifications...
                                            </div>
                                        ) : notifications.length === 0 ? (
                                            <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-4 text-xs text-slate-400">
                                                No notifications yet.
                                            </div>
                                        ) : (
                                            notifications.map((item) => (
                                                <button
                                                    key={item.id}
                                                    onClick={() => markNotificationRead(item.id)}
                                                    className={`w-full rounded-xl border px-3 py-3 text-left transition-all ${
                                                        item.is_read
                                                            ? 'border-white/5 bg-white/5'
                                                            : 'border-amber-400/30 bg-amber-400/10'
                                                    }`}
                                                >
                                                    <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-300">
                                                        {item.title}
                                                    </p>
                                                    <p className="mt-1 text-xs leading-5 text-slate-300/90">
                                                        {item.message}
                                                    </p>
                                                    <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                                                        {formatNotificationTime(item.created_at)}
                                                    </p>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        <Link 
                            to="/warehouse/profile"
                            className="flex items-center gap-4 pl-6 border-l border-white/5 group transition-all"
                        >
                            <div className="text-right hidden sm:block group-hover:opacity-80 transition-opacity">
                                <div className="text-sm font-black text-white leading-tight">{user?.owner_name || 'Partner'}</div>
                                <div className="flex flex-col items-end gap-0.5 mt-1">
                                    <div className="text-[10px] font-bold text-amber-500/80 uppercase tracking-widest">{user?.partner_id ? `Partner ID: ${user.partner_id}` : 'Partner ID: 0000'}</div>
                                    <div className="text-[10px] font-bold text-amber-500/60 uppercase tracking-widest">{user?.store_id ? `Hub ID: #${user.store_id}` : (user?.id ? `Hub ID: #${user.id}` : '')}</div>
                                </div>
                            </div>
                            <div className="w-11 h-11 bg-amber-400/10 border border-amber-400/20 rounded-2xl flex items-center justify-center text-amber-400 font-black shadow-inner group-hover:scale-105 group-hover:bg-amber-400/20 transition-all duration-300">
                                {user?.owner_name?.charAt(0) || 'W'}
                            </div>
                        </Link>
                    </div>
                </header>

                {/* Content Area */}
                <main className="flex-1 w-full flex flex-col overflow-y-auto custom-scrollbar scroll-smooth">
                    <div className="flex-1 p-6 lg:p-10 max-w-[1600px] w-full mx-auto relative">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    )
}
