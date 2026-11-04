import { plural, t } from "@lingui/core/macro"
import type { Paper } from "@owlit/protocol"
import { toast } from "sonner"
import { StatusLine } from "@/components/status-line"
import { Button } from "@/components/ui/button"
import { useExtension, usePdfRun } from "@/features/extension/store"
import { browserName, walkManual } from "@/features/extension/waits"
import { rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { pdfWait } from "../lib/pdf-wait"

// Atop the No PDF list: one action for the whole list. Every paper with a DOI that the extension in the
// user's browser could still try goes to it in one go, with their access, instead of Look again on each
// card; core keeps them as one run, which the block atop the Library (PdfBlock) then counts. Hidden while
// a run is going, and a paper already in the one shown, already with the extension, left to download by
// hand or that the user found none for on its page isn't offered again, except one of the run's that
// never reached the extension (it still reads Finding, with nothing holding it).
// Shown with no extension paired too: the one click then says what to set up, where a hidden line would
// leave the list with no way out. Papers with no DOI have no page the extension could go to: their own
// line says so, and how to add their PDFs.
export function GetPdfsLine({ papers }: { papers: Paper[] }) {
  const paired = useExtension((s) => s.view?.paired)
  const run = usePdfRun()
  const running = !!run?.running
  const inRun = new Set(run?.ids)
  const lacking = papers.filter((p) => !p.pdf)
  const unreached = (p: Paper) => pdfWait(p) === "finding" || pdfWait(p) === "offline"
  const offered = lacking.filter((p) => p.ids.doi && (!inRun.has(p.id) || unreached(p)) && !p.pdfState?.extension && pdfWait(p) !== "manual" && pdfWait(p) !== "skipped")
  const noDoi = lacking.filter((p) => !p.ids.doi).length
  const manual = lacking.filter((p) => pdfWait(p) === "manual")
  const manualDoi = manual.map((p) => p.ids.doi).find(Boolean)
  const manualCount = manual.length
  const browser = browserName(paired)
  const getPdfs = async () => {
    try {
      const { noExtension } = await rpc.library.fetchPdfs({ ids: offered.map((p) => p.id) })
      if (noExtension) {
        toast(t`The owlit extension isn't connected.`, {
          description: paired?.length ? t`Open the browser it is in, then try again.` : t`Set it up in your browser from Settings › Papers, then try again.`,
        })
        return
      }
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
      {/* Without a run (the block's manual row gone with it), the papers to download by hand keep their
          way into the walk through them */}
      {!run?.total && manual.length > 0 && manualDoi && (
        <StatusLine
          actions={
            <Button variant="text" size="inline" onClick={() => void walkManual(manual.map((p) => p.id), `https://doi.org/${manualDoi}`)}>
              {t({ message: `Open in ${browser}`, comment: "button: opens a paper's page in the browser the owlit extension is in, e.g. Open in Dia" })}
            </Button>
          }
        >
          <span className="truncate">{plural(manualCount, { one: "# paper needs a manual download", other: "# papers need a manual download" })}</span>
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
