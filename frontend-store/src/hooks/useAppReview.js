import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { apiFetch } from '../utils/apiFetch';

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
                // apiFetch (not raw fetch): sends the Bearer token AND the
                // HttpOnly session cookie. Cookie-only sessions (storefront
                // login stores no localStorage token) previously got 401 here
                // and the prompt never appeared.
                // The backend answers success_response({show, reason}) → the
                // flags live under data.data. Reading data.show (top level)
                // was always undefined, so the prompt NEVER fired.
                const res = await apiFetch('/app-review/should-prompt');
                if (res.ok) {
                    const data = await res.json();
                    const flags = data?.data || {};
                    if (flags.show) {
                        setPromptReason(flags.reason);
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
