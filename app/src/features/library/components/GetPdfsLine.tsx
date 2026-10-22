import { plural, t } from "@lingui/core/macro"
import type { Paper } from "@owlit/protocol"
import { toast } from "sonner"
import { StatusLine } from "@/components/status-line"
import { Button } from "@/components/ui/button"
import { useExtension } from "@/features/extension/store"
import { browserName, startBatch, useBatch } from "@/features/extension/waits"
import { rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { pdfWait } from "../lib/pdf-wait"
import { batchView } from "../lib/pdf-batch"
import { useLibraryStore } from "../store"

// Atop the No PDF list: one action for the whole list. Every paper with a DOI that the extension in the
// user's browser could still try goes to it in one go, with their access, instead of Look again on each
// card; the block atop the Library (PdfBlock) then counts them. Hidden while a batch is being fetched, and
// a paper already in one, already with the extension, left to download by hand or that the user found
// none for on its page isn't offered again.
// Shown with no extension paired too: the one click then says what to set up, where a hidden line would
// leave the list with no way out. Papers with no DOI have no page the extension could go to: their own
// line says so, and how to add their PDFs.
export function GetPdfsLine({ papers }: { papers: Paper[] }) {
  const paired = useExtension((s) => s.view?.paired)
  const batch = useBatch((s) => s.batch)
  const all = useLibraryStore((s) => s.papers)
  const running = !!batch && batchView(batch, all).running
  const inBatch = new Set(batch?.ids)
  const lacking = papers.filter((p) => !p.pdf)
  const offered = lacking.filter((p) => p.ids.doi && !inBatch.has(p.id) && !p.pdfState?.extension && pdfWait(p) !== "manual" && pdfWait(p) !== "skipped")
  const noDoi = lacking.filter((p) => !p.ids.doi).length
  const browser = browserName(paired)
  const getPdfs = async () => {
    try {
      const { queued, noExtension } = await rpc.library.fetchPdfs({ ids: offered.map((p) => p.id) })
      if (noExtension) {
        toast(t`The owlit extension isn't connected.`, {
          description: paired?.length ? t`Open the browser it is in, then try again.` : t`Set it up in your browser from Settings › Papers, then try again.`,
        })
        return
      }
      if (queued.length) startBatch(queued)
    } catch (e) {
      toastError(e, t`Couldn't hand the papers to the extension.`)
    }
  }
  return (
    <>
      {!running && offered.length > 0 && (
        <StatusLine
          actions={
            <Button variant="text" size="inline" onClick={() => void getPdfs()}>
              {t({ message: "Get PDFs", comment: "button: every paper without a PDF goes to the browser extension, which gets them with the user's library access" })}
            </Button>
          }
        >
          <span className="truncate">{plural(offered.length, { one: `Get the PDF for # paper using ${browser}`, other: `Get PDFs for # papers using ${browser}` })}</span>
        </StatusLine>
      )}
      {noDoi > 0 && (
        <StatusLine>
          <span className="truncate">{plural(noDoi, { one: "# paper without a DOI wasn't included · drag its PDF onto it", other: "# papers without a DOI weren't included · drag their PDFs onto them" })}</span>
        </StatusLine>
      )}
    </>
  )
}
