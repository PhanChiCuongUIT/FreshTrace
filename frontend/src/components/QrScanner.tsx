import { useEffect, useId, useRef, useState } from 'react'
import { Camera, ImageUp, X } from 'lucide-react'
import jsQR from 'jsqr'

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => { detect: (source: ImageBitmap) => Promise<Array<{ rawValue: string }>> }

export function QrScanner({ onResult, label = 'Scan QR', showImageButton = false }: { onResult: (value: string) => void; label?: string; showImageButton?: boolean }) {
  const rawId = useId()
  const elementId = `qr-reader-${rawId.replaceAll(':', '')}`
  const onResultRef = useRef(onResult)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [fileScanning, setFileScanning] = useState(false)
  const [liveScanning, setLiveScanning] = useState(false)
  const liveSupported = (window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    && Boolean(navigator.mediaDevices?.getUserMedia)

  useEffect(() => {
    onResultRef.current = onResult
  }, [onResult])

  useEffect(() => {
    if (!open) return
    if (!liveSupported) return
    let cancelled = false
    let stop: (() => Promise<void>) | undefined
    import('html5-qrcode').then(async ({ Html5Qrcode }) => {
      if (cancelled) return
      const scanner = new Html5Qrcode(elementId)
      stop = async () => {
        if (scanner.isScanning) await scanner.stop()
        await scanner.clear()
        setLiveScanning(false)
      }
      const qrbox = (width: number, height: number) => {
        const size = Math.max(180, Math.floor(Math.min(width, height) * 0.72))
        return { width: size, height: size }
      }
      const onDecoded = (decoded: string) => {
        onResultRef.current(decoded)
        stop?.().finally(() => setOpen(false))
      }
      try {
        setLiveScanning(true)
        await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox }, onDecoded, () => undefined)
      } catch (firstReason) {
        const cameras = await Html5Qrcode.getCameras().catch(() => [])
        const rear = cameras.find(camera => /back|rear|environment/i.test(camera.label))
        const cameraId = rear?.id ?? cameras[0]?.id
        if (!cameraId) throw firstReason
        await scanner.start(cameraId, { fps: 10, qrbox }, onDecoded, () => undefined)
      }
    }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
    return () => { cancelled = true; stop?.().catch(() => undefined) }
  }, [elementId, liveSupported, open])

  const decodeWithBarcodeDetector = async (file: File) => {
    const detector = (globalThis as typeof globalThis & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector
    if (!detector) return ''
    if (!('createImageBitmap' in globalThis)) return ''
    const image = await createImageBitmap(file)
    try {
      const codes = await new detector({ formats: ['qr_code'] }).detect(image)
      return codes[0]?.rawValue ?? ''
    } finally {
      image.close()
    }
  }

  const decodeWithHtml5Qrcode = async (file: File) => {
    const { Html5Qrcode } = await import('html5-qrcode')
    const target = document.createElement('div')
    const targetId = `${elementId}-file-${Date.now()}`
    target.id = targetId
    target.style.position = 'fixed'
    target.style.left = '-9999px'
    document.body.appendChild(target)
    try {
      const scanner = new Html5Qrcode(targetId)
      return await scanner.scanFile(file, false)
    } finally {
      target.remove()
    }
  }

  const decodeWithJsQr = async (file: File) => {
    if (!('createImageBitmap' in globalThis)) return ''
    const image = await createImageBitmap(file)
    try {
      const maxSide = 2200
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
      const width = Math.max(1, Math.round(image.width * scale))
      const height = Math.max(1, Math.round(image.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) return ''
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      context.drawImage(image, 0, 0, width, height)
      const data = context.getImageData(0, 0, width, height)
      return jsQR(data.data, width, height, { inversionAttempts: 'attemptBoth' })?.data ?? ''
    } finally {
      image.close()
    }
  }

  const normalizeImageFile = async (file: File) => {
    if (!('createImageBitmap' in globalThis)) return null
    const image = await createImageBitmap(file)
    try {
      const maxSide = 1800
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext('2d')
      if (!context) return null
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      return blob ? new File([blob], 'freshtrace-qr.png', { type: 'image/png' }) : null
    } finally {
      image.close()
    }
  }

  const scanFile = async (file?: File) => {
    if (!file) return
    setFileScanning(true)
    setError('')
    try {
      let decoded = ''
      try {
        decoded = await decodeWithBarcodeDetector(file)
      } catch {
        decoded = ''
      }
      if (!decoded) {
        try {
          decoded = await decodeWithHtml5Qrcode(file)
        } catch (firstError) {
          const normalized = await normalizeImageFile(file)
          if (normalized) {
            try {
              decoded = await decodeWithHtml5Qrcode(normalized)
            } catch {
              decoded = await decodeWithJsQr(normalized)
            }
          }
          if (!decoded) {
            decoded = await decodeWithJsQr(file)
          }
          if (!decoded) throw firstError
        }
      }
      if (!decoded) throw new Error('No QR code was found in this image.')
      onResultRef.current(decoded)
      setOpen(false)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message.includes('No MultiFormat Readers') ? 'No QR code was detected in this file. Please choose a clearer, uncropped QR image from your device.' : message)
    } finally {
      setFileScanning(false)
    }
  }

  return <><div className="flex gap-2"><button type="button" className="btn-secondary flex-1" onClick={() => { setError(liveSupported ? '' : 'Camera streaming is unavailable in this browser. Tap Take QR photo instead.'); setOpen(true) }}><Camera size={18}/>{label}</button>{showImageButton && <label className="btn-secondary flex-1 cursor-pointer"><ImageUp size={18}/>{fileScanning ? 'Scanning...' : 'Choose file'}<input className="hidden" type="file" accept="image/*" onChange={event => { void scanFile(event.target.files?.[0]); event.currentTarget.value = '' }}/></label>}</div>
    {open && <div className="fixed inset-0 z-[80] grid place-items-center bg-black/80 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-4"><div className="mb-3 flex items-center justify-between"><b>Scan a FreshTrace QR code</b><button type="button" onClick={() => setOpen(false)} className="rounded-xl p-2 hover:bg-black/5"><X/></button></div>{liveSupported ? <><div id={elementId} className="min-h-[260px] overflow-hidden rounded-2xl bg-black"/>{liveScanning && <p className="mt-2 text-center text-xs text-black/45">Point the camera at the batch QR code.</p>}</> : <div className="rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-800">Live camera requires HTTPS or localhost. Use Take QR photo to open the device camera and scan from a captured image.</div>}{error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="btn-primary cursor-pointer justify-center"><Camera size={18}/>{fileScanning ? 'Scanning photo...' : 'Take QR photo'}<input className="hidden" type="file" accept="image/*" capture="environment" onChange={event => { void scanFile(event.target.files?.[0]); event.currentTarget.value = '' }}/></label><label className="btn-secondary cursor-pointer justify-center"><ImageUp size={18}/>{fileScanning ? 'Scanning file...' : 'Choose QR file'}<input className="hidden" type="file" accept="image/*" onChange={event => { void scanFile(event.target.files?.[0]); event.currentTarget.value = '' }}/></label></div></div></div>}
  </>
}
