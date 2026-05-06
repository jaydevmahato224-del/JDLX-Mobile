import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate } from 'react-router-dom'

function Payments() {
    const token = useStore.getState().token;
    const user = useStore(state => state.user);
    const navigate = useNavigate();
    const [methods, setMethods] = useState([]);
    const [form, setForm] = useState({ method_type: '', token: '', last4: '' });

    useEffect(() => {
        if (!user) { navigate('/login'); }
    }, [user, navigate]);

    const fetch = async () => {
        const res = await fetch(`${API_BASE_URL}/user/payments`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) setMethods(await res.json());
    };
    useEffect(() => { fetch(); }, []);

    const add = async e => {
        e.preventDefault();
        const res = await fetch(`${API_BASE_URL}/user/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(form)
        });
        if (res.ok) {
            setForm({ method_type: '', token: '', last4: '' });
            fetch();
        }
    };

    const remove = async id => {
        await fetch(`${API_BASE_URL}/user/payments`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ id })
        });
        fetch();
    };

    return (
        <div className="container-standard py-6">
            <h2 className="text-2xl font-bold mb-4">Payment Methods</h2>
            <ul className="space-y-2">
                {methods.map(m => (
                    <li key={m.id} className="flex justify-between items-center">
                        <span>{m.method_type} ****{m.last4}</span>
                        <button className="text-red-600" onClick={() => remove(m.id)}>Delete</button>
                    </li>
                ))}
            </ul>
            <form onSubmit={add} className="mt-4 flex flex-col gap-2">
                <select value={form.method_type} onChange={e => setForm({ ...form, method_type: e.target.value })} className="input">
                    <option value="">Select method</option>
                    <option value="UPI">UPI</option>
                    <option value="Credit Card">Credit Card</option>
                    <option value="Debit Card">Debit Card</option>
                    <option value="Net Banking">Net Banking</option>
                </select>
                <input placeholder="Token/ID" value={form.token} onChange={e => setForm({ ...form, token: e.target.value })} className="input" />
                <input placeholder="Last4" value={form.last4} onChange={e => setForm({ ...form, last4: e.target.value })} className="input" />
                <button className="btn-primary">Save</button>
            </form>
        </div>
    )
}

export default Payments
