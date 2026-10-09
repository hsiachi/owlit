import { useRef } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"

// The Library before its first paper: what goes in it and two ways to start. The second hands the search
// off to Owlit in Chat, which is also how the user learns that work can be handed off.
export function LibraryEmpty({ onPickFiles }: { onPickFiles: (files: File[]) => void }) {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <p className="text-[15px] font-medium">No papers yet</p>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Drop PDFs anywhere, or paste a DOI, arXiv id or link into the find field.</p>
      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={() => input.current?.click()}>
          Add PDFs…
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate("/chat", { state: { starter: "Find recent papers on " } })}>
          Ask Owlit to find papers
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          onPickFiles(Array.from(e.target.files ?? []))
          e.target.value = ""
        }}
      />
    </div>
  )
}
