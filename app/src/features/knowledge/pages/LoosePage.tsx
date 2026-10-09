import { Link } from "react-router-dom"
import { ChevronRightIcon } from "lucide-react"
import { RefToken } from "../components/bits"
import { useKnowledgeStore } from "../store"

// Passages from the user's docs and chats that no topic holds yet. Nothing here needs doing.
export function LoosePage() {
  const loose = useKnowledgeStore((s) => s.loose)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-1 pr-2.5 pl-4 text-[13px]">
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground">
          <Link to="/knowledge" className="-ml-1 shrink-0 rounded-md px-1 py-0.5 hover:bg-muted hover:text-foreground">
            Knowledge
          </Link>
          <ChevronRightIcon className="size-3.5 shrink-0" />
          <span className="truncate text-foreground">Not in a topic yet</span>
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pt-8 pb-32">
          <h1 className="text-[22px] leading-tight font-medium tracking-tight">Not in a topic yet</h1>
          <p className="mt-2 text-[13px] text-muted-foreground">Passages from your docs and chats that no topic holds. Owlit files them when a topic needs them; nothing here needs doing.</p>
          <div className="mt-8 flex flex-col gap-4">
            {loose.map((l, i) => (
              <div key={i}>
                <p className="text-[15px] leading-relaxed">“{l.quote}”</p>
                <p className="text-[13px] text-muted-foreground">
                  <RefToken r={l.ref} />
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
