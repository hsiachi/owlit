import { plural, t } from "@lingui/core/macro"
import type { Paper } from "@owlit/protocol"
import { toast } from "sonner"
import { StatusLine } from "@/components/status-line"
import { Button } from "@/components/ui/button"
import { useExtension } from "@/features/extension/store"
import { followBatch } from "@/features/extension/waits"
import { rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"

// Atop the No PDF list: one action for the whole list. Every paper with a DOI goes to the extension in
// the user's browser in one go, with their access, instead of Look again on each card; what comes of it
// is said at the top of the Library (ExtensionWaitLines' batch line) until put away. Papers with no DOI
// have no page the extension could go to, so they are left out and the count says so. Shown with no
// extension paired too: the one click then says what to set up, where a hidden line would leave the
// list with no way out.
export function GetAllLine({ papers }: { papers: Paper[] }) {
  const paired = useExtension((s) => !s.view || s.view.paired.length > 0)
  const withDoi = papers.filter((p) => !p.pdf && p.ids.doi)
  if (!withDoi.length) return null
  const without = papers.length - withDoi.length
  const getAll = async () => {
    try {
      const { queued, noExtension } = await rpc.library.fetchPdfs({ ids: withDoi.map((p) => p.id) })
      if (noExtension) {
        toast(t`The owlit extension isn't connected.`, {
          description: paired ? t`Open the browser it is in, then try again.` : t`Set it up in your browser from Settings › Papers, then try again.`,
        })
        return
      }
      if (!queued.length) return
      followBatch(queued)
    } catch (e) {
      toastError(e, t`Couldn't hand the papers to the extension.`)
    }
  }
  return (
    <StatusLine
      actions={
        <Button variant="text" size="inline" onClick={() => void getAll()}>
          {t({ message: "Get them all with my access", comment: "button: every paper without a PDF goes to the browser extension, with the user's library access" })}
        </Button>
      }
    >
      <span className="truncate">
        {plural(withDoi.length, { one: "# paper your browser can try", other: "# papers your browser can try" })}
        {without > 0 && (
          <>
            {" · "}
            {plural(without, { one: "# without a DOI", other: "# without a DOI" })}
          </>
        )}
      </span>
    </StatusLine>
  )
}
