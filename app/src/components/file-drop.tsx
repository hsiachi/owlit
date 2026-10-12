import { FileUpIcon } from "lucide-react"

// Drawn inside the sheet while files are dragged over a page that takes them (see useFileDrop)
export function DropOverlay({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-foreground/20 bg-background/80 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-sm font-medium">
        <FileUpIcon className="size-4" />
        {label}
      </div>
    </div>
  )
}

// The hidden file picker behind a "Choose PDFs" button: click it through the ref. The value is cleared
// after each pick, so choosing the same file again still counts.
export function PdfFileInput({ ref, multiple, onFiles }: { ref: React.Ref<HTMLInputElement>; multiple?: boolean; onFiles: (files: File[]) => void }) {
  return (
    <input
      ref={ref}
      type="file"
      accept="application/pdf"
      multiple={multiple}
      className="hidden"
      onChange={(e) => {
        onFiles(Array.from(e.target.files ?? []))
        e.target.value = ""
      }}
    />
  )
}
