import { useRef, useState } from "react"
import { FileUpIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { addPdfFiles } from "../lib/add-pdfs"
import { libraryClient, useLibraryStore } from "../store"
import { useUiStore } from "../ui-store"

export function AddPaperPopover() {
  const open = useUiStore((s) => s.addOpen)
  const setOpen = useUiStore((s) => s.setAddOpen)
  const select = useUiStore((s) => s.select)
  const addPaper = useLibraryStore((s) => s.addPaper)
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setValue("")
      setError(null)
      setBusy(false)
    }
  }

  const submit = async () => {
    const input = value.trim()
    if (!input || busy) return
    setBusy(true)
    setError(null)
    try {
      const resolved = await libraryClient.resolve(input)
      const paper = addPaper(resolved)
      select(paper.id, "single", [])
      setOpen(false)
      toast("Added to library", { description: paper.title })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add that reference.")
    } finally {
      setBusy(false)
    }
  }

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      await addPdfFiles(Array.from(files))
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button size="sm">
          <PlusIcon />
          Add paper
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-xl p-4">
        <PopoverHeader>
          <PopoverTitle>Add a paper</PopoverTitle>
          <PopoverDescription>Paste a DOI, an arXiv id or a URL.</PopoverDescription>
        </PopoverHeader>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="10.1145/… or 2305.10601"
            aria-invalid={!!error}
            disabled={busy}
          />
          <Button type="submit" disabled={busy || !value.trim()} className="w-16">
            {busy ? <Spinner /> : "Add"}
          </Button>
        </form>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            onFiles(e.dataTransfer.files)
          }}
          className={cn(
            "mt-3 flex w-full flex-col items-center gap-1 rounded-lg border border-dashed p-4 text-sm text-muted-foreground transition-colors hover:bg-muted/50",
            dragging && "border-ring bg-muted",
          )}
        >
          <FileUpIcon className="size-4" />
          Or drop a PDF here
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            onFiles(e.target.files)
            e.target.value = ""
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
