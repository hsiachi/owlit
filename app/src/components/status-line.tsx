// A list page's status line under its header (an import, papers waiting on the browser): a 14px slot for
// the mark, the words, and text-button actions pulled out to the column's edge. `below` goes under the
// line, lined up with the words (an error's own text). The words are given as they should wrap or
// truncate; the line does neither for them.
export function StatusLine({ mark, actions, below, children }: { mark?: React.ReactNode; actions?: React.ReactNode; below?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-3 -mb-1 text-detail text-muted-foreground" role="status">
      <div className="flex min-h-7 items-center gap-3">
        <span className="flex min-w-0 flex-1 items-center gap-2 tabular-nums">
          {mark && <span className="grid size-3.5 shrink-0 place-items-center">{mark}</span>}
          {children}
        </span>
        <span className="-mr-1.5 flex shrink-0 items-center gap-0.5">{actions}</span>
      </div>
      {below}
    </div>
  )
}

// "3 were here already · 2 without a PDF": details joined by "·", each kept whole
export function JoinDots({ items }: { items: React.ReactNode[] }) {
  return items.map((item, i) => (
    <span key={i}>
      {i > 0 && " · "}
      {item}
    </span>
  ))
}
