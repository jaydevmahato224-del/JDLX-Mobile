import { useEffect } from 'react'
import { useStore } from '../store/useStore'

const LocationManager = () => {
  const { setNearestStoreId, setIsCheckingLocation } = useStore()

  useEffect(() => {
    // (setDeliveryMode removed — quick delivery is retired; all orders use
    // standard scheduled fulfillment.)
    setNearestStoreId(null)
    setIsCheckingLocation(false)
  }, [setNearestStoreId, setIsCheckingLocation])

  return null
}

export default LocationManager
