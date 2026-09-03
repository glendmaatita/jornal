// Lightweight SVG charts for Phase 2 trends (§36–38, §60) — no chart library.

import { formatCompactRupiah } from "@/lib/format"

export interface ChartDatum {
  label: string
  value: number
}

export function BarChart({ data, height = 140, color = "var(--primary)" }: { data: ChartDatum[]; height?: number; color?: string }) {
  if (data.length === 0) return null
  const max = Math.max(...data.map((datum) => Math.abs(datum.value)), 1)
  const barWidth = 100 / (data.length * 1.6)

  return (
    <div className="w-full" role="img" aria-label="Grafik batang">
      <svg viewBox={`0 0 100 ${height}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
        {data.map((datum, index) => {
          const barHeight = Math.max((Math.abs(datum.value) / max) * (height - 8), 1)
          const x = index * (100 / data.length) + (100 / data.length - barWidth) / 2
          return (
            <rect
              key={datum.label + index}
              x={x}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              rx={1.5}
              fill={color}
              opacity={datum.value === 0 ? 0.15 : 0.9}
            />
          )
        })}
      </svg>
      <div className="mt-1 flex text-[10px] text-muted-foreground">
        {data.map((datum, index) => (
          <span key={datum.label + index} className="flex-1 text-center">
            {datum.label}
          </span>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>0</span>
        <span>{formatCompactRupiah(max)}</span>
      </div>
    </div>
  )
}

export function DualBarChart({ data, height = 140 }: { data: { label: string; in: number; out: number }[]; height?: number }) {
  if (data.length === 0) return null
  const max = Math.max(...data.flatMap((datum) => [datum.in, datum.out]), 1)
  const groupWidth = 100 / data.length
  const barWidth = groupWidth * 0.3

  return (
    <div className="w-full" role="img" aria-label="Grafik uang masuk dan keluar">
      <svg viewBox={`0 0 100 ${height}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
        {data.map((datum, index) => {
          const groupStart = index * groupWidth
          const inHeight = Math.max((datum.in / max) * (height - 8), datum.in > 0 ? 1 : 0)
          const outHeight = Math.max((datum.out / max) * (height - 8), datum.out > 0 ? 1 : 0)
          return (
            <g key={datum.label + index}>
              <rect
                x={groupStart + (groupWidth - barWidth * 2 - 1) / 2}
                y={height - inHeight}
                width={barWidth}
                height={inHeight}
                rx={1}
                fill="#3eb290"
                opacity={0.85}
              />
              <rect
                x={groupStart + (groupWidth - barWidth * 2 - 1) / 2 + barWidth + 1}
                y={height - outHeight}
                width={barWidth}
                height={outHeight}
                rx={1}
                fill="var(--primary)"
                opacity={0.85}
              />
            </g>
          )
        })}
      </svg>
      <div className="mt-1 flex text-[10px] text-muted-foreground">
        {data.map((datum, index) => (
          <span key={datum.label + index} className="flex-1 text-center">
            {datum.label}
          </span>
        ))}
      </div>
      <div className="mt-0.5 flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-[var(--mint)]" /> Masuk
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-primary" /> Keluar
        </span>
        <span className="ml-auto">{formatCompactRupiah(max)}</span>
      </div>
    </div>
  )
}

export function LineChart({ data, height = 100 }: { data: ChartDatum[]; height?: number }) {
  if (data.length < 2) return null
  const values = data.map((datum) => datum.value)
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 1)
  const range = max - min || 1
  const points = data.map((datum, index) => {
    const x = (index / (data.length - 1)) * 100
    const y = height - ((datum.value - min) / range) * (height - 6) - 3
    return { x, y }
  })
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")
  const area = `${path} L100,${height} L0,${height} Z`

  return (
    <div className="w-full" role="img" aria-label="Grafik garis">
      <svg viewBox={`0 0 100 ${height}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
        <path d={area} fill="var(--primary)" opacity={0.08} />
        <path d={path} fill="none" stroke="var(--primary)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{data[0].label}</span>
        <span>{formatCompactRupiah(max)}</span>
        <span>{data[data.length - 1].label}</span>
      </div>
    </div>
  )
}
