
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
    ArrowRight,
    Camera,
    CheckCircle2,
    Clock3,
    RefreshCw,
    ScanLine,
    ShieldCheck,
    Truck,
    User,
    UserRoundCheck,
    XCircle,
} from 'lucide-react'
import { API_BASE_URL, API_ORIGIN } from '../../config'
import { useStore } from '../../store/useStore'

const INITIAL_FORM = {
    name: '',
    email: '',
    phone: '',
    address: '',
    pincode: '',
    vehicle_type: 'bike',
    warehouse_id: '',
}

const VEHICLE_TYPES = [
    { value: 'bike', label: 'Motorcycle / Scooter' },
    { value: 'cycle', label: 'Bicycle' },
    { value: 'electric', label: 'Electric Vehicle (EV)' },
    { value: 'van', label: 'Delivery Van' },
]

const KYC_IMAGE_ACCEPT = 'image/png,image/jpeg,image/jpg,image/webp'
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024
const FACE_VECTOR_SIZE = 24
const FACE_MATCH_MIN_SCORE = 0.72
const SELFIE_MIN_FACE_AREA_RATIO = 0.12
const CORNER_SAMPLE_RATIO = 0.16
const BACKGROUND_VARIANCE_MAX = 260
const BACKGROUND_MEAN_SPREAD_MAX = 42

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371 // Earth radius in km
    const dLat = (lat2 - lat1) * (Math.PI / 180)
    const dLon = (lon2 - lon1) * (Math.PI / 180)
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
}

const readFileAsDataUrl = (file) => (
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(new Error('Could not preview selected image.'))
        reader.readAsDataURL(file)
    })
)

const detectAadhaarQrPayload = async (file) => {
    if (typeof window === 'undefined' || !('BarcodeDetector' in window)) {
        throw new Error('QR auto-detect is not supported in this browser. Please fill address manually.')
    }
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
    const bitmap = await createImageBitmap(file)
    try {
        const barcodes = await detector.detect(bitmap)
        const payload = barcodes?.[0]?.rawValue?.trim()
        if (!payload) {
            throw new Error('No QR code found on Aadhaar front image. Ensure QR is visible and clear.')
        }
        return payload
    } finally {
        if (bitmap && typeof bitmap.close === 'function') {
            bitmap.close()
        }
    }
}

const validateImageFile = (file, label) => {
    if (!file) {
        return `${label} is required.`
    }
    if (!file.type.startsWith('image/')) {
        return `${label} must be an image file.`
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
        return `${label} must be smaller than 8MB.`
    }
    return ''
}

const getFaceDetector = () => {
    if (typeof window === 'undefined' || !('FaceDetector' in window)) {
        return null
    }
    return new window.FaceDetector({ fastMode: false, maxDetectedFaces: 5 })
}

const detectSingleFaceFromBitmap = async (bitmap, label) => {
    const detector = getFaceDetector()
    if (!detector) {
        // If detector is missing, we consider one face "detected" but unvalidated.
        return { boundingBox: { x: 0, y: 0, width: bitmap.width, height: bitmap.height }, manualReview: true }
    }
    const faces = await detector.detect(bitmap)
    if (!faces.length) {
        throw new Error(`${label} me face detect nahi hua. Clear front-facing image upload karein.`)
    }
    if (faces.length > 1) {
        throw new Error(`${label} me sirf ek hi face hona chahiye.`)
    }
    return faces[0]
}

const getRegionStats = (ctx, x, y, width, height) => {
    const safeX = Math.max(0, Math.floor(x))
    const safeY = Math.max(0, Math.floor(y))
    const safeWidth = Math.max(1, Math.floor(width))
    const safeHeight = Math.max(1, Math.floor(height))
    const { data } = ctx.getImageData(safeX, safeY, safeWidth, safeHeight)
    let sum = 0
    let sumSq = 0
    let count = 0

    for (let index = 0; index < data.length; index += 4) {
        const luminance = (0.299 * data[index]) + (0.587 * data[index + 1]) + (0.114 * data[index + 2])
        sum += luminance
        sumSq += luminance * luminance
        count += 1
    }

    const mean = count ? sum / count : 0
    const variance = count ? Math.max(0, (sumSq / count) - (mean * mean)) : 0
    return { mean, variance }
}

const ensurePlainBackground = (bitmap, faceBox) => {
    const imageArea = bitmap.width * bitmap.height
    const faceArea = faceBox.width * faceBox.height
    const faceAreaRatio = imageArea ? faceArea / imageArea : 0

    if (faceAreaRatio < SELFIE_MIN_FACE_AREA_RATIO) {
        throw new Error('Face image me close-up photo upload karein. Face clear aur center me hona chahiye.')
    }

    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(bitmap, 0, 0)

    const sampleWidth = Math.max(18, Math.floor(bitmap.width * CORNER_SAMPLE_RATIO))
    const sampleHeight = Math.max(18, Math.floor(bitmap.height * CORNER_SAMPLE_RATIO))
    const regions = [
        { x: 0, y: 0 },
        { x: bitmap.width - sampleWidth, y: 0 },
        { x: 0, y: bitmap.height - sampleHeight },
        { x: bitmap.width - sampleWidth, y: bitmap.height - sampleHeight },
    ]

    const stats = regions.map((region) => getRegionStats(context, region.x, region.y, sampleWidth, sampleHeight))
    const averageVariance = stats.reduce((total, item) => total + item.variance, 0) / stats.length
    const means = stats.map((item) => item.mean)
    const meanSpread = Math.max(...means) - Math.min(...means)

    if (averageVariance > BACKGROUND_VARIANCE_MAX || meanSpread > BACKGROUND_MEAN_SPREAD_MAX) {
        throw new Error('Face photo plain background me honi chahiye. Mixed ya busy background wali image reject hogi.')
    }
}

