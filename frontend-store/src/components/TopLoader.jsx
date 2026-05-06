import React, { useEffect, useState } from 'react';
import { useLoadingStore } from '../store/useLoadingStore';

const TopLoader = () => {
    const isLoading = useLoadingStore((state) => state.isLoading);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        let interval;
        let startTimeout;
        let finishTimeout;
        let resetTimeout;
        if (isLoading) {
            startTimeout = setTimeout(() => setProgress(10), 0);
            interval = setInterval(() => {
                setProgress((prev) => {
                    if (prev >= 90) return prev;
                    const increment = Math.random() * 5 + 1;
                    return Math.min(prev + increment, 90);
                });
            }, 300);
        } else {
            finishTimeout = setTimeout(() => {
                setProgress(100);
                resetTimeout = setTimeout(() => setProgress(0), 400);
            }, 0);
        }

        return () => {
            clearInterval(interval);
            clearTimeout(startTimeout);
            clearTimeout(finishTimeout);
            clearTimeout(resetTimeout);
        };
    }, [isLoading]);

    if (progress === 0) return null;

    return (
        <div className="fixed top-0 left-0 w-full h-1 z-[9999] pointer-events-none">
            <div
                className="h-full bg-primary transition-all duration-300 ease-out"
                style={{
                    width: `${progress}%`,
                    boxShadow: '0 0 10px rgba(16, 185, 129, 0.7)', // Emerald primary glow
                }}
            />
        </div>
    );
};

export default TopLoader;
