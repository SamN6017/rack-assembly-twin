import type { ReactNode } from 'react'
import type { Confidence } from '../data/parts'

const BADGE: Record<Confidence, string> = {
  verified: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  estimated: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  placeholder: 'bg-neutral-500/15 text-neutral-400 ring-neutral-500/30',
}

export function ConfidenceBadge({ value }: { value: Confidence }) {
  return <span className={`rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ring-1 ${BADGE[value]}`}>{value}</span>
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-white/5 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

export function Row({ label, value, confidence }: { label: string; value: ReactNode; confidence?: Confidence }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-[13px]">
      <span className="text-neutral-400">{label}</span>
      <span className="flex items-center gap-2 font-mono text-neutral-100">
        {value}
        {confidence && <ConfidenceBadge value={confidence} />}
      </span>
    </div>
  )
}
