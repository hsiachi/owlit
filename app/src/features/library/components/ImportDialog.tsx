import { plural, t } from "@lingui/core/macro"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import type { ImportPreview, ImportSource } from "@owlit/protocol"
import { ChevronRightIcon, FileTextIcon, FolderIcon, LibraryIcon, LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { RowIcon, RowList, rowClass, rowHover } from "@/components/row-list"
import { DialogHeading } from "@/components/info"
import { Button } from "@/components/ui/button"
import { FormRow } from "@/components/form-row"
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { RpcError } from "@/lib/rpc"
import { cn } from "@/lib/utils"
import { tilde } from "@/lib/workspace"
import { closeImportDialog, openImportDialog, pickImport, previewImport, reviewImport, startImport, useImportDialog } from "../imports"


// File › Import Papers…: where the papers come from, then what importing them will do, before anything
// is added. Global, so the menu opens it from any page; starting an import goes to the Library, where
// its line shows the progress.
export function ImportDialog() {
  const open = useImportDialog((s) => s.open)
  const at = useImportDialog((s) => s.at)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeImportDialog()}>
      <DialogContent className="sm:max-w-md">{at.step === "source" ? <Sources /> : <Review key={`${at.source}:${at.path}`} source={at.source} path={at.path} />}</DialogContent>
    </Dialog>
  )
}

function Sources() {
  const zotero = useImportDialog((s) => s.zotero)
  const pickZotero = () =>
    zotero ? reviewImport("zotero", zotero) : void pickImport("zotero", { title: t`Your Zotero folder`, buttonLabel: t`Choose` })
  const choices = [
    {
      id: "zotero",
      icon: <LibraryIcon />,
      title: t`Zotero`,
      detail: zotero ? t`Found at ${tilde(zotero)}` : zotero === null ? t`Choose its folder…` : " ",
      run: pickZotero,
    },
    {
      id: "bibtex",
      icon: <FileTextIcon />,
      title: t`A BibTeX file…`,
      detail: t`From Zotero, Mendeley, JabRef or Google Scholar`,
      run: () => void pickImport("bibtex", { title: t`A BibTeX file`, buttonLabel: t`Choose` }),
    },
    {
      id: "folder",
      icon: <FolderIcon />,
      title: t`A folder of PDFs…`,
      detail: t`Every PDF in it and its subfolders`,
      run: () => void pickImport("folder", { title: t`A folder of PDFs`, buttonLabel: t`Choose` }),
    },
  ]
  return (
    <>
      <DialogHeading title={t`Import Papers`} description={t`Bring in papers from Zotero, a BibTeX file or a folder of PDFs`} />
      <RowList>
        {choices.map((c) => (
          <button key={c.id} type="button" onClick={c.run} className={cn("group/choice flex min-h-13 items-center gap-3 py-2 text-left", rowClass, rowHover)}>
            <RowIcon>{c.icon}</RowIcon>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{c.title}</span>
              <span className="block truncate text-detail text-muted-foreground">{c.detail}</span>
            </span>
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/choice:opacity-100 group-focus-visible/choice:opacity-100" />
          </button>
        ))}
      </RowList>
    </>
  )
}

function Review({ source, path }: { source: ImportSource; path: string }) {
  const navigate = useNavigate()
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [tags, setTags] = useState(true)
  const [parse, setParse] = useState(true)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    let live = true
    previewImport(source, path).then(
      (p) => live && setPreview(p),
      (e) => live && setProblem(e instanceof RpcError ? e.message : t`That library couldn't be read.`),
    )
    return () => {
      live = false
    }
  }, [source, path])

  const title = source === "zotero" ? t`Import from Zotero` : source === "bibtex" ? t`Import a BibTeX file` : t`Import a folder of PDFs`
  const fresh = preview ? preview.total - preview.known : 0
  const start = async () => {
    setStarting(true)
    try {
      await startImport(source, path, { ...(source === "zotero" ? { collectionsAsTags: tags } : {}), ...(preview?.asksParse ? { parse } : {}) })
      closeImportDialog()
      navigate("/library")
    } catch (e) {
      toast.error(e instanceof RpcError ? e.message : t`The import couldn't start.`)
      setStarting(false)
    }
  }

  return (
    <>
      <DialogHeading title={title} />
      <div className="flex min-w-0 items-center gap-1 text-detail text-muted-foreground">
        <span className="truncate" title={path}>
          {tilde(path)}
        </span>
        <Button variant="text" size="inline" onClick={openImportDialog}>
          {t({ message: "Change…", comment: "pick another library, file or folder to import" })}
        </Button>
      </div>
      {problem ? (
        <p className="text-sm text-destructive">{problem}</p>
      ) : !preview ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" />
          {t`Reading…`}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm">{summary(source, preview)}</p>
          {/* The choices as Settings rows, one switch each */}
          <div className="divide-y">
            {source === "zotero" && preview.zoteroCollections > 0 && (
              <FormRow
                name={t`Collections become tags`}
                help={plural(preview.zoteroCollections, { one: "# collection", other: "# collections" })}
                control={<Switch checked={tags} onCheckedChange={setTags} />}
              />
            )}
            {preview.asksParse && (
              <FormRow
                name={plural(fresh, { one: "MinerU reads the new paper's PDF", other: "MinerU reads the PDFs of the # new papers" })}
                help={t`Each one is paid for by your MinerU account. Off: pdfium alone, for this import.`}
                control={<Switch checked={parse} onCheckedChange={setParse} />}
              />
            )}
          </div>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={closeImportDialog}>
          {t`Cancel`}
        </Button>
        <Button disabled={!preview || fresh === 0 || starting} onClick={() => void start()}>
          {preview && fresh === 0 ? t`Nothing new to import` : plural(fresh, { one: "Import # paper", other: "Import # papers" })}
        </Button>
      </DialogFooter>
    </>
  )
}

// "115 papers, 82 with a PDF. 9 are in your library already."
function summary(source: ImportSource, p: ImportPreview) {
  const head =
    source === "folder"
      ? plural(p.total, { one: "# PDF", other: "# PDFs" })
      : p.withPdf
        ? plural(p.total, { one: `# paper, ${p.withPdf} with a PDF`, other: `# papers, ${p.withPdf} with a PDF` })
        : plural(p.total, { one: "# paper", other: "# papers" })
  const known = p.known ? ` ${plural(p.known, { one: "# is in your library already.", other: "# are in your library already." })}` : ""
  return `${head}.${known}`
}
