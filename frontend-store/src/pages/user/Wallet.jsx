import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore'
import WalletPage from '../WalletPage'

// /profile/wallet route. The full wallet UI lives in pages/WalletPage.jsx —
// previously this file had its own second implementation (different endpoint,
// no styling) that could drift stale. It now reuses the shared component with
// its ORIGINAL data source (/user/wallet) so this route's behavior is
// unchanged; only the presentation is upgraded to match /wallet.
function Wallet() {
    const user = useStore(state => state.user);
    const navigate = useNavigate();

    useEffect(() => {
        if (!user) { navigate('/login'); }
    }, [user, navigate]);

    return <WalletPage endpoint="/user/wallet" />;
}

export default Wallet
