import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate } from 'react-router-dom'

function Support() {
    const token = useStore.getState().token;
    const user = useStore(state => state.user);
    const navigate = useNavigate();
    const [tickets, setTickets] = useState([]);
    const [form, setForm] = useState({ subject: '', message: '' });

    useEffect(() => {
        if (!user) { navigate('/login'); }
    }, [user, navigate]);

    const fetch = async () => {
        const res = await fetch(`${API_BASE_URL}/user/support`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) setTickets(await res.json());
    };
    useEffect(() => { fetch(); }, []);

    const submit = async e => {
        e.preventDefault();
        await fetch(`${API_BASE_URL}/user/support`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(form)
        });
        setForm({ subject: '', message: '' });
        fetch();
    };

    return (
        <div className="container-standard py-6">
            <h2 className="text-2xl font-bold mb-4">Help & Support</h2>
            <form onSubmit={submit} className="flex flex-col gap-2 mb-6">
                <input placeholder="Subject" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} className="input" />
                <textarea placeholder="Message" value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} className="input h-24" />
                <button className="btn-primary">Submit Ticket</button>
            </form>
            <div className="space-y-3">
                {tickets.map(t => (
                    <div key={t.id} className="glass-card p-3">
                        <div className="font-bold">{t.subject} <span className="text-xs text-gray-500">({t.status})</span></div>
                        <div className="text-sm">{t.message}</div>
                        <div className="text-xs text-gray-500">{t.created_at}</div>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default Support
