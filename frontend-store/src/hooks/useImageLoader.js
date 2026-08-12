/**
 * useImageLoader Hook
 * Handles lazy loading images with blur-up effect and placeholders
 */

import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * Generate a low-quality placeholder image (1x1 pixel placeholder color based on hash)
 * In production, you might use LQIP (Low Quality Image Placeholder) service
 */
const generatePlaceholderColor = (imageSrc) => {
  let hash = 0
  for (let i = 0; i < imageSrc.length; i++) {
    const char = imageSrc.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  const hue = Math.abs(hash % 360)
  return `hsl(${hue}, 70%, 80%)`
}

export const useImageLoader = () => {
  const [loadedImages, setLoadedImages] = useState(new Map())
  const imageObserverRef = useRef(null)

  /**
   * Initialize Intersection Observer for lazy loading
   */
  useEffect(() => {
    imageObserverRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const img = entry.target
            const src = img.dataset.src

            if (src && !img.src) {
              img.src = src
              imageObserverRef.current.unobserve(img)

              // Add loading class for transition
              img.classList.add('image-loading')

              // Handle load event
              img.onload = () => {
                img.classList.remove('image-loading')
                img.classList.add('image-loaded')
              }

              // Handle error
              img.onerror = () => {
                img.classList.remove('image-loading')
                img.classList.add('image-error')
              }
            }
          }
        })
      },
      {
        rootMargin: '50px',
        threshold: 0,
      }
    )

    return () => {
      if (imageObserverRef.current) {
        imageObserverRef.current.disconnect()
      }
    }
  }, [])

  /**
   * Register an image for lazy loading
   */
  const registerImage = useCallback(
    (imgElement, src, productId) => {
      if (!imgElement) return

      // Set data-src for later loading
      imgElement.dataset.src = src

      // Observe the element
      if (imageObserverRef.current) {
        imageObserverRef.current.observe(imgElement)
      }

      // Mark as loaded when image loads
      imgElement.onload = () => {
        setLoadedImages((prev) => new Map(prev).set(productId, true))
        imgElement.classList.remove('image-loading')
        imgElement.classList.add('image-loaded')
      }

      imgElement.onerror = () => {
        imgElement.classList.add('image-error')
      }
    },
    []
  )

  /**
   * Check if image is loaded
   */
  const isImageLoaded = useCallback(
    (productId) => {
      return loadedImages.get(productId) || false
    },
    [loadedImages]
  )

  /**
   * Preload multiple images eagerly (for critical viewport images)
   */
  const preloadImages = useCallback((imageUrls, callback) => {
    if (!imageUrls.length) {
      callback?.(true)
      return
    }

    let loadedCount = 0
    const totalCount = imageUrls.length

    imageUrls.forEach((url) => {
      const img = new Image()
      img.onload = () => {
        loadedCount++
        if (loadedCount === totalCount) {
          callback?.(true)
        }
      }
      img.onerror = () => {
        loadedCount++
        if (loadedCount === totalCount) {
          callback?.(true)
        }
      }
      img.src = url
    })
  }, [])

  /**
   * Prefetch images in idle time
   */
  const prefetchImages = useCallback((imageUrls) => {
    if (typeof window === 'undefined' || !('requestIdleCallback' in window)) {
      return
    }

    requestIdleCallback(() => {
      imageUrls.forEach((url) => {
        const link = document.createElement('link')
        link.rel = 'prefetch'
        link.as = 'image'
        link.href = url
        document.head.appendChild(link)
      })
    })
  }, [])

  return {
    loadedImages,
    registerImage,
    isImageLoaded,
    preloadImages,
    prefetchImages,
    generatePlaceholderColor,
  }
}

export default useImageLoader
