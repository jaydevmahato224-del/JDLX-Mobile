import { useEffect } from 'react'
import { useStore } from '../store/useStore'

const LocationManager = () => {
  const { setDeliveryMode, setNearestStoreId, setIsCheckingLocation } = useStore()

  useEffect(() => {
    setDeliveryMode('scheduled')
    setNearestStoreId(null)
    setIsCheckingLocation(false)
  }, [setDeliveryMode, setNearestStoreId, setIsCheckingLocation])

  return null
}

export default LocationManager
