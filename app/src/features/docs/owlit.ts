// Owlit and each doc: the comments it left that the user hasn't seen

import { isOpenComment, isOwlit } from "@owlit/protocol"
import { useShallow } from "zustand/react/shallow"
import { unseenComments, useSeen } from "@/app/seen"
import { useDocsStore } from "./store"

// Owlit's open comments on a doc that came after the user last saw its comments, oldest first: they carry
// Owlit's dot on the chip and the doc's row until they have been on screen a moment
export function useNewOwlitComments(file: { id: string; path: string } | undefined) {
  const unseen = useSeen(useShallow((s) => (file ? unseenComments(s.unseen, file.path) : [])))
  return useDocsStore(
    useShallow((s) =>
      (file ? (s.comments[file.id] ?? []) : [])
        .filter((c) => isOpenComment(c) && !!c.entries[0] && isOwlit(c.entries[0].by) && unseen.includes(c.id))
        .sort((a, b) => a.createdAt - b.createdAt),
    ),
  )
}
