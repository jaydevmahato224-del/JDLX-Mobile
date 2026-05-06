import { useState, useEffect } from 'react'
import { API_BASE_URL } from '../../config'
import { useStore } from '../../store/useStore'
import { useNavigate } from 'react-router-dom'

function Coupons() {
    const user = useStore(state => state.user);
    const navigate = useNavigate();

    useEffect(() => {
        if (!user) { navigate('/login'); }
    }, [user, navigate]);
    return (
        <div className="container-standard py-6">
            <h2 className="text-2xl font-bold mb-4">Coupons & Offers</h2>
            <p className="text-gray-500">You have no coupons at the moment.</p>
        </div>
    )
}

export default Coupons
