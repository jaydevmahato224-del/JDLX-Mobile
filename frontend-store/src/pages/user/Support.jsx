import { useState, useEffect, useCallback } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../utils/apiFetch'
import { apiFetch } from '../../utils/apiFetch'

function Support() {
    const user = useStore(state => state.user);
    const navigate = useNavigate();
    const [tickets, setTickets] = useState([]);
    const [form, setForm] = useState({ subject: '', message: '' });

    useEffect(() => {
        if (!user) { navigate('/login'); }
    }, [user, navigate]);

    // Named fetchData (not `fetch`) so the browser's global fetch API is not
    // shadowed — a local `fetch` would recursively call itself and overflow.
    const fetchData = useCallback(async () => {
        const res = await apiFetch('/user/support');
        if (res.ok) setTickets(await res.json());
    }, []);
    useEffect(() => { fetchData(); }, [fetchData]);

    const submit = async e => {
        e.preventDefault();
        await apiFetch('/user/support', {
            method: 'POST',
            body: JSON.stringify(form)
        });
        setForm({ subject: '', message: '' });
        fetchData();
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
