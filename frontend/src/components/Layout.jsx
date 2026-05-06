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
    const layoutOffsetStyle = {
        '--app-header-height': '72px',
        '--app-bottom-nav-height': '64px',
        '--app-bottom-nav-offset': 'calc(var(--app-bottom-nav-height) + env(safe-area-inset-bottom, 0px))',
    };

    const cartItemCount = cart.reduce((acc, item) => acc + item.qty, 0);
    const canGoBack = location.pathname !== '/';

    const handleBack = () => {
        if (window.history.length > 1) {
            navigate(-1);
            return;
        }
        navigate('/');
    };

    return (
        <div
            className="app-shell flex min-h-[100dvh] flex-col overflow-hidden bg-gray-50/50"
            style={layoutOffsetStyle}
        >
            {/* Top Header */}
            <header className="glass-header fixed inset-x-0 top-0 z-50 flex h-[var(--app-header-height)] items-center justify-between gap-2 px-4 py-3">
                <div className="w-9 h-9 flex-shrink-0" aria-hidden="true" />
                <Link to="/" className="text-xl font-bold tracking-tighter text-primary drop-shadow-sm flex-shrink-0">JDLX MOBILE</Link>

                <SearchBar />

                <div className="flex items-center gap-2 flex-shrink-0">
                    <NotificationBell />
                    <Link to="/cart" className="relative p-2 bg-white/50 rounded-full hover:bg-white/80 transition-colors">
                        <ShoppingCart className="w-5 h-5 text-gray-700" />
                        {cartItemCount > 0 && (
                            <span className="absolute top-0 right-0 bg-red-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                                {cartItemCount}
                            </span>
                        )}
                    </Link>
                    <Link to={user ? "/profile" : "/login"} className="p-2 bg-white/50 rounded-full hover:bg-white/80 transition-colors">
                        <User className="w-5 h-5 text-gray-700" />
                    </Link>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="app-main flex-1 overflow-y-auto overflow-x-hidden pt-[var(--app-header-height)] pb-[var(--app-bottom-nav-offset)] md:pb-4">
                <div className="relative mx-auto w-full max-w-lg p-4 md:max-w-4xl">
                    {canGoBack && (
                        <button
                            onClick={handleBack}
                            aria-label="Go back"
                            className="mb-3 inline-flex items-center gap-2 rounded-lg border border-white/30 bg-white/70 px-3 py-2 shadow-sm transition-colors hover:bg-white"
                        >
                            <ArrowLeft className="w-4 h-4 text-gray-700" />
                            <span className="text-sm font-semibold text-gray-700">Back</span>
                        </button>
                    )}
                    {children}
                </div>
            </main>

            {/* App-style Bottom Navigation (Mobile) */}
            <nav className="glass-header fixed bottom-0 left-0 z-50 flex h-[var(--app-bottom-nav-height)] w-full justify-around px-2 md:hidden">
                <Link to="/" className={`flex flex-col items-center justify-center gap-1 h-full ${location.pathname === '/' ? 'text-primary' : 'text-gray-500'}`}>
                    <Home className="w-6 h-6" />
                    <span className="text-[10px] font-medium leading-none">Home</span>
                </Link>
                <Link to="/cart" className={`flex flex-col items-center justify-center gap-1 h-full ${location.pathname === '/cart' ? 'text-primary' : 'text-gray-500'}`}>
                    <div className="relative">
                        <ShoppingCart className="w-6 h-6" />
                        {cartItemCount > 0 && (
                            <span className="absolute -top-1 -right-2 bg-red-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                                {cartItemCount}
                            </span>
                        )}
                    </div>
                    <span className="text-[10px] font-medium leading-none">Cart</span>
                </Link>
                <Link to={user ? "/profile" : "/login"} className={`flex flex-col items-center justify-center gap-1 h-full ${location.pathname === '/profile' || location.pathname === '/login' ? 'text-primary' : 'text-gray-500'}`}>
                    {user?.profile_image ? (
                        <img src={user.profile_image} alt="Profile" className="w-6 h-6 rounded-full border border-primary/50" />
                    ) : (
                        <User className="w-6 h-6" />
                    )}
                    <span className="text-[10px] font-medium leading-none">{user ? "Profile" : "Login"}</span>
                </Link>
                <Link to="/admin" className={`flex flex-col items-center justify-center gap-1 h-full ${location.pathname.startsWith('/admin') ? 'text-primary' : 'text-gray-500'}`}>
                    <LayoutDashboard className="w-6 h-6" />
                    <span className="text-[10px] font-medium leading-none">Admin</span>
                </Link>
            </nav>
        </div>
    )
}

export default Layout
