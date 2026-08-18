import { useState, useEffect, useRef } from 'react'
import { Bell, Check, Trash2, Package, Tag, Info } from 'lucide-react'
import { API_BASE_URL } from '../config'
import { useStore } from '../store/useStore'

function NotificationBell() {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const dropdownRef = useRef(null);
    const token = useStore(state => state.token);
    const user = useStore(state => state.user);

    useEffect(() => {
        const fetchNotifications = async () => {
            if (!token) return;
            try {
                const res = await fetch(`${API_BASE_URL}/notifications`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const result = await res.json();
                if (res.ok) {
                    const data = Array.isArray(result) ? result : (result.data || []);
                    setNotifications(data);
                    setUnreadCount(data.filter(n => !n.read_status).length);
                }
            } catch (error) {
                console.error('Failed to fetch notifications:', error);
            }
        };

        fetchNotifications();
        const interval = setInterval(fetchNotifications, 30000); // Poll every 30s
        return () => clearInterval(interval);
    }, [token]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const markAsRead = async (id) => {
        try {
            const res = await fetch(`${API_BASE_URL}/notifications/${id}/read`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                setNotifications(prev => prev.map(n => n.id === id ? { ...n, read_status: 1 } : n));
                setUnreadCount(prev => Math.max(0, prev - 1));
            }
        } catch (error) {
            console.error('Failed to mark notification as read:', error);
        }
    };

    const markAllRead = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/notifications/read-all`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                setNotifications(prev => prev.map(n => ({ ...n, read_status: 1 })));
                setUnreadCount(0);
            }
        } catch (error) {
            console.error('Failed to mark all as read:', error);
        }
    };

    const getIcon = (type) => {
        switch (type) {
            case 'ORDER': return <Package className="w-4 h-4 text-blue-500" />;
            case 'OFFER': return <Tag className="w-4 h-4 text-orange-500" />;
            default: return <Info className="w-4 h-4 text-gray-500" />;
        }
    };

    if (!user) return null;

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 rounded-full hover:bg-gray-100 transition-colors"
                aria-label="Notifications"
            >
                <Bell size={24} className={unreadCount > 0 ? "text-primary animate-tada" : "text-gray-600"} />
                {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 bg-primary text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-white">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-3 w-80 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-white/50 z-50 animate-in slide-in-from-top-2 duration-200">
                    <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                        <h3 className="font-bold text-gray-800">Notifications</h3>
                        {unreadCount > 0 && (
                            <button onClick={markAllRead} className="text-xs text-primary font-semibold hover:underline">
                                Mark all as read
                            </button>
                        )}
                    </div>

                    <div className="max-h-96 overflow-y-auto">
                        {notifications.length === 0 ? (
                            <div className="p-10 text-center flex flex-col items-center gap-2">
                                <Bell className="w-8 h-8 text-gray-200" />
                                <p className="text-gray-400 text-sm">No notifications yet</p>
                            </div>
                        ) : (
                            notifications.map(notification => (
                                <div
                                    key={notification.id}
                                    className={`p-4 border-b border-gray-50 flex gap-3 hover:bg-gray-50 transition-colors cursor-pointer ${!notification.read_status ? 'bg-primary/5' : ''}`}
                                    onClick={() => !notification.read_status && markAsRead(notification.id)}
                                >
                                    <div className="mt-1">{getIcon(notification.type)}</div>
                                    <div className="flex-1">
                                        <div className="flex justify-between items-start">
                                            <h4 className={`text-sm font-bold ${!notification.read_status ? 'text-gray-900' : 'text-gray-600'}`}>
                                                {notification.title}
                                            </h4>
                                            {!notification.read_status && (
                                                <div className="w-2 h-2 bg-primary rounded-full"></div>
                                            )}
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                                            {notification.message}
                                        </p>
                                        <span className="text-[10px] text-gray-400 mt-2 block">
                                            {new Date(notification.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="p-3 text-center border-t border-gray-100">
                        <p className="text-[10px] text-gray-400 font-medium tracking-wider uppercase">JDLX Real-time Updates</p>
                    </div>
                </div>
            )}
        </div>
    );
}

export default NotificationBell;
