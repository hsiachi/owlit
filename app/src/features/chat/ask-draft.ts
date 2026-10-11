import { create } from "zustand"
import type { QuestionAnswer } from "@owlit/protocol"
import type { QuestionPart } from "./types"
import { useChatStore } from "./store"


// A question the agent asked, while the user works through it: which of its questions is showing and
// what they gave so far. Both the card above the composer and the composer itself answer it (typing is an
// answer of one's own), so the draft lives here rather than in the card. Sent to the agent once the last
// question has an answer.
interface Draft {
  requestId: string
  index: number
  answers: Record<string, QuestionAnswer>
}

interface AskDraftState {
  drafts: Record<string, Draft>
  draft: (chatId: string, ask: QuestionPart) => Draft
  // Picks an option of the question showing; a single choice moves on at once
  pick: (chatId: string, ask: QuestionPart, label: string) => void
  // Words of the user's own for the question showing, then on to the next
  type: (chatId: string, ask: QuestionPart, text: string) => void
  // Moves on from a question of several picks
  next: (chatId: string, ask: QuestionPart) => void
  skip: (chatId: string, ask: QuestionPart) => void
}

const fresh = (ask: QuestionPart): Draft => ({ requestId: ask.requestId, index: 0, answers: {} })

export const useAskDraft = create<AskDraftState>()((set, get) => {
  const current = (chatId: string, ask: QuestionPart) => {
    const d = get().drafts[chatId]
    return d?.requestId === ask.requestId ? d : fresh(ask)
  }
  // The next question, or the answers to the agent after the last
  const advance = (chatId: string, ask: QuestionPart, d: Draft) => {
    if (d.index + 1 < ask.questions.length) {
      set((s) => ({ drafts: { ...s.drafts, [chatId]: { ...d, index: d.index + 1 } } }))
      return
    }
    set((s) => ({ drafts: { ...s.drafts, [chatId]: d } }))
    useChatStore.getState().answerQuestion(chatId, ask.requestId, d.answers)
  }
  return {
    drafts: {},
    draft: (chatId, ask) => current(chatId, ask),
    pick(chatId, ask, label) {
      const d = current(chatId, ask)
      const q = ask.questions[d.index]
      if (!q) return
      if (q.multiSelect) {
        const picks = d.answers[q.id]?.picks ?? []
        const next = picks.includes(label) ? picks.filter((p) => p !== label) : [...picks, label]
        set((s) => ({ drafts: { ...s.drafts, [chatId]: { ...d, answers: { ...d.answers, [q.id]: { ...d.answers[q.id], picks: next } } } } }))
        return
      }
      advance(chatId, ask, { ...d, answers: { ...d.answers, [q.id]: { ...d.answers[q.id], picks: [label] } } })
    },
    type(chatId, ask, text) {
      const d = current(chatId, ask)
      const q = ask.questions[d.index]
      if (!q || !text.trim()) return
      advance(chatId, ask, { ...d, answers: { ...d.answers, [q.id]: { ...d.answers[q.id], text: text.trim() } } })
    },
    next(chatId, ask) {
      advance(chatId, ask, current(chatId, ask))
    },
    skip(chatId, ask) {
      set((s) => ({ drafts: { ...s.drafts, [chatId]: fresh(ask) } }))
      useChatStore.getState().answerQuestion(chatId, ask.requestId, null)
    },
  }
})