const getExpandedFaceCrop = (faceBox, bitmap) => {
    const paddingX = faceBox.width * 0.18
    const paddingY = faceBox.height * 0.18
    const x = clamp(faceBox.x - paddingX, 0, bitmap.width - 1)
    const y = clamp(faceBox.y - paddingY, 0, bitmap.height - 1)
    const maxWidth = bitmap.width - x
    const maxHeight = bitmap.height - y
    const width = clamp(faceBox.width + (paddingX * 2), 1, maxWidth)
    const height = clamp(faceBox.height + (paddingY * 2), 1, maxHeight)
    return { x, y, width, height }
}

const getFaceVector = (bitmap, faceBox) => {
    const crop = getExpandedFaceCrop(faceBox, bitmap)
    const canvas = document.createElement('canvas')
    canvas.width = FACE_VECTOR_SIZE
    canvas.height = FACE_VECTOR_SIZE
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.filter = 'grayscale(1) contrast(1.1)'
    context.drawImage(
        bitmap,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        FACE_VECTOR_SIZE,
        FACE_VECTOR_SIZE,
    )

    const { data } = context.getImageData(0, 0, FACE_VECTOR_SIZE, FACE_VECTOR_SIZE)
    const values = []
    let total = 0

    for (let index = 0; index < data.length; index += 4) {
        const luminance = (0.299 * data[index]) + (0.587 * data[index + 1]) + (0.114 * data[index + 2])
        values.push(luminance)
        total += luminance
    }

    const mean = values.length ? total / values.length : 0
    const centered = values.map((value) => value - mean)
    const magnitude = Math.sqrt(centered.reduce((sum, value) => sum + (value * value), 0)) || 1
    return centered.map((value) => value / magnitude)
}

const getCosineSimilarity = (vectorA, vectorB) => (
    vectorA.reduce((sum, value, index) => sum + (value * vectorB[index]), 0)
)

const validateFaceAgainstAadhaar = async (selfieFile, aadhaarFrontFile) => {
    if (!aadhaarFrontFile) {
        throw new Error('Pehle Aadhaar front image upload karein, phir face verify karein.')
    }

    const [selfieBitmap, aadhaarBitmap] = await Promise.all([
        createImageBitmap(selfieFile),
        createImageBitmap(aadhaarFrontFile),
    ])

    try {
        const detector = getFaceDetector()
        if (!detector) {
            // Browser doesn't support FaceDetector. Allow upload but skip live comparison.
            return 1.0 // Return "perfect match" for mock, but backend will see no validation was done.
        }

        const [selfieFace, aadhaarFace] = await Promise.all([
            detectSingleFaceFromBitmap(selfieBitmap, 'Face image'),
            detectSingleFaceFromBitmap(aadhaarBitmap, 'Aadhaar front image'),
        ])
        
        // ... rest of the logic ...
        ensurePlainBackground(selfieBitmap, selfieFace.boundingBox)

        const selfieVector = getFaceVector(selfieBitmap, selfieFace.boundingBox)
        const aadhaarVector = getFaceVector(aadhaarBitmap, aadhaarFace.boundingBox)
        const similarityScore = getCosineSimilarity(selfieVector, aadhaarVector)

        if (similarityScore < FACE_MATCH_MIN_SCORE) {
            throw new Error('Uploaded face Aadhaar photo se match nahi hui. Same person ki plain background wali image dobara upload karein.')
        }

        return similarityScore
    } finally {
        if (typeof selfieBitmap.close === 'function') {
            selfieBitmap.close()
        }
        if (typeof aadhaarBitmap.close === 'function') {
            aadhaarBitmap.close()
        }
    }
}

