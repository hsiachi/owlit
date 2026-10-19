import { t } from "@lingui/core/macro"
import { ChoiceMenu } from "@/components/choice-menu"
import { statusOptions } from "../lib/status"
import { useTraceTitle } from "../lib/trace"
import type { Paper, ReadStatus } from "@owlit/protocol"

// Reading status as a plain text menu ("Unread ▾"). It is the only control for status, used in
// the peek and on the paper page; the list shows status only through tone. On hover it says how far the
// person got ("12 min, pp. 1–6").
export function StatusMenu({ paper, onChange, align = "end" }: { paper: Paper; onChange: (status: ReadStatus) => void; align?: "start" | "end" }) {
  const trace = useTraceTitle(paper)
  return <ChoiceMenu label={t`Reading status`} value={paper.status} options={statusOptions()} onChange={onChange} align={align} hint={trace.title} onHint={trace.ask} />
}
