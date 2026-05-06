import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate } from 'react-router-dom'

function Addresses() {
    const token = useStore.getState().token;
    const user = useStore(state => state.user);
    const navigate = useNavigate();
    const [addresses, setAddresses] = useState([]);
    const [form, setForm] = useState({ full_name: '', phone: '', house: '', city: '', state: '', pincode: '', landmark: '', is_default: 0 });
    const [editing, setEditing] = useState(null);

    useEffect(() => {
        if (!user) {
            navigate('/login');
            return;
        }
    }, [user, navigate]);

    const fetch = async () => {
        const res = await fetch(`${API_BASE_URL}/user/addresses`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) setAddresses(await res.json());
    };

    useEffect(() => { fetch(); }, []);

    const handleSave = async e => {
        e.preventDefault();
        const method = editing ? 'PUT' : 'POST';
        const body = editing ? { ...form, id: editing } : form;
        const res = await fetch(`${API_BASE_URL}/user/addresses`, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(body)
        });
        if (res.ok) {
            setForm({ full_name: '', phone: '', house: '', city: '', state: '', pincode: '', landmark: '', is_default: 0 });
            setEditing(null);
            fetch();
        }
    };

    const handleDelete = async id => {
        await fetch(`${API_BASE_URL}/user/addresses`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ id })
        });
        fetch();
    };

    return (
        <div className="container-standard py-6">
            <h2 className="text-2xl font-bold mb-4">Saved Addresses</h2>
            <div className="flex flex-col gap-4">
                {addresses.map(a => (
                    <div key={a.id} className="glass-card p-4 flex justify-between items-center">
                        <div>
                            <div className="font-bold">{a.full_name} {a.is_default ? '(Default)' : ''}</div>
                            <div className="text-sm">{a.house}, {a.city}, {a.state} - {a.pincode}</div>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => { setEditing(a.id); setForm(a); }}>Edit</button>
                            <button onClick={() => handleDelete(a.id)} className="text-red-600">Delete</button>
                        </div>
                    </div>
                ))}
            </div>
            <form onSubmit={handleSave} className="mt-6 flex flex-col gap-2">
                <input placeholder="Full Name" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} className="input" />
                <input placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="input" />
                <input placeholder="House/Flat/Area" value={form.house} onChange={e => setForm({ ...form, house: e.target.value })} className="input" />
                <input placeholder="City" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} className="input" />
                <input placeholder="State" value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} className="input" />
                <input placeholder="Pincode" value={form.pincode} onChange={e => setForm({ ...form, pincode: e.target.value })} className="input" />
                <input placeholder="Landmark" value={form.landmark} onChange={e => setForm({ ...form, landmark: e.target.value })} className="input" />
                <label className="flex items-center gap-2">
                    <input type="checkbox" checked={form.is_default} onChange={e => setForm({ ...form, is_default: e.target.checked ? 1 : 0 })} /> Default
                </label>
                <button className="btn-primary">{editing ? 'Update' : 'Add'} Address</button>
            </form>
        </div>
    )
}

export default Addresses
