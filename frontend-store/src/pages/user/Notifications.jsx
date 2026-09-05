import { useState, useEffect, useCallback } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../utils/apiFetch'

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
            } catch {
                setPushState('unsupported');
            }
        })();
    }, [token]);

    const enablePush = async () => {
        setSubmitting(true);
        try {
            const { subscribeToPush } = await import('../../push');
            const sub = await subscribeToPush();
            if (!sub) { setPushState('denied'); return; }
            await apiFetch('/notifications/register-token', {
                method: 'POST',
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
        const res = await apiFetch('/user/notifications');
        if (res.ok) setNotes(await res.json());
    }, []);
    useEffect(() => { fetchNotes(); }, [fetchNotes]);

    const markAll = async () => {
        await apiFetch('/user/notifications', {
            method: 'PUT',
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
                        <div className="text-sm text-[var(--color-on-surface-variant)]">
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
                    <li key={n.id} className={`p-3 ${isReadNotification(n)?'bg-[var(--color-surface-container)]':''} glass-card`}>
                        <div className="font-bold">{n.title}</div>
                        <div className="text-sm">{n.message}</div>
                        <div className="text-xs text-[var(--color-on-surface-variant)]">{n.created_at}</div>
                    </li>
                ))}
            </ul>
        </div>
    )
}

export default Notifications
