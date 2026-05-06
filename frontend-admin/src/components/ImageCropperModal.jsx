import { useState, useCallback } from 'react'
import Cropper from 'react-easy-crop'
import { X, Check, ZoomIn, Scissors } from 'lucide-react'
import { getCroppedImg } from '../utils/cropImage'

export default function ImageCropperModal({ image, onCropComplete, onCancel, aspect = 16 / 9 }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)

  const onCropChange = (crop) => {
    setCrop(crop)
  }

  const onZoomChange = (zoom) => {
    setZoom(zoom)
  }

  const onCropAreaComplete = useCallback((_croppedArea, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels)
  }, [])

  const handleDone = async () => {
    try {
      const croppedImageBlob = await getCroppedImg(image, croppedAreaPixels)
      onCropComplete(croppedImageBlob)
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/90 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="relative w-full max-w-4xl bg-white rounded-[3rem] overflow-hidden shadow-2xl flex flex-col h-[80vh]">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white relative z-10">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                <Scissors size={20} />
             </div>
             <div>
               <h3 className="text-lg font-black tracking-tight text-slate-900">Crop Image</h3>
               <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Perfectly frame your banner</p>
             </div>
          </div>
          <button 
            onClick={onCancel}
            className="p-3 hover:bg-slate-100 rounded-2xl transition-all text-slate-400 hover:text-slate-900"
          >
            <X size={20} />
          </button>
        </div>

        {/* Cropper Body */}
        <div className="relative flex-1 bg-slate-50">
          <Cropper
            image={image}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            onCropChange={onCropChange}
            onCropComplete={onCropAreaComplete}
            onZoomChange={onZoomChange}
          />
        </div>

        {/* Controls */}
        <div className="p-8 bg-white border-t border-slate-100 space-y-6">
          <div className="flex items-center gap-6">
            <ZoomIn size={18} className="text-slate-400" />
            <input
              type="range"
              value={zoom}
              min={1}
              max={3}
              step={0.1}
              aria-labelledby="Zoom"
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="flex-1 h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <span className="text-xs font-black text-slate-900 min-w-[3ch]">{Math.round(zoom * 100)}%</span>
          </div>

          <div className="flex gap-4">
            <button
              onClick={onCancel}
              className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-slate-200 transition-all active:scale-95"
            >
              Cancel
            </button>
            <button
              onClick={handleDone}
              className="flex-1 py-4 bg-primary text-white rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:opacity-90 transition-all active:scale-95 shadow-xl shadow-primary/20"
            >
              <Check size={18} /> Apply Crop
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
