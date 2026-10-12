import type { ReadStatus } from "../types"

export const STATUS_LABEL: Record<ReadStatus, string> = {
  unread: "Unread",
  reading: "Reading",
  read: "Read",
}

export const STATUS_ORDER: ReadStatus[] = ["unread", "reading", "read"]

// The choices of a status menu (ChoiceMenu)
export const STATUS_OPTIONS = STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] }))
