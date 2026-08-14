import { useState, useEffect, useCallback } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate } from 'react-router-dom'

const isReadNotification = (notification) => Boolean(Number(notification.read_status ?? notification.is_read ?? 0));

function Notifications() {
    const token = useStore.getState().token;
    const user = useStore(state=>state.user);
    const navigate = useNavigate();
    const [notes, setNotes] = useState([]);
    const [pushState, setPushState] = useState('checking'); // checking | granted | denied | unsupported
    const [submitting, setSubmitting] = useState(false);

    useEffect(()=>{
        if(!user){navigate('/login');}
    },[user,navigate]);

    // Push permission status
    useEffect(() => {
        (async () => {
            try {
                const { getPushPermission, isPushConfigured } = await import('../../push');
                if (!isPushConfigured()) { setPushState('unsupported'); return; }
                setPushState(getPushPermission());
            } catch (e) {
                setPushState('unsupported');
            }
        })();
    }, [token]);

    const enablePush = async () => {
        setSubmitting(true);
        try {
            const activeToken = token || localStorage.getItem('token');
            if (!activeToken || activeToken === 'null' || activeToken === 'undefined') {
                navigate('/login');
                return;
            }
            const { subscribeToPush } = await import('../../push');
            const sub = await subscribeToPush();
            if (!sub) { setPushState('denied'); return; }
            await window.fetch(`${API_BASE_URL}/notifications/register-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeToken}` },
                body: JSON.stringify({ subscription: sub, device_type: 'web' })
            });
            setPushState('granted');
        } catch (e) {
            console.error('enablePush error:', e);
        } finally {
            setSubmitting(false);
        }
    };

    const fetchNotes = useCallback(async () => {
        const activeToken = token || localStorage.getItem('token');
        if (!activeToken || activeToken === 'null' || activeToken === 'undefined') return;
        const res = await window.fetch(`${API_BASE_URL}/user/notifications`, { headers: { Authorization: `Bearer ${activeToken}` } });
        if (res.ok) setNotes(await res.json());
    }, [token]);
    useEffect(() => { fetchNotes(); }, [fetchNotes]);

    const markAll = async () => {
        await window.fetch(`${API_BASE_URL}/user/notifications`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({})
        });
        fetchNotes();
    };

    return (
        <div className="container-standard py-6">
            <h2 className="text-2xl font-bold mb-4">Notifications</h2>

            {pushState !== 'unsupported' && pushState !== 'checking' && (
                <div className="glass-card p-4 mb-4 flex items-center justify-between gap-3">
                    <div>
                        <div className="font-bold">
                            {pushState === 'granted' ? '🔔 Push notifications enabled' : '🔕 Push notifications off'}
                        </div>
                        <div className="text-sm text-gray-500">
                            {pushState === 'granted'
                                ? 'You will get order updates and offers even when the app is closed.'
                                : 'Enable to receive order updates and offers when the app is closed.'}
                        </div>
                    </div>
                    {pushState !== 'granted' && (
                        <button onClick={enablePush} disabled={submitting} className="btn-primary whitespace-nowrap">
                            {submitting ? 'Enabling…' : 'Enable'}
                        </button>
                    )}
                </div>
            )}

            <button onClick={markAll} className="btn-secondary mb-4">Mark All Read</button>
            <ul className="space-y-2">
                {notes.map(n=> (
                    <li key={n.id} className={`p-3 ${isReadNotification(n)?'bg-gray-100':''} glass-card`}> 
                        <div className="font-bold">{n.title}</div>
                        <div className="text-sm">{n.message}</div>
                        <div className="text-xs text-gray-500">{n.created_at}</div>
                    </li>
                ))}
            </ul>
        </div>
    )
}

export default Notifications
