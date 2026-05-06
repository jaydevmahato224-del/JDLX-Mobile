import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Home, Search, ShoppingCart, User, LayoutDashboard, ArrowLeft } from 'lucide-react'
import { useStore } from '../store/useStore'
import SearchBar from './SearchBar'
import NotificationBell from './NotificationBell'

function Layout({ children }) {
    const location = useLocation();
    const navigate = useNavigate();
    const cart = useStore((state) => state.cart);
    const user = useStore((state) => state.user);

    const cartItemCount = cart.reduce((acc, item) => acc + item.qty, 0);
    const canGoBack = location.pathname !== '/';

    const handleBack = () => {
        if (window.history.length > 1) {
            navigate(-1);
            return;
        }
        navigate('/');
    };

    const sideLinks = [
        { path: '/', icon: Home, label: 'Home' },
        { path: '/search', icon: Search, label: 'Explore' },
        { path: '/cart', icon: ShoppingCart, label: 'Cart', count: cartItemCount },
        { path: user ? '/profile' : '/login', icon: User, label: user ? 'Profile' : 'Login' },
    ];

    return (
        <div className="flex h-screen overflow-hidden bg-gray-50/50">
            {/* Desktop Sidebar (Unified Pattern) */}
            <aside className="hidden md:flex flex-col w-64 bg-white border-r border-gray-200 z-50">
                <div className="flex items-center h-[var(--app-header-height)] px-6 border-b border-gray-100">
                    <Link to="/" className="text-xl font-black tracking-tighter text-primary">
                        JDLX MOBILE
                    </Link>
                </div>
                <nav className="flex-1 py-6 px-4 space-y-2">
                    {sideLinks.map((link) => {
                        const Icon = link.icon;
                        const isActive = location.pathname === link.path;
                        return (
                            <Link
                                key={link.path}
                                to={link.path}
                                className={`flex items-center gap-3 px-4 py-3 rounded-2xl font-bold transition-all ${
                                    isActive 
                                    ? 'bg-primary text-white shadow-lg shadow-primary/20 scale-[1.02]' 
                                    : 'text-gray-500 hover:bg-gray-50 hover:text-primary'
                                }`}
                            >
                                <div className="relative">
                                    <Icon className="w-5 h-5" />
                                    {link.count > 0 && (
                                        <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center border-2 border-white">
                                            {link.count}
                                        </span>
                                    )}
                                </div>
                                <span className="text-sm">{link.label}</span>
                            </Link>
                        );
                    })}
                </nav>
                {user && (
                    <div className="p-4 border-t border-gray-100">
                        <Link to="/profile" className="flex items-center gap-3 p-3 rounded-2xl hover:bg-gray-50 transition-colors">
                            {user.profile_image ? (
                                <img src={user.profile_image} className="w-9 h-9 rounded-full object-cover border border-gray-200" alt="Avatar" />
                            ) : (
                                <div className="w-9 h-9 bg-primary/10 rounded-full flex items-center justify-center text-primary font-bold">
                                    {user.name?.charAt(0) || 'U'}
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-gray-900 truncate">{user.name}</p>
                                <p className="text-xs text-gray-500 truncate">Member Account</p>
                            </div>
                        </Link>
                    </div>
                )}
            </aside>

            {/* Flexible Content Column */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
                {/* Top Header */}
                <header className="glass-header sticky top-0 z-50 grid h-[var(--app-header-height)] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 md:px-6">
                    <div className="flex min-w-0 items-center gap-2">
                        {canGoBack ? (
                            <button
                                onClick={handleBack}
                                aria-label="Go back"
                                className="p-2 bg-white/50 rounded-full hover:bg-white/80 transition-colors border border-white/20 shadow-sm"
                            >
                                <ArrowLeft className="w-5 h-5 text-gray-700" />
                            </button>
                        ) : (
                            <div className="w-10 h-10 md:hidden" aria-hidden="true" />
                        )}
                    </div>

                    <Link to="/" className="md:hidden justify-self-center text-center text-lg font-black tracking-tighter text-primary drop-shadow-sm sm:text-xl">
                        JDLX MOBILE
                    </Link>

                    <div className="flex min-w-0 items-center justify-end gap-2">
                        {location.pathname !== '/' && location.pathname !== '/search' && (
                            <div className="hidden min-w-0 flex-1 md:block md:max-w-md md:pr-2">
                                <SearchBar />
                            </div>
                        )}
                        <NotificationBell />
                        <Link to="/cart" className="relative p-2 bg-white/50 rounded-full hover:bg-white/80 transition-colors border border-white/20 shadow-sm">
                            <ShoppingCart className="w-5 h-5 text-gray-700" />
                            {cartItemCount > 0 && (
                                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] min-w-[18px] h-[18px] rounded-full flex items-center justify-center font-bold px-1 border-2 border-white shadow-sm">
                                    {cartItemCount}
                                </span>
                            )}
                        </Link>
                        <Link to={user ? "/profile" : "/login"} className="hidden sm:flex p-2 bg-white/50 rounded-full hover:bg-white/80 transition-colors border border-white/20 shadow-sm">
                            {user?.profile_image ? (
                                <img src={user.profile_image} alt="Profile" className="w-5 h-5 rounded-full" />
                            ) : (
                                <User className="w-5 h-5 text-gray-700" />
                            )}
                        </Link>
                    </div>
                </header>

                {/* Main Content Area */}
                <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pt-4 pb-[var(--app-bottom-nav-height)] md:pb-6">
                    <div className="container-standard">
                        {children}
                    </div>
                </main>

                {/* App-style Bottom Navigation (Mobile Only) */}
                <nav className="fixed bottom-0 w-full glass-header flex justify-around items-center py-3 px-2 md:hidden z-50">
                    <Link to="/" className={`flex flex-col items-center gap-1 ${location.pathname === '/' ? 'text-primary' : 'text-gray-500'}`}>
                        <Home className="w-6 h-6" />
                        <span className="text-[10px] font-medium">Home</span>
                    </Link>
                    <Link to="/cart" className={`flex flex-col items-center gap-1 ${location.pathname === '/cart' ? 'text-primary' : 'text-gray-500'}`}>
                        <div className="relative">
                            <ShoppingCart className="w-6 h-6" />
                            {cartItemCount > 0 && (
                                <span className="absolute -top-1 -right-2 bg-red-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                                    {cartItemCount}
                                </span>
                            )}
                        </div>
                        <span className="text-[10px] font-medium">Cart</span>
                    </Link>
                    <Link to={user ? "/profile" : "/login"} className={`flex flex-col items-center gap-1 ${location.pathname === '/profile' || location.pathname === '/login' ? 'text-primary' : 'text-gray-500'}`}>
                        {user?.profile_image ? (
                            <img src={user.profile_image} alt="Profile" className="w-6 h-6 rounded-full border border-primary/50 object-cover" />
                        ) : (
                            <User className="w-6 h-6" />
                        )}
                        <span className="text-[10px] font-medium">{user ? "Profile" : "Login"}</span>
                    </Link>
                </nav>
            </div>
        </div>
    )
}

export default Layout
