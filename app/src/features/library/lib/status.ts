import type { ReadStatus } from "../types"

export const STATUS_LABEL: Record<ReadStatus, string> = {
  unread: "Unread",
  reading: "Reading",
  read: "Read",
}

export const STATUS_ORDER: ReadStatus[] = ["unread", "reading", "read"]
