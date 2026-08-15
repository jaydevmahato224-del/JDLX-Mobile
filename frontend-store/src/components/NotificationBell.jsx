import { useState, useEffect, useRef } from 'react'
import { Bell, Check, Trash2, Package, Tag, Info } from 'lucide-react'
import { API_BASE_URL } from '../config'
import { useStore } from '../store/useStore'

const isUnreadNotification = (notification) => !Number(notification.read_status ?? notification.is_read ?? 0);

function NotificationBell() {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const dropdownRef = useRef(null);
    const token = useStore(state => state.token);
    const user = useStore(state => state.user);

    // Load notifications on mount and refresh when the dropdown is opened.
    // setState only runs inside promise callbacks (never synchronously in the
    // effect body) to avoid cascading renders.
    useEffect(() => {
        let ignore = false;
        const activeToken = token || localStorage.getItem('token');
        if (!activeToken || activeToken === 'null' || activeToken === 'undefined') return undefined;

        fetch(`${API_BASE_URL}/notifications`, {
            headers: { 'Authorization': `Bearer ${activeToken}` }
        })
            .then(async (res) => (res.status === 401 ? null : res.json()))
            .then((json) => {
                if (ignore || !json) return;
                const notificationsData = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
                setNotifications(notificationsData);
                setUnreadCount(notificationsData.filter(isUnreadNotification).length);
            })
            .catch(() => {
                if (!ignore) console.warn('Notifications temporarily unavailable.');
            });

        return () => { ignore = true; };
    }, [token, isOpen]);

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
                setNotifications(prev => prev.map(n => n.id === id ? { ...n, read_status: 1, is_read: 1 } : n));
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
                setNotifications(prev => prev.map(n => ({ ...n, read_status: 1, is_read: 1 })));
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
                className="relative p-2 rounded-full hover:bg-[var(--color-surface-low)] transition-colors"
                aria-label="Notifications"
            >
                <Bell size={24} className={unreadCount > 0 ? "text-primary animate-tada" : "text-[var(--color-on-surface-variant)]"} />
                {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 bg-primary text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border-2 border-white">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-3 w-80 bg-[var(--color-surface-card)]/95 backdrop-blur-md rounded-2xl shadow-2xl border border-[var(--color-surface-high)] z-50 animate-in slide-in-from-top-2 duration-200">
                    <div className="p-4 border-b border-[var(--color-surface-high)] flex items-center justify-between">
                        <h3 className="font-bold text-[var(--color-on-surface)]">Notifications</h3>
                        {unreadCount > 0 && (
                            <button onClick={markAllRead} className="text-xs text-primary font-semibold hover:underline">
                                Mark all as read
                            </button>
                        )}
                    </div>

                    <div className="max-h-96 overflow-y-auto">
                        {notifications.length === 0 ? (
                            <div className="p-10 text-center flex flex-col items-center gap-2">
                                <Bell className="w-8 h-8 text-[var(--color-surface-high)]" />
                                <p className="text-[var(--color-on-surface-variant)] text-sm">No notifications yet</p>
                            </div>
                        ) : (
                            notifications.map(notification => (
                                <div
                                    key={notification.id}
                                    className={`p-4 border-b border-[var(--color-surface-low)] flex gap-3 hover:bg-[var(--color-surface-low)] transition-colors cursor-pointer ${isUnreadNotification(notification) ? 'bg-primary/5' : ''}`}
                                    onClick={() => isUnreadNotification(notification) && markAsRead(notification.id)}
                                >
                                    <div className="mt-1">{getIcon(notification.type)}</div>
                                    <div className="flex-1">
                                        <div className="flex justify-between items-start">
                                            <h4 className={`text-sm font-bold ${isUnreadNotification(notification) ? 'text-[var(--color-on-surface)]' : 'text-[var(--color-on-surface-variant)]'}`}>
                                                {notification.title}
                                            </h4>
                                            {isUnreadNotification(notification) && (
                                                <div className="w-2 h-2 bg-primary rounded-full"></div>
                                            )}
                                        </div>
                                        <p className="text-xs text-[var(--color-on-surface-variant)] mt-1 leading-relaxed">
                                            {notification.message}
                                        </p>
                                        <span className="text-[10px] text-[var(--color-on-surface-variant)] mt-2 block">
                                            {new Date(notification.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="p-3 text-center border-t border-[var(--color-surface-high)]">
                        <p className="text-[10px] text-[var(--color-on-surface-variant)] font-medium tracking-wider uppercase">JDLX Real-time Updates</p>
                    </div>
                </div>
            )}
        </div>
    );
}

export default NotificationBell;
