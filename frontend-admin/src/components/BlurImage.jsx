/**
 * BlurImage Component
 * Displays images with blur-up effect for smooth loading experience
 * Shows low-quality placeholder while image loads, transitions to full image
 */

import { useState, useEffect, useRef } from 'react'
import './BlurImage.css'

function BlurImage({ src, alt, className = '', containerClassName = '', onLoad, ...props }) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [prevSrc, setPrevSrc] = useState(src)
  const imgRef = useRef(null)

  // Adjust state during render: whenever the image source changes, reset the
  // loaded/error flags so the blur-up placeholder shows again.
  if (prevSrc !== src) {
    setPrevSrc(src)
    setIsLoaded(false)
    setHasError(false)
  }

  // Generate placeholder color based on image URL
  const generatePlaceholderColor = () => {
    if (!src) return '#e0e0e0'
    let hash = 0
    for (let i = 0; i < src.length; i++) {
      const char = src.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash
    }
    const hue = Math.abs(hash % 360)
    return `hsl(${hue}, 70%, 80%)`
  }

  useEffect(() => {
    const img = imgRef.current
    if (!img) return

    // Handle image load
    const handleLoad = () => {
      setIsLoaded(true)
      onLoad?.()
    }

    // Handle error
    const handleError = () => {
      setHasError(true)
      setIsLoaded(true)
    }

    // If image is already cached in browser, it fires load immediately
    if (img.complete) {
      if (img.naturalHeight === 0) {
        handleError()
      } else {
        handleLoad()
      }
    } else {
      img.addEventListener('load', handleLoad)
      img.addEventListener('error', handleError)

      return () => {
        img.removeEventListener('load', handleLoad)
        img.removeEventListener('error', handleError)
      }
    }
  }, [src, onLoad])

  if (hasError) {
    return (
      <div
        className={`blur-image-error ${containerClassName}`}
        style={{ backgroundColor: generatePlaceholderColor() }}
        title={alt}
      >
        <svg className="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M3 3h18v18H3z" strokeWidth={2} strokeLinecap="round" />
          <path d="M15 9l-6 6M9 9l6 6" strokeWidth={2} strokeLinecap="round" />
        </svg>
      </div>
    )
  }

  return (
    <div className={`blur-image-wrapper ${containerClassName}`}>
      {/* Placeholder/Blur image shown while loading */}
      <div
        className={`blur-image-placeholder ${isLoaded ? 'blur-image-hidden' : ''}`}
        style={{ backgroundColor: generatePlaceholderColor() }}
        aria-hidden="true"
      />

      {/* Actual image */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={`blur-image ${isLoaded ? 'blur-image-loaded' : ''} ${className}`}
        loading="lazy"
        decoding="async"
        {...props}
      />
    </div>
  )
}

export default BlurImage
