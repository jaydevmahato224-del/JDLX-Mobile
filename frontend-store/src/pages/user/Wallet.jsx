import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate } from 'react-router-dom'

function Wallet() {
    const token = useStore.getState().token;
    const user = useStore(state => state.user);
    const navigate = useNavigate();
    const [wallet, setWallet] = useState({ balance: 0, transactions: [] });
    const [amount, setAmount] = useState('');

    useEffect(() => {
        if (!user) { navigate('/login'); }
    }, [user, navigate]);

    const fetch = async () => {
        const res = await fetch(`${API_BASE_URL}/user/wallet`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) setWallet(await res.json());
    };
    useEffect(() => { fetch(); }, []);

    const credit = async e => {
        e.preventDefault();
        const res = await fetch(`${API_BASE_URL}/user/wallet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ amount: parseFloat(amount), type: 'credit' })
        });
        if (res.ok) {
            setAmount('');
            fetch();
        }
    };

    return (
        <div className="container-standard py-6">
            <h2 className="text-2xl font-bold mb-4">Wallet</h2>
            <div className="text-xl font-black mb-4">Balance: ₹{wallet.balance}</div>
            <form onSubmit={credit} className="flex gap-2">
                <input placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} className="input flex-1" />
                <button className="btn-primary">Add</button>
            </form>
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
