import type { ReactNode } from 'react'

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return <div className="card p-8 text-center text-black/55">{label}</div>
}

export function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === 'object'
      ? ('message' in error && typeof error.message === 'string'
        ? error.message
        : JSON.stringify(error, null, 2))
      : String(error)
  return <div className="whitespace-pre-wrap rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700">{message}</div>
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="card p-10 text-center"><h3 className="font-bold">{title}</h3><div className="mt-2 text-sm text-black/55">{children}</div></div>
}
