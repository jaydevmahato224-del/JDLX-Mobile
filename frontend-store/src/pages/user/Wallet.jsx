import { useState, useEffect, useCallback } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../utils/apiFetch'

function Wallet() {
    const user = useStore(state => state.user);
    const navigate = useNavigate();
    const [wallet, setWallet] = useState({ balance: 0, transactions: [] });
    useEffect(() => {
        if (!user) { navigate('/login'); }
    }, [user, navigate]);

    // Named fetchData (not `fetch`) so the browser's global fetch API is not
    // shadowed — a local `fetch` would recursively call itself and overflow.
    const fetchData = useCallback(async () => {
        const res = await apiFetch('/user/wallet');
        if (res.ok) setWallet(await res.json());
    }, []);
    useEffect(() => { fetchData(); }, [fetchData]);

    return (
        <div className="container-standard py-6">
            <h2 className="text-2xl font-bold mb-4">Wallet</h2>
            <div className="text-xl font-black mb-4">Balance: ₹{wallet.balance}</div>
            <h3 className="mt-6 font-bold">Transactions</h3>
            <ul className="space-y-2">
                {wallet.transactions.map(tx => (
                    <li key={tx.id} className="flex justify-between">
                        <span>{tx.type} ₹{tx.amount}</span>
                        <span className="text-xs text-gray-500">{tx.created_at}</span>
                    </li>
                ))}
            </ul>
        </div>
    )
}

export default Wallet
