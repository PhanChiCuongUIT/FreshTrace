import type { ReactNode } from 'react'

export function PageHeader({ eyebrow, title, actions }: { eyebrow?: string; title: string; actions?: ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-4"><div>{eyebrow && <p className="text-sm font-bold uppercase tracking-widest text-brand-700">{eyebrow}</p>}<h1 className="text-3xl font-black">{title}</h1></div>{actions}</div>
}

export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: 'gray' | 'green' | 'orange' | 'red' | 'blue' }) {
  const colors = { gray: 'bg-black/5 text-black/60', green: 'bg-green-100 text-green-700', orange: 'bg-orange-100 text-orange-700', red: 'bg-red-100 text-red-700', blue: 'bg-blue-100 text-blue-700' }
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold capitalize ${colors[tone]}`}>{children}</span>
}

export function Metric({ label, value }: { label: string; value: ReactNode }) {
  return <div className="card p-5"><p className="text-sm text-black/50">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></div>
}
