import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from 'lucide-react'

type ToastTone = 'success' | 'error' | 'info'
type ConfirmOptions = { title: string; description?: string; message?: string; confirmLabel?: string; danger?: boolean; tone?: 'default' | 'danger' }
type FeedbackValue = {
  toast: (message: string, tone?: ToastTone) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const FeedbackContext = createContext<FeedbackValue | null>(null)

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; tone: ToastTone }>>([])
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const toast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = Date.now() + Math.random()
    setToasts(current => [...current, { id, message, tone }])
    window.setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), 3500)
  }, [])

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => {
    resolver.current = resolve
    setDialog(options)
  }), [])

  const close = (value: boolean) => {
    resolver.current?.(value)
    resolver.current = null
    setDialog(null)
  }

  const success = useCallback((message: string) => toast(message, 'success'), [toast])
  const error = useCallback((message: string) => toast(message, 'error'), [toast])
  const info = useCallback((message: string) => toast(message, 'info'), [toast])
  return <FeedbackContext.Provider value={{ toast, success, error, info, confirm }}>
    {children}
    <div className="fixed right-4 top-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map(item => {
        const Icon = item.tone === 'success' ? CheckCircle2 : item.tone === 'error' ? CircleAlert : Info
        return <div key={item.id} className={`flex items-start gap-3 rounded-2xl border bg-white p-4 shadow-xl ${item.tone === 'error' ? 'border-red-200 text-red-700' : item.tone === 'success' ? 'border-green-200 text-green-700' : 'border-blue-200 text-blue-700'}`}><Icon className="mt-0.5 shrink-0" size={19}/><p className="flex-1 text-sm font-semibold">{item.message}</p><button onClick={() => setToasts(current => current.filter(value => value.id !== item.id))}><X size={16}/></button></div>
      })}
    </div>
    {dialog && <div className="fixed inset-0 z-[110] grid place-items-center bg-black/45 p-4">
      <div className="card w-full max-w-md p-6">
        <div className={`grid h-12 w-12 place-items-center rounded-2xl ${dialog.danger || dialog.tone === 'danger' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}><TriangleAlert/></div>
        <h2 className="mt-4 text-xl font-black">{dialog.title}</h2>
        <p className="mt-2 text-sm leading-6 text-black/60">{dialog.description ?? dialog.message}</p>
        <div className="mt-6 grid grid-cols-2 gap-3"><button className="btn-secondary" onClick={() => close(false)}>Go back</button><button className={dialog.danger || dialog.tone === 'danger' ? 'inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700' : 'btn-primary'} onClick={() => close(true)}>{dialog.confirmLabel ?? 'Confirm'}</button></div>
      </div>
    </div>}
  </FeedbackContext.Provider>
}

// Shared hook lives beside its provider to keep the feedback API in one module.
// eslint-disable-next-line react-refresh/only-export-components
export function useFeedback() {
  const value = useContext(FeedbackContext)
  if (!value) throw new Error('useFeedback must be used inside FeedbackProvider')
  return value
}
