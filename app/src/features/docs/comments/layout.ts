import { create } from "zustand"
import type { CommentTops } from "../editor/comment-marks"

// Where each comment's words sit in an open doc, by doc id, as the editor last measured them
// (editor/comment-marks.ts), so the column can put each card level with its words
export const useCommentTops = create<Record<string, CommentTops>>(() => ({}))

export const setCommentTops = (docId: string, tops: CommentTops) => useCommentTops.setState({ [docId]: tops })
