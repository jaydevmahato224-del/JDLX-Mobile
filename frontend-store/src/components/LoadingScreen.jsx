import React, { useState, useEffect } from 'react';

/**
 * LoadingScreen.jsx
 * A redesigned, layout-stable loading component for JDLX Mobile.
 * Features: Fixed dimensions, smooth message crossfades, and brand-aligned animations.
 */
const LoadingScreen = () => {
  const messages = [
    "Fetching the best picks for you",
    "Almost there, hold tight",
    "Loading your customized portal",
    "Setting things up for you",
    "Just a moment"
  ];

  const [currentIdx, setCurrentIdx] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    let timeoutId;
    const intervalId = setInterval(() => {
      // Start fade out
      setIsVisible(false);
      
      timeoutId = setTimeout(() => {
        // Change text while invisible
        setCurrentIdx((prev) => (prev + 1) % messages.length);
        // Start fade in
        setIsVisible(true);
      }, 300); // Match this with CSS transition duration

    }, 2500);

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);  // FIX: Clear the timeout as well
    };
  }, [messages.length]);

  return (
    <div 
      className="fixed inset-0 flex items-center justify-center z-[9999]"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      {/* Keyframes for animations */}
      <style>
        {`
          @keyframes spin-arc {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes shimmer-progress {
            0% { width: 0%; opacity: 0.5; }
            50% { width: 70%; opacity: 1; }
            100% { width: 100%; opacity: 0.5; }
          }
          .animate-spin-arc {
            animation: spin-arc 1.2s linear infinite;
          }
          .animate-shimmer-progress {
            animation: shimmer-progress 2s ease-in-out infinite;
          }
        `}
      </style>

      {/* Main Loading Card */}
      <div 
        className="bg-[var(--color-surface-card)] rounded-[24px] shadow-[0_12px_40px_rgba(0,0,0,0.08)] flex flex-col items-center justify-between p-8"
        style={{ width: '280px', height: '320px', border: '1px solid var(--color-surface-high)' }}
      >
        {/* Logo Section */}
        <div className="relative flex items-center justify-center" style={{ width: '80px', height: '80px' }}>
          {/* Spinning Arc */}
          <div 
            className="absolute inset-0 rounded-full border-3 border-transparent animate-spin-arc"
            style={{ 
              borderTopColor: '#F5A623', 
              borderRightColor: '#F5A623',
              width: '80px',
              height: '80px'
            }}
          />
          
          {/* JD Core Circle */}
          <div 
            className="flex items-center justify-center rounded-[18px] shadow-lg"
            style={{ 
              width: '46px', 
              height: '46px', 
              background: 'linear-gradient(135deg, #1B2341 0%, #2A345E 100%)' 
            }}
          >
            <span 
              className="font-black text-[14px] tracking-wider"
              style={{ color: '#F5A623', fontFamily: 'system-ui, sans-serif' }}
            >
              JD
            </span>
          </div>
        </div>

        {/* Brand Branding */}
        <div className="flex items-baseline justify-center">
          <span 
            className="font-black text-[26px] tracking-tight"
            style={{ color: 'var(--color-on-surface)' }}
          >
            JDLX
          </span>
          <span 
            className="font-bold text-[13px] tracking-[0.18em] ml-2"
            style={{ color: 'var(--color-on-surface-variant)' }}
          >
            MOBILE
          </span>
        </div>

        {/* Message Section - Fixed height to prevent layout shifts */}
        <div 
          className="flex items-center justify-center w-full overflow-hidden"
          style={{ height: '48px' }}
        >
          <p 
            className="text-[13px] font-medium text-center truncate px-2 transition-opacity duration-300 ease-in-out"
            style={{ 
              color: 'var(--color-on-surface-variant)', 
              opacity: isVisible ? 1 : 0,
              maxWidth: '220px'
            }}
          >
            {messages[currentIdx]}
          </p>
        </div>

        {/* Progress Bar Section */}
        <div className="flex flex-col items-center w-full">
          <div 
            className="bg-[var(--color-surface-high)] rounded-full overflow-hidden relative"
            style={{ width: '160px', height: '3px' }}
          >
            <div 
              className="h-full bg-[#F5A623] rounded-full animate-shimmer-progress"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoadingScreen;
