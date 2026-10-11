import { PageHeader, PageTitle } from "@/components/page"
import { RefToken } from "../components/bits"
import { useKnowledgeStore } from "../store"

// Passages from the user's docs and chats that no topic holds yet. Nothing here needs doing.
export function LoosePage() {
  const loose = useKnowledgeStore((s) => s.loose)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader trail={[{ label: "Knowledge", to: "/knowledge" }]} current="Not in a topic yet" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pt-8 pb-32">
          <PageTitle>Not in a topic yet</PageTitle>
          <p className="mt-2 text-detail text-muted-foreground">Passages from your docs and chats that no topic holds. Owlit files them when a topic needs them; nothing here needs doing.</p>
          <div className="mt-8 flex flex-col gap-4">
            {loose.map((l, i) => (
              <div key={i}>
                <p className="text-body leading-relaxed">“{l.quote}”</p>
                <p className="text-detail text-muted-foreground">
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
