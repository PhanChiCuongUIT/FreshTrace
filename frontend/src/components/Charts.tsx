import type { ReactNode } from 'react'

type ChartItem = { label: string; value: number; color?: string; detail?: ReactNode }

export function HorizontalBarChart({ title, items, valueLabel = value => String(value) }: { title: string; items: ChartItem[]; valueLabel?: (value: number) => string }) {
  const max = Math.max(1, ...items.map(item => item.value))
  return <section className="card p-5"><h2 className="text-lg font-black">{title}</h2><div className="mt-5 space-y-4">{items.map(item => <div key={item.label}><div className="mb-1.5 flex items-center justify-between gap-4 text-sm"><span className="font-semibold">{item.label}</span><span className="text-black/50">{item.detail ?? valueLabel(item.value)}</span></div><div className="h-2.5 overflow-hidden rounded-full bg-black/[0.05]"><div className="h-full rounded-full transition-all" style={{ width: `${Math.max(item.value ? 4 : 0, item.value / max * 100)}%`, backgroundColor: item.color ?? '#1aa65b' }}/></div></div>)}</div></section>
}

export function SparklineCard({ label, value, values, footer }: { label: string; value: ReactNode; values: number[]; footer?: string }) {
  const width = 260
  const height = 70
  const max = Math.max(1, ...values)
  const points = values.map((item, index) => `${index * (width / Math.max(1, values.length - 1))},${height - item / max * (height - 8)}`).join(' ')
  return <section className="card overflow-hidden"><div className="p-5 pb-2"><p className="text-sm text-black/50">{label}</p><p className="mt-1 text-3xl font-black">{value}</p>{footer && <p className="mt-1 text-xs text-black/40">{footer}</p>}</div><svg viewBox={`0 0 ${width} ${height}`} className="h-20 w-full" preserveAspectRatio="none" aria-label={`${label} trend`}><defs><linearGradient id={`fill-${label.replaceAll(' ', '-')}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1aa65b" stopOpacity=".35"/><stop offset="100%" stopColor="#1aa65b" stopOpacity=".02"/></linearGradient></defs><polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#fill-${label.replaceAll(' ', '-')})`}/><polyline points={points} fill="none" stroke="#128548" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg></section>
}

export function VerticalBarChart({ title, items, valueLabel = value => String(value) }: { title: string; items: ChartItem[]; valueLabel?: (value: number) => string }) {
  const max = Math.max(1, ...items.map(item => item.value))
  return <section className="card p-5"><h2 className="text-lg font-black">{title}</h2><div className="mt-5 flex h-48 items-end gap-3">{items.map(item => <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-2"><div className="flex h-36 w-full items-end rounded-2xl bg-black/[0.04] p-1"><div className="w-full rounded-xl transition-all" style={{ height: `${Math.max(item.value ? 8 : 0, item.value / max * 100)}%`, backgroundColor: item.color ?? '#1aa65b' }}/></div><span className="max-w-full truncate text-xs font-semibold text-black/60" title={item.label}>{item.label}</span><span className="text-xs font-bold">{valueLabel(item.value)}</span></div>)}</div></section>
}

export function DonutChart({ title, items, center }: { title: string; items: ChartItem[]; center?: ReactNode }) {
  const total = Math.max(1, items.reduce((sum, item) => sum + item.value, 0))
  const segments = items.map((item, index) => {
    const length = item.value / total * 100
    const dash = `${length} ${100 - length}`
    const offset = 25 - items.slice(0, index).reduce((sum, previous) => sum + previous.value / total * 100, 0)
    return <circle key={item.label} r="15.9155" cx="18" cy="18" fill="transparent" stroke={item.color ?? ['#16a34a', '#3b82f6', '#eab308', '#ef4444', '#8b5cf6'][index % 5]} strokeWidth="5" strokeDasharray={dash} strokeDashoffset={offset} />
  })
  return <section className="card p-5"><h2 className="text-lg font-black">{title}</h2><div className="mt-5 grid items-center gap-5 sm:grid-cols-[160px_1fr]"><div className="relative mx-auto h-40 w-40"><svg viewBox="0 0 36 36" className="h-40 w-40 -rotate-90">{segments}</svg>{center && <div className="absolute inset-0 grid place-items-center text-center">{center}</div>}</div><div className="space-y-2">{items.map((item, index) => <div key={item.label} className="flex items-center justify-between gap-3 text-sm"><span className="flex min-w-0 items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color ?? ['#16a34a', '#3b82f6', '#eab308', '#ef4444', '#8b5cf6'][index % 5] }}/><span className="truncate">{item.label}</span></span><b>{item.value}</b></div>)}</div></div></section>
}
