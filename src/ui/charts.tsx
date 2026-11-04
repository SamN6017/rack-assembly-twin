import type { ReactNode } from 'react'
import type { TooltipContentProps } from 'recharts'

/**
 * Chart tokens for the dark control-room theme. Categorical slots are the validated default
 * palette's dark steps in fixed order (checked against the dark surface: all checks pass);
 * critical is the reserved status colour and only marks line stops.
 */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500'] as const
export const CRITICAL = '#d03b3b'
export const INK = { primary: '#e5e5e5', secondary: '#a3a3a3', muted: '#737373', grid: 'rgba(255,255,255,0.06)', axis: 'rgba(255,255,255,0.15)' }

export const axisProps = {
  stroke: INK.axis,
  tick: { fill: INK.muted, fontSize: 10 },
  tickLine: false,
} as const

export const hourTicks = (horizonH: number) => {
  const step = horizonH > 12 ? 4 : horizonH > 6 ? 2 : 1
  return Array.from({ length: Math.floor(horizonH / step) + 1 }, (_, i) => i * step)
}

export const fmtH = (h: number) => {
  const m = Math.round(h * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Dark tooltip: values in text ink, a colour swatch carries series identity. */
export function ChartTooltip({ active, payload, label, unit, labelFormat = fmtH }: Partial<TooltipContentProps<number, string>> & { unit?: string; labelFormat?: (v: number) => string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded bg-[#1b1c1f] px-2 py-1.5 text-[11px] shadow-lg ring-1 ring-white/15">
      <div className="mb-0.5 font-mono text-neutral-400">{typeof label === 'number' ? labelFormat(label) : label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-neutral-400">{p.name}</span>
          <span className="ml-auto pl-3 font-mono text-neutral-100">{typeof p.value === 'number' ? Math.round(p.value * 10) / 10 : p.value}{unit ? ` ${unit}` : ''}</span>
        </div>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-neutral-400">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1">
          <span className="inline-block h-0 w-3 border-t-2" style={{ borderColor: i.color, borderStyle: i.dashed ? 'dashed' : 'solid' }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

export function ChartCard({ title, legend, children, width = 300, note }: { title: string; legend?: ReactNode; children: ReactNode; width?: number | 'auto'; note?: string }) {
  return (
    <div className="flex shrink-0 flex-col rounded-md bg-white/[0.02] px-2 pb-1 pt-1.5 ring-1 ring-white/5" style={{ width: width === 'auto' ? undefined : width }} title={note}>
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-neutral-300">{title}</span>
        <span className="rounded bg-sky-500/10 px-1 text-[9px] uppercase tracking-wide text-sky-300/80">simulated</span>
      </div>
      {legend}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}
