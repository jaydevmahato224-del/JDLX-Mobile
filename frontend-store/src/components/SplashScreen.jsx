import React, { useEffect, useRef, useState } from 'react'

const SplashScreen = ({ onFinish }) => {
  const videoRef = useRef(null)
  const [isVideoLoaded, setIsVideoLoaded] = useState(false)

  useEffect(() => {
    // 6 seconds max duration total
    const maxDurationTimeout = setTimeout(() => {
      onFinish()
    }, 6000)

    // 3 seconds load timeout - if video doesn't load/start in 3s, skip
    const loadTimeout = setTimeout(() => {
      if (!isVideoLoaded) {
        onFinish()
      }
    }, 3000)

    return () => {
      clearTimeout(maxDurationTimeout)
      clearTimeout(loadTimeout)
    }
  }, [onFinish, isVideoLoaded])

  const handleCanPlay = () => {
    setIsVideoLoaded(true)
    if (videoRef.current) {
      videoRef.current.play().catch(err => {
        console.error("Splash video autoplay failed:", err)
        onFinish() // Skip if it can't play
      })
    }
  }

  const handleEnded = () => {
    onFinish()
  }

  return (
    <div className="fixed inset-0 z-[10000] bg-black flex items-center justify-center overflow-hidden">
      <video
        ref={videoRef}
        src="/splash.mp4"
        className="w-full h-full object-cover"
        muted
        playsInline
        autoPlay
        onCanPlay={handleCanPlay}
        onEnded={handleEnded}
      />
    </div>
  )
}

export default SplashScreen
