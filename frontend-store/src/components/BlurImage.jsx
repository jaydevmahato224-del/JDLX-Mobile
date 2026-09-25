/**
 * BlurImage Component
 * Displays images with blur-up effect for smooth loading experience.
 * Shows low-quality placeholder while image loads, transitions to full image.
 * On error, shows a premium dark-background text fallback instead of a broken icon.
 */

import { useState, useEffect, useRef, memo } from 'react'
import { mediaProxyUrl, markMediaProxyTried, hasMediaProxyBeenTried } from '../config'
import './BlurImage.css'

const BlurImageInner = memo(({ src, alt, className = '', containerClassName = '', onLoad, ...props }) => {
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [activeSrc, setActiveSrc] = useState(src)
  const imgRef = useRef(null)

  // Reset the retry chain whenever a different image is requested.
  useEffect(() => {
    setActiveSrc(src)
  }, [src])

  useEffect(() => {
    const img = imgRef.current
    if (!img) return

    const handleLoad = () => {
      setIsLoaded(true)
      onLoad?.()
    }

    const handleError = () => {
      // Cloud image hosts (Catbox etc.) are intermittently blocked or down.
      // Retry once through the backend's DB-backed media proxy before giving
      // up and showing the text fallback — the same bytes live in
      // uploaded_media and are served from our own origin.
      const proxySrc = mediaProxyUrl(src)
      if (proxySrc && !hasMediaProxyBeenTried(src)) {
        markMediaProxyTried(src)
        setIsLoaded(false)
        setActiveSrc(proxySrc)
        return
      }
      setHasError(true)
      setIsLoaded(true)
    }

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
  }, [activeSrc, src, onLoad])

  if (hasError) {
    return (
      <div
        className={`blur-image-error ${containerClassName}`}
        style={{
          backgroundColor: '#0D1B2A',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
        }}
        title={alt}
      >
        <span
          style={{
            color: 'rgba(255,255,255,0.75)',
            fontSize: '13px',
            fontWeight: '800',
            textAlign: 'center',
            fontFamily: 'Manrope, sans-serif',
            lineHeight: '1.3',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            wordBreak: 'break-word',
          }}
        >
          {alt || 'Product'}
        </span>
      </div>
    )
  }

  return (
    <div className={`blur-image-wrapper ${containerClassName}`}>
      {/* Placeholder shown while image loads */}
      <div
        className={`blur-image-placeholder ${isLoaded ? 'blur-image-hidden' : ''}`}
        style={{ backgroundColor: '#0D1B2A' }}
        aria-hidden="true"
      />

      {/* Actual image */}
      <img
        ref={imgRef}
        src={activeSrc}
        alt={alt}
        className={`blur-image ${isLoaded ? 'blur-image-loaded' : ''} ${className}`}
        loading="lazy"
        decoding="async"
        {...props}
      />
    </div>
  )
})

const BlurImage = memo((props) => {
  return <BlurImageInner key={props.src || 'blur-image'} {...props} />
})

export default BlurImage
