import { t } from "@lingui/core/macro"
import { Fragment } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { EmptyPlace } from "@/components/empty-place"

// A list page: scrolls whole, header included, so switching tabs or layouts never moves the header. The
// Library, which has a table, takes the wide column; a page of rows alone (Knowledge) takes Home's
// reading column, so one line doesn't run the width of the window.
export function PageShell({
  width = "wide",
  scroller,
  onKeyDown,
  children,
}: {
  width?: "wide" | "narrow"
  scroller?: React.Ref<HTMLDivElement>
  onKeyDown?: (e: React.KeyboardEvent) => void
  children: React.ReactNode
}) {
  return (
    <div ref={scroller} tabIndex={-1} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto outline-none">
      <div className={cn("mx-auto w-full pt-10 pb-24", width === "wide" ? "max-w-6xl px-6" : "max-w-3xl px-4")}>{children}</div>
    </div>
  )
}

export function PageTitle({ className, ...props }: React.ComponentProps<"h1">) {
  return <h1 className={cn("text-title leading-tight font-medium tracking-tight", className)} {...props} />
}

export interface Crumb {
  label: string
  to?: string
  onClick?: () => void
}

// The 44px bar over a paper, a doc or a topic: the breadcrumb from the sheet's edge, then the page's own
// buttons at the right
export function PageHeader({ trail, current, children }: { trail: Crumb[]; current?: React.ReactNode; children?: React.ReactNode }) {
  const crumb = "shrink-0 rounded-md px-1 py-0.5 outline-none first:-ml-1 hover:bg-muted hover:text-foreground focus-key:bg-muted"
  return (
    <header className="flex h-11 shrink-0 items-center gap-1 pr-2.5 pl-4 text-detail">
      <nav aria-label={t`Breadcrumb`} className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground">
        {trail.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <ChevronRightIcon className="size-3.5 shrink-0" />}
            {c.to ? (
              <Link to={c.to} className={crumb}>
                {c.label}
              </Link>
            ) : (
              <button type="button" onClick={c.onClick} className={crumb}>
                {c.label}
              </button>
            )}
          </Fragment>
        ))}
        {current && (
          <>
            {trail.length > 0 && <ChevronRightIcon className="size-3.5 shrink-0" />}
            <span className="truncate text-foreground">{current}</span>
          </>
        )}
      </nav>
      {children}
    </header>
  )
}

// A page whose thing is gone: says so, with the way back
export function NotFound({ title, detail, back }: { title: string; detail: string; back: { label: string; to: string } }) {
  const navigate = useNavigate()
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6">
      <EmptyPlace title={title} detail={detail}>
        <Button variant="outline" size="sm" onClick={() => navigate(back.to)}>
          {back.label}
        </Button>
      </EmptyPlace>
    </div>
  )
}
