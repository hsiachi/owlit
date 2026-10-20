import { t } from "@lingui/core/macro"
import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { isTaskFinished, type ChatAbout, type Paper } from "@owlit/protocol"
import { toast } from "sonner"
import { notifyWhenAway } from "@/lib/notify"
import { isDesktop, rpc } from "@/lib/rpc"
import { routeSubject } from "@/app/route-subject"
import { useDigestUnseen } from "@/app/seen"
import { aboutKey, asking, mockStarted, standOf, stopStarted, useStand, useStarted } from "@/features/chat/started"
import { useLibraryStore } from "./store"
import { tasksFor, useTasksStore } from "@/features/tasks/store"

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

// Owlit is getting the paper's text (or its figures) before its digest's chat can start: asked for, no
// chat yet, and the paper has no text or a task that reads it is still on the scheduler
export function useGettingText(paper: Paper) {
  const asked = useStand(digestAbout(paper.id))
  const reading = useTasksStore((s) => tasksFor(s.byId, paper.id).some((task) => !isTaskFinished(task) && READS_TEXT.has(task.kind)))
  return asked?.state === "running" && !asked.chatId && (!paper.text || reading)
}

const READS_TEXT = new Set(["paper.text", "paper.parse", "paper.figures"])

// Starts Owlit writing the paper's digest, saying so when that failed; resolves to whether it was asked
// for (its chat may start only once the paper's text is read)
export async function askDigest(paper: Paper, rewrite: boolean): Promise<boolean> {
  const about = digestAbout(paper.id)
  if (!isDesktop) return (mockDigest(paper), true)
  asking(about, true)
  try {
    const asked = await rpc.library.requestDigest({ id: paper.id, rewrite })
    if ("chatId" in asked || "gettingText" in asked) return true
    asking(about, false)
    if (asked.heldBack === "nothing-to-read") toast.error(t`This paper has no PDF or text for Owlit to read.`)
    return false
  } catch (error) {
    asking(about, false)
    toast.error((error instanceof Error && error.message) || t`Couldn't ask for a digest.`)
    return false
  }
}

// Without core (pnpm dev:web) a paper with no text has it read for a moment first, so the line that says
// so can be seen
function mockDigest(paper: Paper) {
  const about = digestAbout(paper.id)
  if (paper.text) return mockStarted(about)
  asking(about, true)
  setTimeout(() => mockStarted(about), MOCK_TEXT_MS)
}

const MOCK_TEXT_MS = 3000

// Asks for the digest again (Retry: a new turn in the chat that broke, or a new chat when the recipe
// changed since), and waits for it
export function retryDigest(paper: Paper) {
  waitForDigest(paper.id)
  return askDigest(paper, !!paper.hasDigest)
}

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

// How long a reply that ended well is given for its digest to arrive before the wait is dropped: the
// paper's change (hasDigest) can reach the renderer after the chat's turn has finished
const SETTLE_MS = 15_000

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
    // One timer for replies that ended well without a digest yet, however many changes come meanwhile
    let settle: ReturnType<typeof setTimeout> | undefined
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
        if (stand?.state !== "failed" && Date.now() - (reply.finishedAt ?? 0) < SETTLE_MS) {
          settle ??= setTimeout(() => {
            settle = undefined
            check()
          }, SETTLE_MS)
          continue
        }
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
      clearTimeout(settle)
    }
  }, [navigate])
}
