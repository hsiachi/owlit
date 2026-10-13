import { t } from "@lingui/core/macro"
import type { ReadStatus } from "../types"

// What each status is called where it is shown; the stored value stays the English id
export function statusLabel(status: ReadStatus): string {
  switch (status) {
    case "unread":
      return t({ message: "Unread", comment: "reading status of a paper" })
    case "reading":
      return t({ message: "Reading", comment: "reading status of a paper: being read now" })
    case "read":
      return t({ message: "Read", comment: "reading status of a paper: finished reading (past participle)" })
  }
}

export const STATUS_ORDER: ReadStatus[] = ["unread", "reading", "read"]

// The choices of a status menu (ChoiceMenu)
export const statusOptions = () => STATUS_ORDER.map((s) => ({ value: s, label: statusLabel(s) }))
