import { useState, useEffect, useCallback } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate } from 'react-router-dom'

function Security() {
    const token = useStore.getState().token;
    const user = useStore(state => state.user);
    const navigate = useNavigate();
    const [history, setHistory] = useState([]);

    useEffect(() => {
        if (!user) { navigate('/login'); }
    }, [user, navigate]);

    // Named fetchData (not `fetch`) so the browser's global fetch API is not
    // shadowed — a local `fetch` would recursively call itself and overflow.
    const fetchData = useCallback(async () => {
        const res = await fetch(`${API_BASE_URL}/user/login-history`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) setHistory(await res.json());
    }, [token]);
    useEffect(() => { fetchData(); }, [fetchData]);

    return (
        <div className="container-standard py-6">
            <h2 className="text-2xl font-bold mb-4">Security Settings</h2>
            <div className="mb-6">
                <h3 className="font-bold">Login History</h3>
                <ul className="space-y-2">
                    {history.map(h => (
                        <li key={h.id} className="text-sm">
                            {h.timestamp} - {h.ip_address} ({h.device || 'unknown'})
                        </li>
                    ))}
                </ul>
            </div>
            <div>
                <h3 className="font-bold mb-2">Password</h3>
                <p className="text-sm">Password change is managed by Google login. Log in to your Google account to update credentials.</p>
            </div>
        </div>
    )
}

export default Security
