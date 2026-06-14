import { callFunction } from './api'

type Signature = { cloudName: string; apiKey: string; folder: string; timestamp: number; signature: string }
type UploadFolder = 'products' | 'certificates' | 'deliveries' | 'avatars' | 'chat'

async function upload(file: File, folder: UploadFolder, resourceType: 'image' | 'auto') {
  const signed = await callFunction<Signature>('sign-cloudinary-upload', { folder })
  if (!signed.cloudName || signed.cloudName.startsWith('your_')) {
    throw new Error('Image upload is currently unavailable. Please contact an administrator.')
  }
  const form = new FormData()
  form.append('file', file)
  form.append('api_key', signed.apiKey)
  form.append('timestamp', String(signed.timestamp))
  form.append('signature', signed.signature)
  form.append('folder', signed.folder)
  const response = await fetch(`https://api.cloudinary.com/v1_1/${signed.cloudName}/${resourceType}/upload`, { method: 'POST', body: form })
  const payload = await response.json()
  if (!response.ok || !payload.secure_url) throw new Error(payload.error?.message ?? 'Image upload failed')
  return payload.secure_url as string
}

export function uploadImage(file: File, folder: Exclude<UploadFolder, 'chat'>) {
  return upload(file, folder, 'image')
}

export function uploadChatFile(file: File) {
  return upload(file, 'chat', 'auto')
}
