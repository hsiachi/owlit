import { t } from "@lingui/core/macro"
import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import type { ChatAbout, Paper } from "@owlit/protocol"
import { toast } from "sonner"
import { notifyWhenAway } from "@/lib/notify"
import { isDesktop, rpc } from "@/lib/rpc"
import { routeSubject } from "@/app/route-subject"
import { useDigestUnseen } from "@/app/seen"
import { aboutKey, asking, heardStarted, standOf, stopStarted, useStand, useStarted } from "@/features/chat/started"
import { useLibraryStore } from "./store"

// Where a paper's digest stands for the user, on the ladder of states (DESIGN.md, rule 3): being written,
// new since they last looked, or stopped. A digest is written in a chat owlit starts about the paper
// (core's library.requestDigest); its running turn, or the sentence its last reply ended with, is read by
// what the chat is about (features/chat/started.ts). And who is told when one is done: only someone
// waiting for it, that is who saw it being written on the paper's page or asked for it from the paper's
// menu. One asked for in a chat or by an agent only leaves its mark.

const digestAbout = (paperId: string): ChatAbout => ({ kind: "paper", id: paperId })

// The mark a paper's row and page show for its digest: writing while it is under way (asked for, its
// text being read, or its chat at work), stopped, or new.
export type DigestState = "writing" | "failed" | "new" | null

export function useDigestState(paper: Paper): DigestState {
  const stand = useStand(digestAbout(paper.id))
  // New since the user last looked (protocol's digestUnseen, which core answers)
  const fresh = useDigestUnseen(paper.id)
  return stand?.state === "failed" ? "failed" : stand?.state === "running" ? "writing" : fresh ? "new" : null
}

// Whether a paper has a digest new since the user looked, by id (Home's rows, which hold no paper)
export const useNewDigest = useDigestUnseen

// Owlit is writing the paper's digest, whoever asked
export function useWritingDigest(paperId: string) {
  return useStand(digestAbout(paperId))?.state === "running"
}

// Why the last try at the paper's digest broke, in the words its reply ended with; null when it didn't.
// Read from core's chat, so it is still said after a restart.
export function useDigestFailure(paperId: string): string | null {
  const stand = useStand(digestAbout(paperId))
  return stand?.state === "failed" ? (stand.reply.error ?? t`Owlit couldn't write a digest of this paper.`) : null
}

export function stopDigest(paperId: string) {
  stopStarted(digestAbout(paperId))
}

// Starts Owlit writing the paper's digest, saying so when that failed; resolves to whether it was started
export async function askDigest(paper: Paper, rewrite: boolean): Promise<boolean> {
  const about = digestAbout(paper.id)
  if (!isDesktop) return mockDigest(about)
  asking(about, true)
  try {
    const asked = await rpc.library.requestDigest({ id: paper.id, rewrite })
    if ("chatId" in asked) return true
    asking(about, false)
    if (asked.heldBack === "nothing-to-read") toast.error(t`This paper has no PDF or text for Owlit to read.`)
    return false
  } catch (error) {
    asking(about, false)
    toast.error((error instanceof Error && error.message) || t`Couldn't ask for a digest.`)
    return false
  }
}

// Asks for the digest again (Retry: a new turn in the chat that broke), and waits for it
export function retryDigest(paper: Paper) {
  waitForDigest(paper.id)
  return askDigest(paper, !!paper.hasDigest)
}

// Without core (pnpm dev:web) a digest asked for is written for a few seconds and then cut off, so both
// the line that says it is being written and the one that says why it stopped can be seen
function mockDigest(about: ChatAbout) {
  const chatId = `mock-${aboutKey(about)}`
  const reply = { id: `${chatId}-${Date.now()}`, role: "assistant" as const, parts: [], createdAt: Date.now() }
  heardStarted({ chatId, about, reply: { ...reply, status: "streaming" } })
  setTimeout(() => {
    if (useStarted.getState().byAbout[aboutKey(about)]?.reply?.id !== reply.id) return
    heardStarted({ chatId, about, reply: { ...reply, status: "error", error: t`Owlit was closed before it finished.`, cutOff: "closed", finishedAt: Date.now() } })
  }, MOCK_WRITING_MS)
  return Promise.resolve(true)
}

const MOCK_WRITING_MS = 4000

// ---- Telling the one waiting ----

// Papers whose digest someone is waiting for, and since when; kept for this session
const waiting = new Map<string, number>()
// The paper whose digest is on screen now
let onScreen: string | null = null

export function waitForDigest(id: string) {
  if (!waiting.has(id)) waiting.set(id, Date.now())
}

// The digest view says it is showing; returns the call that says it no longer is
export function showingDigest(id: string) {
  onScreen = id
  return () => {
    if (onScreen === id) onScreen = null
  }
}

// Watches the waited-for digests from the shell. Done or stopped, the user hears it where they are: on the
// paper's page nothing is said (its switch carries the mark); elsewhere in owlit a toast that opens the
// digest; with owlit behind other windows a system notification too, as a chat waiting on them does.
export function useDigestNotices() {
  const navigate = useNavigate()
  useEffect(() => {
    const onPaperPage = (id: string) => {
      const subject = routeSubject(window.location.pathname)
      return document.hasFocus() && subject?.kind === "paper" && subject.id === id
    }
    const check = () => {
      const papers = useLibraryStore.getState().papers
      const started = useStarted.getState()
      for (const [id, since] of waiting) {
        const paper = papers[id]
        if (!paper) {
          waiting.delete(id)
          continue
        }
        if (paper.hasDigest && (paper.digestAt ?? 0) >= since) {
          waiting.delete(id)
          if (onPaperPage(id)) continue
          const open = () => navigate(`/library/${id}`)
          toast(t`Digest ready`, { description: paper.title, action: { label: t({ message: "Open", comment: "toast button: open the paper's digest" }), onClick: open }, duration: 10_000 })
          notifyWhenAway({ title: t`Digest ready`, body: paper.title, onClick: open })
          continue
        }
        const stand = standOf(started, digestAbout(id))
        if (stand?.state === "running") continue
        const reply = started.byAbout[aboutKey(digestAbout(id))]?.reply
        if (!reply || (reply.finishedAt ?? 0) < since) continue
        waiting.delete(id)
        // On the paper's page the Digest side says it already
        if (stand?.state !== "failed" || onPaperPage(id) || (onScreen === id && document.hasFocus())) continue
        const retry = () => void retryDigest(paper)
        toast(t`Couldn't write the digest`, { description: paper.title, action: { label: t`Retry`, onClick: retry }, duration: 10_000 })
        notifyWhenAway({ title: t`Couldn't write the digest`, body: paper.title, onClick: () => navigate(`/library/${id}`) })
      }
    }
    const offPapers = useLibraryStore.subscribe((s, prev) => s.papers !== prev.papers && check())
    const offStarted = useStarted.subscribe((s, prev) => s.byAbout !== prev.byAbout && check())
    return () => {
      offPapers()
      offStarted()
    }
  }, [navigate])
}
