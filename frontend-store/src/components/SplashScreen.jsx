import React, { useEffect, useRef, useState } from 'react'

const SplashScreen = ({ onFinish, dataReady }) => {
  const videoRef = useRef(null)
  const [isVideoLoaded, setIsVideoLoaded] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const [videoEnded, setVideoEnded] = useState(false)

  useEffect(() => {
    // 6 seconds max duration total
    const maxDurationTimeout = setTimeout(() => {
      onFinish()
    }, 6000)

    // 3 seconds load timeout - if video doesn't load/start in 3s, show fallback logo
    const loadTimeout = setTimeout(() => {
      if (!isVideoLoaded) {
        setVideoError(true)
      }
    }, 3000)

    return () => {
      clearTimeout(maxDurationTimeout)
      clearTimeout(loadTimeout)
    }
  }, [onFinish, isVideoLoaded])

  // BUG 2 FIX: In fallback mode, transition as soon as data is ready
  useEffect(() => {
    if (videoError && dataReady) {
      onFinish()
    }
  }, [videoError, dataReady, onFinish])

  const handleCanPlay = () => {
    setIsVideoLoaded(true)
    if (videoRef.current) {
      videoRef.current.play().catch(err => {
        console.error("Splash video autoplay failed:", err)
        setVideoError(true)
      })
    }
  }

  const handleEnded = () => {
    setVideoEnded(true)
    onFinish()
  }

  const handleError = () => {
    setVideoError(true)
  }

  return (
    <div className="fixed inset-0 z-[10000] bg-[#0a0a0c] flex flex-col items-center justify-center overflow-hidden">
      {!videoError ? (
        <>
          <video
            ref={videoRef}
            src="/splash.mp4"
            className={`w-full h-full object-cover transition-opacity duration-500 ${isVideoLoaded ? 'opacity-100' : 'opacity-0'}`}
            muted
            playsInline
            autoPlay
            onCanPlay={handleCanPlay}
            onEnded={handleEnded}
            onError={handleError}
          />
          {/* BUG 3 FIX: Show loader if video ends but data not ready */}
          {videoEnded && !dataReady && (
            <div className="absolute inset-0 bg-[#0a0a0c]/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-500">
              <div className="flex flex-col items-center gap-4">
                <div className="h-10 w-10 border-4 border-[#F5C518]/20 border-t-[#F5C518] rounded-full animate-spin" />
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#F5C518]">Synchronizing...</span>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center gap-4 animate-in fade-in duration-500">
          <div className="h-10 w-10 border-4 border-[#F5C518]/20 border-t-[#F5C518] rounded-full animate-spin" />
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#F5C518]">Loading...</span>
        </div>
      )}
    </div>
  )
}

export default SplashScreen
