import type { ReactNode } from 'react'
import { errorMessage } from '../lib/errorMessages'

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return <div className="card p-8 text-center text-black/55">{label}</div>
}

export function ErrorState({ error }: { error: unknown }) {
  const message = errorMessage(error)
  return <div className="whitespace-pre-wrap rounded-2xl border border-red-200 bg-red-50 p-5 text-red-700">{message}</div>
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="card p-10 text-center"><h3 className="font-bold">{title}</h3><div className="mt-2 text-sm text-black/55">{children}</div></div>
}
