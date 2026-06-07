import { useEffect, useId, useState } from 'react'
import { Camera, ImageUp, X } from 'lucide-react'

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => { detect: (source: ImageBitmap) => Promise<Array<{ rawValue: string }>> }

export function QrScanner({ onResult, label = 'Scan QR', showImageButton = false }: { onResult: (value: string) => void; label?: string; showImageButton?: boolean }) {
  const rawId = useId()
  const elementId = `qr-reader-${rawId.replaceAll(':', '')}`
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [fileScanning, setFileScanning] = useState(false)
  const liveSupported = (window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    && Boolean(navigator.mediaDevices?.getUserMedia)

  useEffect(() => {
    if (!open) return
    if (!liveSupported) return
    let cancelled = false
    let stop: (() => Promise<void>) | undefined
    import('html5-qrcode').then(async ({ Html5Qrcode }) => {
      if (cancelled) return
      const scanner = new Html5Qrcode(elementId)
      stop = () => scanner.isScanning ? scanner.stop() : Promise.resolve()
      await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, decoded => {
        onResult(decoded)
        stop?.().finally(() => setOpen(false))
      }, () => undefined)
    }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
    return () => { cancelled = true; stop?.().catch(() => undefined) }
  }, [elementId, liveSupported, onResult, open])

  const decodeWithBarcodeDetector = async (file: File) => {
    const detector = (globalThis as typeof globalThis & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector
    if (!detector) return ''
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
      return await scanner.scanFile(file, true)
    } finally {
      target.remove()
    }
  }

  const scanFile = async (file?: File) => {
    if (!file) return
    setFileScanning(true)
    setError('')
    try {
      const decoded = await decodeWithBarcodeDetector(file) || await decodeWithHtml5Qrcode(file)
      if (!decoded) throw new Error('No QR code was found in this image.')
      onResult(decoded)
      setOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setFileScanning(false)
    }
  }

  return <><div className="flex gap-2"><button type="button" className="btn-secondary flex-1" onClick={() => { setError(liveSupported ? '' : 'Camera is unavailable in this browser. Take or choose a QR photo instead.'); setOpen(true) }}><Camera size={18}/>{label}</button>{showImageButton && <label className="btn-secondary flex-1 cursor-pointer"><ImageUp size={18}/>{fileScanning ? 'Scanning...' : 'Choose QR image'}<input className="hidden" type="file" accept="image/*" capture="environment" onChange={event => scanFile(event.target.files?.[0])}/></label>}</div>
    {open && <div className="fixed inset-0 z-[80] grid place-items-center bg-black/80 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-4"><div className="mb-3 flex items-center justify-between"><b>Scan a FreshTrace QR code</b><button type="button" onClick={() => setOpen(false)} className="rounded-xl p-2 hover:bg-black/5"><X/></button></div><div id={elementId} className="overflow-hidden rounded-2xl"/>{error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<label className="btn-secondary mt-3 w-full cursor-pointer"><ImageUp size={18}/>{fileScanning ? 'Scanning image...' : 'Take or choose QR image'}<input className="hidden" type="file" accept="image/*" capture="environment" onChange={event => scanFile(event.target.files?.[0])}/></label></div></div>}
  </>
}