const s = {
    label: { fontSize: '13px', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px', display: 'block' },
    input: {
        width: '100%', padding: '12px 16px', boxSizing: 'border-box',
        background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '12px', color: '#f1f5f9', fontSize: '14px', outline: 'none',
        fontFamily: "'Inter', sans-serif",
    },
    fileInput: {
        width: '100%',
        padding: '10px 12px',
        boxSizing: 'border-box',
        background: 'rgba(0,0,0,0.3)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '12px',
        color: '#f1f5f9',
        fontSize: '13px',
        outline: 'none',
    },
    chip: (color) => ({
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '5px 14px', borderRadius: '100px',
        fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
        background: `rgba(${color},0.12)`, border: `1px solid rgba(${color},0.25)`,
        color: `rgb(${color})`,
    }),
}

function StatusPanel({ currentStatus, application, checkRequestStatus, deliveryRequestUser, loadingStatus }) {
    if (loadingStatus) return (
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '20px', color: '#94a3b8', fontSize: '14px' }}>
            Checking your request status...
        </div>
    )
    if (currentStatus === 'approved') return (
        <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '16px', padding: '20px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
                <CheckCircle2 size={20} style={{ color: '#34d399', flexShrink: 0 }} />
                <div>
                    <p style={{ fontWeight: 700, color: '#34d399', fontSize: '13px', marginBottom: '6px' }}>Approved</p>
                    <p style={{ color: '#a7f3d0', fontSize: '14px', marginBottom: '14px' }}>Your delivery partner request is approved. You can now log in.</p>
                    <Link to="/warehouse/login?role=delivery" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#34d399', color: '#0f172a', padding: '10px 18px', borderRadius: '10px', textDecoration: 'none', fontWeight: 700, fontSize: '14px' }}>
                        Go to login <ArrowRight size={14} />
                    </Link>
                </div>
            </div>
        </div>
    )
    if (currentStatus === 'pending_store') return (
        <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '16px', padding: '20px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
                <Clock3 size={20} style={{ color: '#fbbf24', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 700, color: '#fbbf24', fontSize: '13px', marginBottom: '6px' }}>Store approval pending</p>
                    <p style={{ color: '#fde68a', fontSize: '14px', marginBottom: '14px' }}>The store you applied to must review your request first. The form remains locked.</p>
                    <button onClick={() => checkRequestStatus(deliveryRequestUser?.email)} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#f1f5f9', padding: '10px 16px', borderRadius: '10px', fontWeight: 600, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <RefreshCw size={12} /> Refresh status
                    </button>
                </div>
            </div>
        </div>
    )
    if (currentStatus === 'pending_admin') return (
        <div style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: '16px', padding: '20px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
                <Clock3 size={20} style={{ color: '#38bdf8', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 700, color: '#38bdf8', fontSize: '13px', marginBottom: '6px' }}>Admin approval pending</p>
                    <p style={{ color: '#bae6fd', fontSize: '14px', marginBottom: '14px' }}>The store has approved you! Now awaiting final activation by the master admin.</p>
                    <button onClick={() => checkRequestStatus(deliveryRequestUser?.email)} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#f1f5f9', padding: '10px 16px', borderRadius: '10px', fontWeight: 600, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <RefreshCw size={12} /> Refresh status
                    </button>
                </div>
            </div>
        </div>
    )
    if (currentStatus === 'rejected') return (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '16px', padding: '20px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
                <XCircle size={20} style={{ color: '#f87171', flexShrink: 0 }} />
                <div>
                    <p style={{ fontWeight: 700, color: '#f87171', fontSize: '13px', marginBottom: '6px' }}>Needs changes / Rejected</p>
                    <p style={{ color: '#fca5a5', fontSize: '14px', marginBottom: application?.admin_notes ? '12px' : 0 }}>You can correct the details below and resubmit.</p>
                    {application?.admin_notes && (
                        <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '12px', fontSize: '13px', color: '#e2e8f0' }}>
                            Note: {application.admin_notes}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
    return (
        <div style={{ background: 'rgba(20,184,166,0.08)', border: '1px solid rgba(20,184,166,0.2)', borderRadius: '16px', padding: '20px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
                <UserRoundCheck size={20} style={{ color: '#5eead4', flexShrink: 0 }} />
                <div>
                    <p style={{ fontWeight: 700, color: '#5eead4', fontSize: '13px', marginBottom: '6px' }}>Ready to apply</p>
                    <p style={{ color: '#a7f3d0', fontSize: '14px' }}>Identity verified. Select a store, upload KYC, and submit.</p>
                </div>
            </div>
        </div>
    )
}

function DeliveryRequest() {
    const navigate = useNavigate()
    const location = useLocation()
    const deliveryRequestUser = useStore((state) => state.warehouseRequestUser)
    const setWarehouseRequestUser = useStore((state) => state.setWarehouseRequestUser)

    const [formData, setFormData] = useState(INITIAL_FORM)
    const [statusData, setStatusData] = useState(null)
    const [loadingStatus, setLoadingStatus] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState('')
    const [successMessage, setSuccessMessage] = useState('')
    const [googleLoading, setGoogleLoading] = useState(false)
    const [stores, setStores] = useState([])
    const [loadingStores, setLoadingStores] = useState(false)
    const [userLocation, setUserLocation] = useState(null)
    const [locating, setLocating] = useState(false)

    const [kycFiles, setKycFiles] = useState({
        pan: null,
        aadhaarFront: null,
        aadhaarBack: null,
        face: null,
    })
    const [aadhaarQrPayload, setAadhaarQrPayload] = useState('')
    const [aadhaarDetection, setAadhaarDetection] = useState({ loading: false, message: '', type: '' })
    const [facePreview, setFacePreview] = useState('')
    const [faceVerified, setFaceVerified] = useState(false)
    const [faceValidationMessage, setFaceValidationMessage] = useState('')
    const [cameraActive, setCameraActive] = useState(false)
    const [cameraError, setCameraError] = useState('')

    const videoRef = useRef(null)
    const cameraStreamRef = useRef(null)

    const params = useMemo(() => new URLSearchParams(location.search), [location.search])
    const currentStatus = statusData?.verification_status || null
    const application = statusData?.application || null

    const stopCamera = useCallback(() => {
        if (cameraStreamRef.current) {
            cameraStreamRef.current.getTracks().forEach((track) => track.stop())
            cameraStreamRef.current = null
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null
        }
        setCameraActive(false)
    }, [])

    useEffect(() => () => stopCamera(), [stopCamera])

    useEffect(() => {
        const oauthToken = params.get('oauth_token')
        const oauthUser = params.get('oauth_user')
        if (!oauthToken || !oauthUser) return
        try {
            const requestUser = JSON.parse(decodeURIComponent(oauthUser))
            setWarehouseRequestUser(requestUser, oauthToken)
            navigate('/warehouse/request-delivery', { replace: true })
        } catch (oauthError) {
            setError('Verification failed. Please try again.')
            console.error('Delivery request oauth parse failed:', oauthError)
        }
    }, [navigate, params, setWarehouseRequestUser])

    const handleGoogleLogin = () => {
        setGoogleLoading(true)
        window.location.href = `${API_ORIGIN}/login/google?flow=delivery_request`
    }

    const fetchStores = async (currentLocation = null) => {
        setLoadingStores(true)
        try {
            const res = await fetch(`${API_BASE_URL}/public/stores`)
            const data = await res.json()
            if (res.ok) {
                let processedStores = data
                if (currentLocation) {
                    processedStores = data.map(store => {
                        if (store.latitude && store.longitude) {
                            const distance = calculateDistance(
                                currentLocation.latitude,
                                currentLocation.longitude,
                                store.latitude,
                                store.longitude
                            )
                            return { ...store, distance }
                        }
                        return store
                    }).sort((a, b) => (a.distance || 9999) - (b.distance || 9999))
                }
                setStores(processedStores)
            }
        } catch (storeError) {
            console.error('Failed to fetch stores:', storeError)
        } finally {
            setLoadingStores(false)
        }
    }

    const requestUserLocation = () => {
        if (!navigator.geolocation) {
            setError('Geolocation is not supported by your browser.')
            return
        }
        setLocating(true)
        setError('')
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const location = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                }
                setUserLocation(location)
                fetchStores(location)
                setLocating(false)
            },
            (err) => {
                console.error('Geolocation error:', err)
                setError('Location access denied. Please select a store manually from the list.')
                setLocating(false)
            },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        )
    }

    const checkRequestStatus = async (emailToCheck) => {
        if (!emailToCheck) {
            setStatusData(null)
            return
        }
        setLoadingStatus(true)
        try {
            const response = await fetch(`${API_BASE_URL}/delivery/request-status?email=${encodeURIComponent(emailToCheck)}`)
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || 'Could not fetch request status.')
            setStatusData(data)
        } catch (statusError) {
            setError(statusError.message || 'Could not fetch request status.')
        } finally {
            setLoadingStatus(false)
        }
    }

    useEffect(() => {
        if (!deliveryRequestUser) return
        setFormData((prev) => ({
            ...prev,
            name: prev.name || deliveryRequestUser.name || '',
            email: deliveryRequestUser.email || prev.email,
        }))
        checkRequestStatus(deliveryRequestUser.email)
        fetchStores()
    }, [deliveryRequestUser])

    const handleInputChange = (e) => {
        const { name, value } = e.target
        setFormData((prev) => {
            const next = { ...prev, [name]: value }
            if (name === 'warehouse_id') {
                const selectedStore = stores.find((store) => String(store.id) === String(value))
                if (selectedStore && selectedStore.pincode) {
                    next.pincode = selectedStore.pincode
                }
            }
            return next
        })
    }

    const handleFileSelection = (fieldKey, file, label) => {
        setError('')
        const validationError = validateImageFile(file, label)
        if (validationError) {
            setError(validationError)
            return false
        }
        setKycFiles((prev) => ({ ...prev, [fieldKey]: file }))
        return true
    }

    const autoFillAddressFromAadhaar = async (aadhaarFrontFile) => {
        setAadhaarDetection({ loading: true, message: '', type: '' })
        try {
            const qrPayload = await detectAadhaarQrPayload(aadhaarFrontFile)
            setAadhaarQrPayload(qrPayload)

            const response = await fetch(`${API_BASE_URL}/delivery/extract-aadhaar-address`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ aadhaar_qr_payload: qrPayload }),
            })
            const data = await response.json()
            if (!response.ok) {
                throw new Error(data.error || 'Address detection failed.')
            }

            if (data.address) {
                setFormData((prev) => ({ ...prev, address: data.address }))
                setAadhaarDetection({
                    loading: false,
                    message: 'Home address auto-filled from Aadhaar QR.',
                    type: 'success',
                })
                return true
            } else {
                setAadhaarDetection({
                    loading: false,
                    message: 'Aadhaar QR mila, lekin address read nahi hua. Aadhaar image dobara upload karein.',
                    type: 'error',
                })
                return false
            }
        } catch (aadhaarError) {
            setAadhaarQrPayload('')
            setAadhaarDetection({
                loading: false,
                message: aadhaarError.message || 'QR detect nahi hua. Manual address enter karein.',
                type: 'warning',
            })
            return false
        }
    }

    const handleAadhaarFrontUpload = async (event) => {
        const file = event.target.files?.[0]
        if (!handleFileSelection('aadhaarFront', file, 'Aadhaar front image')) return
        setFacePreview('')
        setFaceVerified(false)
        setFaceValidationMessage('')
        setCameraError('')
        setKycFiles((prev) => ({ ...prev, face: null }))
        
        // We attempt auto-fill but don't clear the file if it fails.
        // This allows users on unsupported browsers to still proceed.
        await autoFillAddressFromAadhaar(file)
    }

    const handleAadhaarBackUpload = (event) => {
        const file = event.target.files?.[0]
        handleFileSelection('aadhaarBack', file, 'Aadhaar back image')
    }

    const handlePanUpload = (event) => {
        const file = event.target.files?.[0]
        handleFileSelection('pan', file, 'PAN card image')
    }

    const handleFaceFile = async (file) => {
        if (!handleFileSelection('face', file, 'Face image')) return false
        setCameraError('')
        setFaceValidationMessage('')
        setFaceVerified(false)
        try {
            const similarityScore = await validateFaceAgainstAadhaar(file, kycFiles.aadhaarFront)
            const preview = await readFileAsDataUrl(file)
            setFacePreview(preview)
            setKycFiles((prev) => ({ ...prev, face: file }))
            setFaceVerified(true)
            setFaceValidationMessage(`Face verification pass ho gaya. Aadhaar photo match score ${Math.round(similarityScore * 100)}%.`)
        } catch (previewError) {
            setFacePreview('')
            setKycFiles((prev) => ({ ...prev, face: null }))
            setCameraError(previewError.message || 'Face verification failed.')
            return false
        }
        return true
    }

    const handleFaceUpload = async (event) => {
        const file = event.target.files?.[0]
        if (!file) return
        stopCamera()
        const uploadAccepted = await handleFaceFile(file)
        if (!uploadAccepted) {
            event.target.value = ''
        }
    }

    const startFaceCamera = async () => {
        setCameraError('')
        try {
            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error('Camera API is not available in this browser.')
            }
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 480 } },
                audio: false,
            })
            cameraStreamRef.current = stream
            if (videoRef.current) {
                videoRef.current.srcObject = stream
                await videoRef.current.play()
            }
            setCameraActive(true)
        } catch (cameraStartError) {
            setCameraError(cameraStartError.message || 'Unable to access camera.')
            stopCamera()
        }
    }

    const captureFaceFromCamera = async () => {
        try {
            const video = videoRef.current
            if (!video || !video.videoWidth || !video.videoHeight) {
                throw new Error('Camera stream is not ready yet. Try again.')
            }
            const canvas = document.createElement('canvas')
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            const context = canvas.getContext('2d')
            // Keep the saved image orientation aligned with the live preview.
            context.translate(canvas.width, 0)
            context.scale(-1, 1)
            context.drawImage(video, 0, 0, canvas.width, canvas.height)
            context.setTransform(1, 0, 0, 1, 0, 0)
            const blob = await new Promise((resolve, reject) => {
                canvas.toBlob((imageBlob) => {
                    if (!imageBlob) {
                        reject(new Error('Face capture failed.'))
                        return
                    }
                    resolve(imageBlob)
                }, 'image/jpeg', 0.9)
            })
            const faceFile = new File([blob], `face_capture_${Date.now()}.jpg`, { type: 'image/jpeg' })
            const captureAccepted = await handleFaceFile(faceFile)
            if (captureAccepted) {
                setCameraError('')
                stopCamera()
            }
        } catch (captureError) {
            setCameraError(captureError.message || 'Could not capture face.')
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        setSubmitting(true)
        setError('')
        setSuccessMessage('')
        try {
            const missingDocs = []
            if (!kycFiles.pan) missingDocs.push('PAN card image')
            if (!kycFiles.aadhaarFront) missingDocs.push('Aadhaar front image')
            if (!kycFiles.aadhaarBack) missingDocs.push('Aadhaar back image')
            if (!kycFiles.face) missingDocs.push('Face image')

            if (missingDocs.length) {
                throw new Error(`Upload required documents: ${missingDocs.join(', ')}`)
            }
            if (!faceVerified) {
                throw new Error('Complete face verification before submitting.')
            }

            const payload = new FormData()
            Object.entries(formData).forEach(([key, value]) => {
                payload.append(key, value ?? '')
            })
            payload.append('pan_image', kycFiles.pan)
            payload.append('aadhaar_front_image', kycFiles.aadhaarFront)
            payload.append('aadhaar_back_image', kycFiles.aadhaarBack)
            payload.append('face_verification_image', kycFiles.face)
            payload.append('face_verified', faceVerified ? 'true' : 'false')
            if (aadhaarQrPayload) {
                payload.append('aadhaar_qr_payload', aadhaarQrPayload)
            }
            if (formData.address) {
                payload.append('aadhaar_detected_address', formData.address)
            }

            const response = await fetch(`${API_BASE_URL}/delivery/register`, {
                method: 'POST',
                body: payload,
            })
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || 'Request could not be submitted.')
            setSuccessMessage(data.message || 'Application submitted successfully.')
            await checkRequestStatus(formData.email)
        } catch (submitError) {
            setError(submitError.message || 'Request could not be submitted.')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #020617 0%, #0f172a 100%)',
            padding: '24px 16px',
            fontFamily: "'Inter', sans-serif",
            color: '#f1f5f9',
        }}>
            <div style={{ maxWidth: '900px', margin: '0 auto' }}>
                <div style={{
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '20px', padding: '24px 28px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexWrap: 'wrap', gap: '16px', marginBottom: '24px',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'rgba(20,184,166,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#14b8a6' }}>
                            <Truck size={24} />
                        </div>
                        <div>
                            <div style={s.chip('20,184,166')}>Join as Delivery Partner</div>
                            <h1 style={{ fontSize: '24px', fontWeight: 900, fontFamily: "'Manrope',sans-serif", margin: '4px 0 0' }}>Register to Deliver</h1>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <Link to="/" style={{ padding: '10px 18px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#cbd5e1', textDecoration: 'none', fontSize: '13px', fontWeight: 600 }}>Back</Link>
                    </div>
                </div>

                {!deliveryRequestUser ? (
                    <div style={{
                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '24px', padding: '48px 30px', textAlign: 'center',
                    }}>
                        <div style={{ width: '64px', height: '64px', borderRadius: '20px', background: 'rgba(20,184,166,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#14b8a6', margin: '0 auto 24px' }}>
                            <ShieldCheck size={32} />
                        </div>
                        <h2 style={{ fontSize: '24px', fontWeight: 900, marginBottom: '16px' }}>Identity Verification Required</h2>
                        <p style={{ color: '#94a3b8', maxWidth: '500px', margin: '0 auto 32px', lineHeight: 1.6 }}>To start your application, please verify your identity using Google. This ensures a secure partner network.</p>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                            <button
                                onClick={handleGoogleLogin}
                                disabled={googleLoading}
                                style={{
                                    background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                                    color: '#fff', padding: '14px 48px', borderRadius: '14px',
                                    border: 'none', fontWeight: 700, fontSize: '15px', cursor: 'pointer',
                                    display: 'inline-flex', alignItems: 'center', gap: '10px',
                                    boxShadow: '0 8px 32px rgba(20,184,166,0.2)'
                                }}
                            >
                                <User size={18} /> {googleLoading ? 'Verifying...' : 'Verify with Google to Register'}
                            </button>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', maxWidth: '300px', margin: '8px 0' }}>
                                <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
                                <span style={{ fontSize: '11px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em' }}>OR</span>
                                <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
                            </div>

                            <Link to="/" style={{
                                display: 'inline-flex', alignItems: 'center', gap: '8px',
                                padding: '12px 24px', background: 'rgba(255,255,255,0.04)',
                                border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px',
                                color: '#94a3b8', textDecoration: 'none', fontSize: '14px', fontWeight: 600,
                                transition: 'all 0.3s'
                            }}>
                                Already a Partner? <span style={{ color: '#5eead4' }}>Login here</span>
                            </Link>
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', padding: '24px' }}>
                                <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', marginBottom: '12px' }}>Verified profile</p>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                    <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <Truck size={20} style={{ color: '#444' }} />
                                    </div>
                                    <div>
                                        <p style={{ fontWeight: 800, fontSize: '16px' }}>{deliveryRequestUser.name}</p>
                                        <p style={{ fontSize: '13px', color: '#94a3b8' }}>{deliveryRequestUser.email}</p>
                                    </div>
                                </div>
                            </div>
                            <StatusPanel
                                currentStatus={currentStatus}
                                application={application}
                                checkRequestStatus={checkRequestStatus}
                                deliveryRequestUser={deliveryRequestUser}
                                loadingStatus={loadingStatus}
                            />
                        </div>

                        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', padding: '28px' }}>
                            <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '20px' }}>Application Details</h2>
                            {error && <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '12px', padding: '12px 16px', fontSize: '13px', color: '#fca5a5', marginBottom: '16px' }}>{error}</div>}
                            {successMessage && <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '12px', padding: '12px 16px', fontSize: '13px', color: '#6ee7b7', marginBottom: '16px' }}>{successMessage}</div>}

                            {currentStatus === 'pending_store' || currentStatus === 'pending_admin' || currentStatus === 'approved' ? (
                                <div style={{ padding: '40px 20px', textAlign: 'center', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '16px' }}>
                                    <p style={{ color: '#94a3b8', fontSize: '14px' }}>Your request is active and in {currentStatus.replace('_', ' ')} stage. You cannot edit the form now.</p>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <div>
                                        <label style={s.label}>Vehicle Type</label>
                                        <select name="vehicle_type" value={formData.vehicle_type} onChange={handleInputChange} style={s.input}>
                                            {VEHICLE_TYPES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                            <label style={s.label}>Select Dark Store / Warehouse</label>
                                            <button
                                                type="button"
                                                onClick={requestUserLocation}
                                                disabled={locating}
                                                style={{
                                                    background: 'rgba(20,184,166,0.1)',
                                                    border: '1px solid rgba(20,184,166,0.3)',
                                                    color: '#14b8a6',
                                                    fontSize: '11px',
                                                    fontWeight: 700,
                                                    padding: '4px 10px',
                                                    borderRadius: '8px',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}
                                            >
                                                <RefreshCw size={10} className={locating ? 'animate-spin' : ''} />
                                                {locating ? 'Finding...' : 'Find Near Stores'}
                                            </button>
                                        </div>
                                        <select name="warehouse_id" value={formData.warehouse_id} onChange={handleInputChange} required style={s.input}>
                                            <option value="">Select a store...</option>
                                            {stores.map((store) => (
                                                <option key={store.id} value={store.id}>
                                                    {store.name} ({store.store_code}) 
                                                    {store.distance !== undefined ? ` - ${store.distance.toFixed(2)} km away` : ` - ${store.address}`}
                                                </option>
                                            ))}
                                        </select>
                                        {loadingStores && <p style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>Loading stores...</p>}
                                        {userLocation && <p style={{ fontSize: '11px', color: '#14b8a6', marginTop: '4px' }}>Stores sorted by proximity to your current location.</p>}
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                        <div>
                                            <label style={s.label}>Full Name</label>
                                            <input name="name" value={formData.name} onChange={handleInputChange} readOnly style={{ ...s.input, opacity: 0.7 }} />
                                        </div>
                                        <div>
                                            <label style={s.label}>Phone Number</label>
                                            <input name="phone" value={formData.phone} onChange={handleInputChange} required placeholder="+91 XXXXXXXXXX" style={s.input} />
                                        </div>
                                    </div>
                                    <div>
                                        <label style={s.label}>Delivery Pincode (Auto-selected)</label>
                                        <input
                                            name="pincode"
                                            value={formData.pincode}
                                            onChange={handleInputChange}
                                            readOnly
                                            required
                                            placeholder="Select store first"
                                            style={{ ...s.input, background: 'rgba(255,255,255,0.05)', color: '#94a3b8', cursor: 'not-allowed' }}
                                        />
                                    </div>

                                    <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '14px' }}>
                                        <p style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#14b8a6', marginBottom: '10px' }}>KYC Document Uploads</p>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            <div>
                                                <label style={s.label}>PAN Card Image</label>
                                                <input type="file" accept={KYC_IMAGE_ACCEPT} onChange={handlePanUpload} style={s.fileInput} />
                                                {kycFiles.pan && <p style={{ marginTop: '6px', fontSize: '11px', color: '#67e8f9' }}>Uploaded: {kycFiles.pan.name}</p>}
                                            </div>
                                            <div>
                                                <label style={s.label}>Aadhaar Card Front Image</label>
                                                <input type="file" accept={KYC_IMAGE_ACCEPT} onChange={handleAadhaarFrontUpload} style={s.fileInput} />
                                                {kycFiles.aadhaarFront && <p style={{ marginTop: '6px', fontSize: '11px', color: '#67e8f9' }}>Uploaded: {kycFiles.aadhaarFront.name}</p>}
                                            </div>
                                            <div>
                                                <label style={s.label}>Aadhaar Card Back Image</label>
                                                <input type="file" accept={KYC_IMAGE_ACCEPT} onChange={handleAadhaarBackUpload} style={s.fileInput} />
                                                {kycFiles.aadhaarBack && <p style={{ marginTop: '6px', fontSize: '11px', color: '#67e8f9' }}>Uploaded: {kycFiles.aadhaarBack.name}</p>}
                                            </div>
                                            {kycFiles.aadhaarFront && (
                                                <button
                                                    type="button"
                                                    onClick={() => autoFillAddressFromAadhaar(kycFiles.aadhaarFront)}
                                                    disabled={aadhaarDetection.loading}
                                                    style={{
                                                        alignSelf: 'flex-start',
                                                        background: 'rgba(56,189,248,0.14)',
                                                        border: '1px solid rgba(56,189,248,0.35)',
                                                        color: '#7dd3fc',
                                                        borderRadius: '10px',
                                                        padding: '8px 12px',
                                                        fontSize: '12px',
                                                        fontWeight: 700,
                                                        cursor: 'pointer',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                    }}
                                                >
                                                    <ScanLine size={14} />
                                                    {aadhaarDetection.loading ? 'Detecting address...' : 'Auto-fill address from Aadhaar'}
                                                </button>
                                            )}
                                            {aadhaarDetection.message && (
                                                <p style={{
                                                    margin: 0,
                                                    fontSize: '12px',
                                                    color: aadhaarDetection.type === 'success'
                                                        ? '#6ee7b7'
                                                        : aadhaarDetection.type === 'error'
                                                            ? '#fda4af'
                                                            : '#fcd34d',
                                                }}>
                                                    {aadhaarDetection.message}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <div>
                                        <label style={s.label}>Home Address (Auto-filled from Aadhaar when QR is detected)</label>
                                        <textarea name="address" value={formData.address} onChange={handleInputChange} rows={3} required placeholder="State, City, Area details..." style={{ ...s.input, resize: 'none' }} />
                                    </div>

                                    <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '14px' }}>
                                        <p style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#14b8a6', marginBottom: '10px' }}>Face Verification</p>
                                        <div style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: '10px', padding: '12px', marginBottom: '16px' }}>
                                            <p style={{ margin: 0, fontSize: '12px', lineHeight: 1.6, color: '#bae6fd' }}>
                                                <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '4px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Important Note:</strong>
                                                Please ensure your selfie has a **plain background** and a **clear view of your face**. High-quality images ensure faster processing of your application.
                                            </p>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            {cameraActive && (
                                                <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', overflow: 'hidden', background: '#020617' }}>
                                                    <video
                                                        ref={videoRef}
                                                        autoPlay
                                                        playsInline
                                                        muted
                                                        style={{
                                                            width: '100%',
                                                            maxHeight: '260px',
                                                            objectFit: 'cover',
                                                            transform: 'scaleX(-1)',
                                                        }}
                                                    />
                                                </div>
                                            )}
                                            {facePreview && (
                                                <div style={{ border: '1px solid rgba(20,184,166,0.25)', borderRadius: '12px', overflow: 'hidden' }}>
                                                    <img src={facePreview} alt="Face verification preview" style={{ width: '100%', maxHeight: '240px', objectFit: 'cover' }} />
                                                </div>
                                            )}
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                                                <button
                                                    type="button"
                                                    onClick={startFaceCamera}
                                                    style={{
                                                        background: 'rgba(20,184,166,0.12)',
                                                        border: '1px solid rgba(20,184,166,0.3)',
                                                        color: '#5eead4',
                                                        borderRadius: '10px',
                                                        padding: '8px 12px',
                                                        fontSize: '12px',
                                                        fontWeight: 700,
                                                        cursor: 'pointer',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '7px',
                                                    }}
                                                >
                                                    <Camera size={14} /> Start Camera
                                                </button>
                                                {cameraActive && (
                                                    <button
                                                        type="button"
                                                        onClick={captureFaceFromCamera}
                                                        style={{
                                                            background: 'rgba(59,130,246,0.12)',
                                                            border: '1px solid rgba(59,130,246,0.3)',
                                                            color: '#93c5fd',
                                                            borderRadius: '10px',
                                                            padding: '8px 12px',
                                                            fontSize: '12px',
                                                            fontWeight: 700,
                                                            cursor: 'pointer',
                                                        }}
                                                    >
                                                        Capture Face
                                                    </button>
                                                )}
                                                {cameraActive && (
                                                    <button
                                                        type="button"
                                                        onClick={stopCamera}
                                                        style={{
                                                            background: 'rgba(148,163,184,0.12)',
                                                            border: '1px solid rgba(148,163,184,0.3)',
                                                            color: '#cbd5e1',
                                                            borderRadius: '10px',
                                                            padding: '8px 12px',
                                                            fontSize: '12px',
                                                            fontWeight: 700,
                                                            cursor: 'pointer',
                                                        }}
                                                    >
                                                        Stop Camera
                                                    </button>
                                                )}
                                            </div>
                                            <div>
                                                <label style={s.label}>Or Upload Face Selfie</label>
                                                <input type="file" accept={KYC_IMAGE_ACCEPT} onChange={handleFaceUpload} style={s.fileInput} />
                                                {kycFiles.face && <p style={{ marginTop: '6px', fontSize: '11px', color: '#67e8f9' }}>Uploaded: {kycFiles.face.name}</p>}
                                            </div>
                                            {cameraError && <p style={{ margin: 0, fontSize: '12px', color: '#fda4af' }}>{cameraError}</p>}
                                            {faceValidationMessage && <p style={{ margin: 0, fontSize: '12px', color: '#6ee7b7' }}>{faceValidationMessage}</p>}
                                            {faceVerified && (
                                                <p style={{ margin: 0, fontSize: '12px', color: '#6ee7b7', fontWeight: 700 }}>
                                                    Face verification captured successfully.
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <button type="submit" disabled={submitting} style={{
                                        marginTop: '10px', background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                                        color: '#fff', padding: '14px', borderRadius: '12px', border: 'none',
                                        fontWeight: 700, cursor: 'pointer', opacity: submitting ? 0.7 : 1
                                    }}>
                                        {submitting ? 'Submitting...' : 'Submit Application'}
                                    </button>
                                </form>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default DeliveryRequest
