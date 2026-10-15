import { useMemo } from "react"
import { useShareStore } from "../share/store"
import { useDocsStore } from "../store"
import { commentViews, type CommentView } from "./model"

// The open comments on a doc, Owlit's, yours and share readers', merged
export function useCommentViews(fileId: string): CommentView[] {
  const own = useDocsStore((s) => s.comments[fileId])
  const path = useDocsStore((s) => s.files[fileId]?.path ?? "")
  const readers = useShareStore((s) => s.comments[path])
  return useMemo(() => commentViews(own, readers), [own, readers])
}
