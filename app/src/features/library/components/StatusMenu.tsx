import { t } from "@lingui/core/macro"
import { ChoiceMenu } from "@/components/choice-menu"
import { statusOptions } from "../lib/status"
import type { ReadStatus } from "@owlit/protocol"

// Reading status as a plain text menu ("Unread ▾"). It is the only control for status, used in
// the peek and on the paper page; the list shows status only through tone.
export function StatusMenu({ value, onChange, align = "end" }: { value: ReadStatus; onChange: (status: ReadStatus) => void; align?: "start" | "end" }) {
  return <ChoiceMenu label={t`Reading status`} value={value} options={statusOptions()} onChange={onChange} align={align} />
}
