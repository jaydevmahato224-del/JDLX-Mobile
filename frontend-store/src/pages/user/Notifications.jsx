import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate } from 'react-router-dom'

const isReadNotification = (notification) => Boolean(Number(notification.read_status ?? notification.is_read ?? 0));

function Notifications() {
    const token = useStore.getState().token;
    const user = useStore(state=>state.user);
    const navigate = useNavigate();
    const [notes, setNotes] = useState([]);

    useEffect(()=>{
        if(!user){navigate('/login');}
    },[user,navigate]);

    const fetchNotes = async () => {
        const res = await window.fetch(`${API_BASE_URL}/user/notifications`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) setNotes(await res.json());
    };
    useEffect(() => { fetchNotes(); }, []);

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
