import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, ShoppingBag, Package, MapPin, Search, AlertCircle, Settings, Users, ArrowLeft, LogOut, Bell, FileText, Database, Shield, RefreshCcw, Activity, Brain, Warehouse, Truck, Server, MessageSquare, FolderTree, Smartphone } from 'lucide-react'

import { useStore } from '../store/useStore'
import { useState } from 'react'
import adminLogo from '../assets/admin-logo.svg'
import NotificationBell from './NotificationBell'

function AdminLayout({ children }) {
    const location = useLocation();
    const navigate = useNavigate();
    const user = useStore((state) => state.adminUser);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const navLinks = [
        { path: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard', allowedRoles: ['super_admin', 'admin', 'manager', 'inventory_admin', 'delivery_admin', 'support_admin'] },
        { path: '/admin/banners', icon: LayoutDashboard, label: 'Banner Manager', allowedRoles: ['super_admin', 'admin', 'manager'], extraStyle: 'text-amber-500 font-bold' },
        { path: '/admin/system-health', icon: Activity, label: 'System Health', allowedRoles: ['super_admin'] },
        { path: '/admin/server-control', icon: Server, label: 'Server Control', allowedRoles: ['super_admin'], extraStyle: 'text-blue-500 font-bold' },

        { path: '/admin/orders', icon: ShoppingBag, label: 'Orders', allowedRoles: ['super_admin', 'admin', 'manager', 'delivery_admin'] },
        { path: '/admin/notifications', icon: Bell, label: 'Notifications', allowedRoles: ['super_admin', 'admin', 'manager'], extraStyle: 'text-amber-500 font-bold' },
        { path: '/admin/reviews', icon: MessageSquare, label: 'Customer Reviews', allowedRoles: ['super_admin', 'admin', 'support_admin'], extraStyle: 'text-emerald-500 font-bold' },
        { path: '/admin/settings', icon: Settings, label: 'System Settings', allowedRoles: ['super_admin', 'admin'] },
        { path: '/admin/intelligence', icon: Brain, label: 'Intelligence', allowedRoles: ['super_admin', 'admin', 'manager', 'inventory_admin'], extraStyle: 'text-purple-400 font-black tracking-wide' },
        { path: '/admin/users', icon: Users, label: 'Users', allowedRoles: ['super_admin', 'admin', 'manager'] },
        { path: '/admin/inventory', icon: Package, label: 'Inventory', allowedRoles: ['super_admin', 'admin', 'inventory_admin'] },
        { path: '/admin/products', icon: ShoppingBag, label: 'Products', allowedRoles: ['super_admin', 'admin', 'inventory_admin'] },
        { path: '/admin/categories', icon: FolderTree, label: 'Categories', allowedRoles: ['super_admin', 'admin', 'inventory_admin'] },
        { path: '/admin/device-models', icon: Smartphone, label: 'Device Models', allowedRoles: ['super_admin', 'admin', 'inventory_admin'] },
        { path: '/admin/delivery-applications', icon: Truck, label: 'Manage Delivery', allowedRoles: ['super_admin', 'admin', 'delivery_admin'] },
        { path: '/admin/stores', icon: MapPin, label: 'Dark Stores', allowedRoles: ['super_admin', 'admin'] },
        { path: '/admin/warehouse-applications', icon: Warehouse, label: 'Warehouse Requests', allowedRoles: ['super_admin', 'admin', 'manager'] },
        { path: '/admin/restocking', icon: RefreshCcw, label: 'Restocking', allowedRoles: ['super_admin', 'admin', 'inventory_admin'] },
        { path: '/admin/refunds', icon: AlertCircle, label: 'Refunds', allowedRoles: ['super_admin', 'admin', 'support_admin'] },
        { path: '/admin/admins', icon: Users, label: 'Manage Admins', allowedRoles: ['super_admin'] },
        { path: '/admin/permissions', icon: Shield, label: 'Permissions', allowedRoles: ['super_admin'] },
        { path: '/admin/activity-logs', icon: FileText, label: 'Activity Logs', allowedRoles: ['super_admin', 'admin'] },
        { path: '/admin/audit-logs', icon: FileText, label: 'Audit Logs', allowedRoles: ['super_admin'] },
        { path: '/admin/backups', icon: Database, label: 'Backups', allowedRoles: ['super_admin'] },
        { path: '/admin/recovery', icon: RefreshCcw, label: 'Data Recovery', extraStyle: 'text-red-600 bg-red-50', allowedRoles: ['super_admin'] },
    ];

    const canGoBack = location.pathname !== '/admin/dashboard' && location.pathname !== '/admin';

    const handleBack = () => {
        if (window.history.length > 1) {
            navigate(-1);
            return;
        }
        navigate('/admin/dashboard');
    };

    return (
        <div className="flex h-screen overflow-hidden bg-gray-50/50">
            {/* Desktop Sidebar (Unified Pattern) */}
            <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-white transform transition-transform duration-300 ease-in-out md:translate-x-0 md:static flex flex-col ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="flex items-center justify-between p-4 border-b border-slate-700 h-[var(--app-header-height)]">
                    <Link to="/admin" className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
                        <img src={adminLogo} alt="Logo" className="w-8 h-8 rounded-md bg-white/10 p-1" />
                        <span>JDLX Admin Panel</span>
                    </Link>
                    <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-gray-400 hover:text-white">
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto py-4 px-3 space-y-1 custom-scrollbar">
                    {navLinks.map((link) => {
                        if (link.allowedRoles && !link.allowedRoles.includes((user?.role || '').toLowerCase())) {
                            return null;
                        }

                        const Icon = link.icon;
                        const isActive = location.pathname.startsWith(link.path);
                        return (
                            <Link
                                key={link.path}
                                to={link.path}
                                onClick={() => setIsSidebarOpen(false)}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm font-medium ${isActive ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-slate-300 hover:bg-slate-800 hover:text-white'} ${link.extraStyle ? link.extraStyle : ''}`}
                            >
                                <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                                {link.label}
                            </Link>
                        )
                    })}
                </div>
            </aside>

            {/* Flexible Content Column */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
                {/* Mobile overlay */}
                {isSidebarOpen && (
                    <div
                        className="fixed inset-0 bg-black/50 z-40 md:hidden"
                        onClick={() => setIsSidebarOpen(false)}
                    />
                )}

                {/* Admin Header (Sticky Sibling) */}
                <header className="bg-white/80 backdrop-blur-md border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10 sticky top-0 h-[var(--app-header-height)]">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            className="md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                        >
                            <LayoutDashboard className="w-5 h-5" />
                        </button>

                        {canGoBack && (
                            <button
                                onClick={handleBack}
                                className="hidden md:flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <ArrowLeft className="w-4 h-4" /> Back
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-4">
                        <NotificationBell />
                        <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
                            <div className="flex items-center gap-2">
                                <div className="text-right hidden sm:block">
                                    <div className="text-sm font-semibold text-gray-900">{user?.name || 'Admin'}</div>
                                    <div className="text-xs text-gray-500 capitalize">{user?.role || 'Administrator'}</div>
                                </div>
                                {user?.profile_image ? (
                                    <img src={user.profile_image} className="w-9 h-9 rounded-full object-cover border border-gray-200" alt="Admin" />
                                ) : (
                                    <div className="w-9 h-9 bg-primary/10 rounded-full flex items-center justify-center text-primary font-bold">
                                        {user?.name?.charAt(0) || 'A'}
                                    </div>
                                )}
                            </div>

                            <button
                                onClick={() => {
                                    useStore.getState().adminLogout();
                                    navigate('/admin/login');
                                }}
                                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors ml-2"
                                title="Admin Logout"
                            >
                                <LogOut className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </header>

                {/* Main Content Area (Scroll Container) */}
                <main className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6 bg-gray-50/20">
                    {/* Mobile Back Button inline fallback */}
                    {canGoBack && (
                        <button
                            onClick={handleBack}
                            className="md:hidden mb-4 flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-gray-200 shadow-sm text-sm font-medium text-gray-700"
                        >
                            <ArrowLeft className="w-4 h-4" /> Back
                        </button>
                    )}

                    <div className="max-w-7xl mx-auto w-full">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    )
}

export default AdminLayout
