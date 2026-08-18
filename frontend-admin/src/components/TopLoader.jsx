import React, { useEffect, useState } from 'react';
import { useLoadingStore } from '../store/useLoadingStore';

const TopLoader = () => {
    const isLoading = useLoadingStore((state) => state.isLoading);
    const [progress, setProgress] = useState(0);
    const [prevLoading, setPrevLoading] = useState(isLoading);

    // React-sanctioned "adjust state during render": jump the bar to 10% the
    // moment a load starts and complete it to 100% the moment it finishes.
    if (prevLoading !== isLoading) {
        setPrevLoading(isLoading);
        setProgress(isLoading ? 10 : 100);
    }

    useEffect(() => {
        if (isLoading) {
            const interval = setInterval(() => {
                setProgress((prev) => {
                    // Slowly trickle up to 90%
                    if (prev >= 90) return prev;
                    const increment = Math.random() * 5 + 1; // random jump between 1-6%
                    return Math.min(prev + increment, 90);
                });
            }, 300);
            return () => clearInterval(interval);
        }
        // Complete the progress bar fast, then hide after animation
        const timeout = setTimeout(() => setProgress(0), 400);
        return () => clearTimeout(timeout);
    }, [isLoading]);

    if (progress === 0) return null;

    return (
        <div className="fixed top-0 left-0 w-full h-1 z-[9999] pointer-events-none">
            <div
                className="h-full bg-blue-600 transition-all duration-300 ease-out"
                style={{
                    width: `${progress}%`,
                    boxShadow: '0 0 10px rgba(37, 99, 235, 0.7)', // Blue glow for admin
                }}
            />
        </div>
    );
};

export default TopLoader;
