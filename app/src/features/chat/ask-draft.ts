import { create } from "zustand"
import type { AgentQuestion, QuestionAnswer } from "@owlit/protocol"
import type { QuestionPart } from "./types"
import { toggle } from "@/lib/multi-select"
import { useChatStore } from "./store"

// A question the agent asked, while the user works through it: which of its questions is showing, what
// they gave so far, and whether the card is folded to its line. Both the card above the composer and the
// composer itself answer it (typing is an answer of one's own), so the draft lives here rather than in the
// card. Sent to the agent when the user submits, once every question has an answer; a single pick moves on
// to the next question still open but never submits by itself, so the questions can be revisited with the
// pager.
interface Draft {
  requestId: string
  index: number
  answers: Record<string, QuestionAnswer>
  folded: boolean
}

interface AskDraftState {
  drafts: Record<string, Draft>
  // Picks an option of the question showing; a single choice moves on to the next question without an answer
  pick: (chatId: string, ask: QuestionPart, label: string) => void
  // Words of the user's own for the question showing; sent at once when they complete the answers
  type: (chatId: string, ask: QuestionPart, text: string) => void
  // Shows another of the questions
  goTo: (chatId: string, ask: QuestionPart, index: number) => void
  // Moves on to the next question without an answer
  next: (chatId: string, ask: QuestionPart) => void
  // Sends the answers, once every question has one
  submit: (chatId: string, ask: QuestionPart) => void
  skip: (chatId: string, ask: QuestionPart) => void
  fold: (chatId: string, ask: QuestionPart, folded: boolean) => void
}

const fresh = (ask: QuestionPart): Draft => ({ requestId: ask.requestId, index: 0, answers: {}, folded: false })

// Whether one question has an answer: a pick, or words of the user's own
export const answered = (q: AgentQuestion, answers: Record<string, QuestionAnswer>) => {
  const a = answers[q.id]
  return !!a?.picks?.length || !!a?.text?.trim()
}

export const allAnswered = (ask: QuestionPart, answers: Record<string, QuestionAnswer>) => ask.questions.every((q) => answered(q, answers))

// The first question after `from` still without an answer, if any
export const nextOpen = (ask: QuestionPart, answers: Record<string, QuestionAnswer>, from: number) => {
  const i = ask.questions.findIndex((q, j) => j > from && !answered(q, answers))
  return i === -1 ? undefined : i
}

export const useAskDraft = create<AskDraftState>()((set, get) => {
  const current = (chatId: string, ask: QuestionPart) => {
    const d = get().drafts[chatId]
    return d?.requestId === ask.requestId ? d : fresh(ask)
  }
  const put = (chatId: string, d: Draft) => set((s) => ({ drafts: { ...s.drafts, [chatId]: d } }))
  const withAnswer = (d: Draft, q: AgentQuestion, answer: QuestionAnswer): Draft => ({ ...d, answers: { ...d.answers, [q.id]: { ...d.answers[q.id], ...answer } } })
  // On to the next question still open; the last one stays showing until the user submits
  const advanced = (ask: QuestionPart, d: Draft): Draft => ({ ...d, index: nextOpen(ask, d.answers, d.index) ?? d.index })
  const send = (chatId: string, ask: QuestionPart, d: Draft) => {
    put(chatId, d)
    useChatStore.getState().answerQuestion(chatId, ask.requestId, d.answers)
  }
  return {
    drafts: {},
    pick(chatId, ask, label) {
      const d = current(chatId, ask)
      const q = ask.questions[d.index]
      if (!q) return
      if (q.multiSelect) {
        put(chatId, withAnswer(d, q, { picks: toggle(d.answers[q.id]?.picks ?? [], label) }))
        return
      }
      put(chatId, advanced(ask, withAnswer(d, q, { picks: [label] })))
    },
    type(chatId, ask, text) {
      const d = current(chatId, ask)
      const q = ask.questions[d.index]
      if (!q || !text.trim()) return
      // Typing is sending: with every question answered the words go to the agent at once
      const next = withAnswer(d, q, { text: text.trim() })
      if (allAnswered(ask, next.answers)) send(chatId, ask, next)
      else put(chatId, advanced(ask, next))
    },
    goTo(chatId, ask, index) {
      if (!ask.questions[index]) return
      put(chatId, { ...current(chatId, ask), index })
    },
    next(chatId, ask) {
      put(chatId, advanced(ask, current(chatId, ask)))
    },
    submit(chatId, ask) {
      const d = current(chatId, ask)
      if (allAnswered(ask, d.answers)) send(chatId, ask, d)
    },
    skip(chatId, ask) {
      put(chatId, fresh(ask))
      useChatStore.getState().answerQuestion(chatId, ask.requestId, null)
    },
    fold(chatId, ask, folded) {
      put(chatId, { ...current(chatId, ask), folded })
    },
  }
})
