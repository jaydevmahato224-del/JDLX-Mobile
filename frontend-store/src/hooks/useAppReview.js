import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { API_BASE_URL } from '../config';

export function useAppReview() {
    const user = useStore(state => state.user);
    const token = useStore.getState().token;
    const [showPrompt, setShowPrompt] = useState(false);
    const [promptReason, setPromptReason] = useState(null);

    useEffect(() => {
        // --- DEVELOPMENT BYPASS ---
        if (import.meta.env.DEV) {
            const params = new URLSearchParams(window.location.search);
            if (params.get('test_review') === 'true') {
                setPromptReason('dev_test');
                setShowPrompt(true);
                return;
            }
        }
        // --------------------------

        // Only run if user is logged in
        if (!user || !token) return;

        // Check if PWA is installed (display-mode: standalone)
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
        if (!isStandalone) {
            // Check for navigator.standalone (iOS)
            const isIOSStandalone = window.navigator.standalone === true;
            if (!isIOSStandalone) return;
        }

        // Check localStorage as backup
        const shownInLocal = localStorage.getItem('jdlx_review_shown');
        if (shownInLocal) return;

        const checkEligibility = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/app-review/should-prompt`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.show) {
                        setPromptReason(data.reason);
                        // Wait 3 seconds before showing as per requirements
                        const timer = setTimeout(() => {
                            setShowPrompt(true);
                        }, 3000);
                        return () => clearTimeout(timer);
                    }
                }
            } catch (err) {
                // Fail silently as per requirements
                console.error('Error checking app review eligibility:', err);
            }
        };

        checkEligibility();
    }, [user, token]);

    const dismissPrompt = () => {
        setShowPrompt(false);
        localStorage.setItem('jdlx_review_shown', 'true');
    };

    return { showPrompt, promptReason, dismissPrompt };
}
