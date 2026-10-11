import { cn } from "@/lib/utils"

export interface DatedRow {
  key: React.Key
  date: string
  text: React.ReactNode
}

// A short dated list: the date in a muted column at the left, what happened beside it
export function DatedRows({ rows, className }: { rows: DatedRow[]; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5 leading-relaxed", className)}>
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[4.5rem_1fr] gap-2">
          <span className="text-detail text-muted-foreground tabular-nums">{r.date}</span>
          <span>{r.text}</span>
        </div>
      ))}
    </div>
  )
}
