import { create } from "zustand"
import type { CommentTops } from "../editor/comment-marks"

// Where each comment's words sit in an open doc, by doc id, as the editor last measured them
// (editor/comment-marks.ts), so the column can put each card level with its words
export const useCommentTops = create<Record<string, CommentTops>>(() => ({}))

export const setCommentTops = (docId: string, tops: CommentTops) => useCommentTops.setState({ [docId]: tops })

// The slot in the text the open card is drawn into while the column is folded to pins, by doc id
export const useCommentSlot = create<Record<string, HTMLElement | null>>(() => ({}))

// A slot that goes is let go only if it is still the doc's slot: the next one may have been drawn first
export const setCommentSlot = (docId: string, el: HTMLElement | null, was?: HTMLElement) =>
  useCommentSlot.setState((s) => (el || s[docId] === was ? { [docId]: el } : s))
