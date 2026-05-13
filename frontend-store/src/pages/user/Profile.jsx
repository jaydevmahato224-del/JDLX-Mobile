import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import { ShoppingBag, ChevronRight, User, Mail, Package, MapPin, Settings, Heart, Wallet, Bell, Lock, HelpCircle, Gift, LogOut, Sun, Moon, Info, FileText, Download, MessageSquare, MessageCircle, ClipboardList, RotateCcw } from 'lucide-react'

import { usePWAInstall } from '../../hooks/usePWAInstall'
import toast from 'react-hot-toast'
import { API_BASE_URL, resolveMediaUrl } from '../../config'

function Profile() {
    const navigate = useNavigate();
    const user = useStore(state => state.user);
    const theme = useStore(state => state.theme);
    const toggleTheme = useStore(state => state.toggleTheme);
    const token = useStore.getState().token;
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [imageFailed, setImageFailed] = useState(false);
    const { isInstallable, isInstalled, handleInstallClick } = usePWAInstall();

    useEffect(() => {
        if (!user) {
            navigate('/login');
            return;
        }

        const fetchOrders = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/user/orders`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setOrders(data);
                } else {
                    setError('Failed to load orders');
                }
            } catch (err) {
                console.error('Failed to fetch orders:', err);
                setError('Connection error while loading orders');
            } finally {
                setLoading(false);
            }
        };

        fetchOrders();
    }, [user, navigate, token]);

    if (!user) return null;
    const profileImageUrl = imageFailed ? '' : resolveMediaUrl(user.profile_image);

    const navigationItems = [
        { icon: Settings, label: 'Settings', path: '/profile/settings', color: 'text-slate-500', bg: 'bg-slate-500/10' },
        { icon: ShoppingBag, label: 'My Orders', path: '/profile/orders', color: 'text-purple-500', bg: 'bg-purple-500/10' },
        { icon: MapPin, label: 'Addresses', path: '/profile/addresses', color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
        { icon: Wallet, label: 'Wallet', path: '/profile/wallet', color: 'text-blue-500', bg: 'bg-blue-500/10' },
        { icon: Heart, label: 'Wishlist', path: '/profile/wishlist', color: 'text-rose-500', bg: 'bg-rose-500/10' },
        { icon: Bell, label: 'Alerts', path: '/profile/notifications', color: 'text-amber-500', bg: 'bg-amber-500/10' },
        { icon: Lock, label: 'Security', path: '/profile/security', color: 'text-slate-500', bg: 'bg-slate-500/10' },
        { icon: Gift, label: 'Coupons', path: '/profile/coupons', color: 'text-pink-500', bg: 'bg-pink-500/10' },
        { icon: Info, label: 'About Us', path: '/profile/about-site', color: 'text-primary-500', bg: 'bg-primary-500/10' },
        { icon: FileText, label: 'Terms', path: '/profile/terms', color: 'text-slate-700', bg: 'bg-slate-700/10' },
        { icon: HelpCircle, label: 'Support', path: '/profile/support', color: 'text-cyan-500', bg: 'bg-cyan-500/10' },
        { icon: MessageSquare, label: 'Meri complaints', path: '/my-requests', color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
        { icon: MessageCircle, label: 'Support tickets', path: '/profile/support', color: 'text-amber-600', bg: 'bg-amber-600/10' },
        { icon: ClipboardList, label: 'Order reports', path: '/profile/my-reports', color: 'text-violet-500', bg: 'bg-violet-500/10' },
        { icon: RotateCcw, label: 'My refunds', path: '/profile/my-refunds', color: 'text-emerald-600', bg: 'bg-emerald-600/10' },
        { 
            icon: Download, 
            label: 'Download App', 
            onClick: () => {
                console.log('Download App Clicked. Status:', { isInstalled, isInstallable });
                if (isInstalled) {
                    toast.success('JDLX Mobile is already installed!', {
                        icon: '🚀',
                        style: { borderRadius: '16px', background: 'var(--color-surface-high)', color: 'var(--color-on-surface)', fontWeight: 'bold' }
                    });
                } else if (isInstallable) {
                    handleInstallClick();
                } else {
                    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
                    if (isIOS) {
                        toast('Tap the "Share" icon and then "Add to Home Screen" to install JDLX.', {
                            duration: 6000,
                            icon: '📲',
                            style: { borderRadius: '16px', background: 'var(--color-surface-high)', color: 'var(--color-on-surface)', fontWeight: 'bold' }
                        });
                    } else {
                        toast('To install, use Chrome/Edge and look for the "Install App" option in the browser menu.', {
                            duration: 5000,
                            icon: 'ℹ️',
                            style: { borderRadius: '16px', background: 'var(--color-surface-high)', color: 'var(--color-on-surface)', fontWeight: 'bold' }
                        });
                    }
                }
            }, 
            color: 'text-primary-600', 
            bg: 'bg-primary-600/10' 
        },
    ];

    return (
        <div className="container-standard py-6 space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <header className="flex items-center justify-between px-2">
                <h1 className="text-3xl font-black text-[var(--color-on-surface)] tracking-tighter" style={{ fontFamily: 'Manrope, sans-serif' }}>Account</h1>
                <button 
                    onClick={toggleTheme}
                    className="glass-icon-btn p-3 rounded-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-lg border border-[var(--color-surface-high)]"
                    aria-label="Toggle Theme"
                >
                    {theme === 'light' ? <Moon className="w-5 h-5 text-primary" /> : <Sun className="w-5 h-5 text-amber-400" />}
                </button>
            </header>

            {/* User Profile Card */}
            <div className="glass-card p-8 flex flex-col sm:flex-row items-center gap-6 relative overflow-hidden group shadow-2xl">
                <div className="absolute top-0 right-0 p-12 opacity-5 group-hover:opacity-10 transition-opacity">
                    <User className="w-32 h-32 text-primary" />
                </div>
                
                <div className="relative">
                    <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full scale-125" />
                    {profileImageUrl ? (
                        <img
                            src={profileImageUrl}
                            alt={user.name}
                            className="w-24 h-24 rounded-[32px] border-4 border-white/50 shadow-xl object-cover relative z-10"
                            onError={() => setImageFailed(true)}
                        />
                    ) : (
                        <div className="w-24 h-24 rounded-[32px] bg-primary flex items-center justify-center text-white shadow-xl relative z-10">
                            <User className="w-10 h-10" />
                        </div>
                    )}
                </div>

                <div className="text-center sm:text-left space-y-1 relative z-10">
                    <h2 className="text-2xl font-black tracking-tight text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>
                        {user.name}
                    </h2>
                    <p className="text-sm font-medium text-[var(--color-on-surface-variant)] opacity-70 flex items-center justify-center sm:justify-start gap-2">
                        <Mail className="w-3.5 h-3.5" />
                        {user.email}
                    </p>
                    {(user.about || '').trim() && (
                        <p className="text-[12px] font-medium text-[var(--color-on-surface-variant)] opacity-70 pt-2 max-w-xl">
                            {(user.about || '').trim()}
                        </p>
                    )}
                    <div className="pt-3 flex flex-wrap gap-2 justify-center sm:justify-start">
                        <span className="px-3 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-black uppercase tracking-widest border border-primary/10">
                            VIP Customer
                        </span>
                        <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-black uppercase tracking-widest border border-emerald-500/10">
                            Prepaid Active
                        </span>
                    </div>
                    <div className="pt-4 flex justify-center sm:justify-start">
                        <Link
                            to="/profile/settings"
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-[var(--color-surface-low)] border border-[var(--color-surface-high)] text-[11px] font-black uppercase tracking-[0.14em] hover:bg-white/[0.05] transition-colors"
                            style={{ fontFamily: 'Inter, sans-serif' }}
                        >
                            <Settings className="w-4 h-4" />
                            Edit Profile
                        </Link>
                    </div>
                </div>
            </div>

            {/* Navigation Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {navigationItems.map((item) => {
                    const Icon = item.icon;
                    const content = (
                        <>
                            <div className={`p-3 rounded-2xl ${item.bg} ${item.color} group-hover:scale-110 transition-transform`}>
                                <Icon className="w-5 h-5" />
                            </div>
                            <span className="text-[11px] font-black text-[var(--color-on-surface)] uppercase tracking-[0.12em] text-center" style={{ fontFamily: 'Inter, sans-serif' }}>
                                {item.label}
                            </span>
                        </>
                    );

                    if (item.onClick) {
                        return (
                            <button 
                                key={item.label}
                                onClick={item.onClick}
                                className="glass-card p-5 group flex flex-col items-center gap-3 transition-all hover:-translate-y-1.5 hover:shadow-2xl border border-[var(--color-surface-high)]"
                            >
                                {content}
                            </button>
                        )
                    }

                    return (
                        <Link 
                            key={item.label}
                            to={item.path}
                            className="glass-card p-5 group flex flex-col items-center gap-3 transition-all hover:-translate-y-1.5 hover:shadow-2xl border border-[var(--color-surface-high)]"
                        >
                            {content}
                        </Link>
                    )
                })}
            </div>

            {/* Recent Orders Preview */}
            <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                    <h3 className="text-lg font-black tracking-tight text-[var(--color-on-surface)] flex items-center gap-2" style={{ fontFamily: 'Manrope, sans-serif' }}>
                        <Package className="w-5 h-5 text-primary" />
                        Recent Orders
                    </h3>
                    <Link to="/profile/orders" className="text-[10px] font-black text-primary uppercase tracking-widest hover:underline">
                        View All
                    </Link>
                </div>

                {error && (
                    <div className="glass-card p-4 border border-red-500/20 text-red-500 text-[12px] font-semibold">
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className="glass-card p-12 flex flex-col items-center gap-4">
                        <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                        <span className="text-[11px] font-black uppercase tracking-[0.2em] opacity-40">Fetching Logistics</span>
                    </div>
                ) : orders.length > 0 ? (
                    <div className="flex flex-col gap-3">
                        {orders.slice(0, 2).map((order) => (
                            <Link 
                                key={order.id} 
                                to={`/track/${order.id}`}
                                className="glass-card p-5 flex items-center justify-between group border border-[var(--color-surface-high)] transition-all hover:bg-white/[0.05]"
                            >
                                <div className="flex items-center gap-5">
                                    <div className="w-12 h-12 rounded-2xl bg-[var(--color-surface-low)] flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all">
                                        <ShoppingBag size={20} />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[13px] font-black text-[var(--color-on-surface)]" style={{ fontFamily: 'Manrope, sans-serif' }}>
                                            Order #{order.id.toString().slice(-6)}
                                        </span>
                                        <span className="text-[10px] font-bold text-[var(--color-on-surface-variant)] opacity-60">
                                            ₹{order.total_amount} · {new Date(order.created_at).toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <span className="px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[10px] font-black uppercase tracking-wider">
                                        {order.status}
                                    </span>
                                    <ChevronRight className="w-4 h-4 text-[var(--color-surface-high)] group-hover:text-primary transition-colors" />
                                </div>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <div className="glass-card p-10 text-center space-y-3">
                        <div className="w-16 h-16 bg-[var(--color-surface-low)] rounded-full flex items-center justify-center mx-auto">
                            <Package className="w-6 h-6 opacity-20" />
                        </div>
                        <p className="text-[12px] font-bold text-[var(--color-on-surface-variant)] opacity-50">No orders placed yet.</p>
                        <Link to="/" className="btn-primary inline-flex mt-2">Start Shopping</Link>
                    </div>
                )}
            </div>

            {/* Logout Section */}
            <div className="pt-6 pb-10">
                <button
                    onClick={() => {
                        useStore.getState().logout();
                        navigate('/');
                    }}
                    className="w-full flex items-center justify-center gap-3 py-4 bg-red-500/10 text-red-500 rounded-3xl hover:bg-red-500/20 active:scale-[0.98] transition-all font-black text-[13px] tracking-[0.15em] uppercase border border-red-500/10"
                    style={{ fontFamily: 'Inter, sans-serif' }}
                >
                    <LogOut className="w-5 h-5" />
                    Logout Account
                </button>
            </div>
        </div>
    )
}

export default Profile
