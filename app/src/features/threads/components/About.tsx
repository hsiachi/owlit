import { plural, t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { chatUri, type ThreadRead, type ThreadBatch, type ThreadSearch } from "@owlit/protocol"
import { useEffect, useState } from "react"
import { FoldButton } from "@/components/fold"
import { GroupLabel } from "@/components/group-label"
import { MentionLink } from "@/components/mention/mention-token"
import { Unfold } from "@/components/unfold"
import { useChatStore } from "@/features/chat/store"
import { mentionRoute } from "@/features/docs/lib/mentions"
import { isDesktop, rpc } from "@/lib/rpc"
import { shortDate } from "@/lib/time"
import { shown } from "../lib"

// Where the thread came from and how Owlit worked on it, at the page's end so the page opens on the
// reading itself. A record, a step under the report: the question, then Owlit's work in batches as rows of a
// log (when, what set it going, what it added), each with its searches folded under it and what Owlit
// said the search couldn't reach. Core works the batches out from the thread's history.
export function About({ thread: c }: { thread: ThreadRead }) {
  const batches = useBatches(c)
  const rows = shown(c).rows
  const read = rows.filter((r) => Object.values(r.cells).some((cell) => cell.depth === "full")).length
  const titles = rows.filter((r) => Object.values(r.cells).some((cell) => cell.depth === "title")).length
  const papers = rows.length
  return (
    <section className="mt-12 max-w-[68ch]">
      <GroupLabel className="px-0">{t`About this thread`}</GroupLabel>
      <Question thread={c} />
      {batches === null &&
        // Without core (the browser preview) there is no history: the later questions as they are kept
        (c.alsoAsked ?? []).map((a, i) => {
          const later = a.text
          const on = shortDate(a.at)
          return (
            <p key={i} className="text-detail text-muted-foreground">
              <Trans comment="a later question Owlit answered by adding to this thread">
                Then <span className="text-foreground">“{later}”</span>, {on}.
              </Trans>
            </p>
          )
        })}
      {batches && batches.length > 0 && (
        <ol className="mt-3 flex flex-col gap-3">
          {batches.map((b, i) => (
            <Batch key={`${b.at}-${i}`} batch={b} first={i === 0} askedIn={c.asked.chatId} />
          ))}
        </ol>
      )}
      <div className="mt-3 flex flex-col gap-0.5 text-detail text-muted-foreground">
        {papers > 0 && (
          <p>
            {t`Read ${read} of the ${papers} papers in full; the rest are from their abstracts.`}
            {titles > 0 && ` ${plural(titles, { one: "# had no abstract and is from its title only.", other: "# had no abstract and are from their titles only." })}`}
          </p>
        )}
      </div>
    </section>
  )
}

// Owlit's batches, again whenever the thread changes; null without core
function useBatches(c: ThreadRead) {
  const [batches, setBatches] = useState<ThreadBatch[] | null>(null)
  useEffect(() => {
    if (!isDesktop) return
    let live = true
    void rpc.threads
      .about({ id: c.id })
      .then((b) => live && setBatches(b))
      .catch(() => live && setBatches([]))
    return () => {
      live = false
    }
  }, [c.id, c.updatedAt])
  return batches
}

// The question as the user asked it, in ink: where and when
function Question({ thread: c }: { thread: ThreadRead }) {
  const question = c.asked
  const chat = useChatStore((s) => (question.chatId ? s.chats[question.chatId] : undefined))
  const asked = question.text
  const when = shortDate(question.at)
  const from = question.chatId && (chat || !isDesktop) ? chatUri(question.chatId) : undefined
  const chatTitle = chat?.title || t`a chat`
  return (
    <p className="text-detail text-muted-foreground">
      {from ? (
        <Trans>
          You asked <span className="text-sm text-foreground">“{asked}”</span> in <MentionLink label={chatTitle} to={mentionRoute(from)} />, {when}.
        </Trans>
      ) : (
        <Trans>
          You asked <span className="text-sm text-foreground">“{asked}”</span>, {when}.
        </Trans>
      )}
    </p>
  )
}

// One batch as a row of the log: the day in a muted column, what happened in ink, then in muted text how
// Owlit searched, what it said it couldn't reach, and its searches folded
function Batch({ batch: b, first, askedIn }: { batch: ThreadBatch; first: boolean; askedIn?: string }) {
  const [open, setOpen] = useState(false)
  const followed = new Set(b.searches.filter((s) => s.kind === "references" || s.kind === "cited_by" || s.kind === "similar").map((s) => s.query)).size
  const searched = b.searches.length - b.searches.filter((s) => s.kind === "references" || s.kind === "cited_by" || s.kind === "similar").length
  const how = [
    searched > 0 && plural(searched, { one: "Searched once", other: "Searched # times" }),
    followed > 0 && plural(followed, { one: "followed the citations of # paper", other: "followed the citations of # papers" }),
  ].filter(Boolean)
  return (
    <li className="grid grid-cols-[4.5rem_1fr] gap-x-3">
      <span className="pt-px text-detail text-muted-foreground tabular-nums">{shortDate(b.at)}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm text-foreground">
          <BatchTitle batch={b} first={first} askedIn={askedIn} />
        </p>
        {how.length > 0 && <p className="text-detail text-muted-foreground">{how.join(" · ")}</p>}
        {b.notes.map((n, i) => (
          <p key={i} className="text-detail text-muted-foreground">
            {n}
          </p>
        ))}
        {b.searches.length > 0 && (
          <div className="mt-0.5">
            <FoldButton open={open} onClick={() => setOpen((o) => !o)}>
              {t({ message: "Searches", comment: "fold: the searches Owlit made for one batch of a thread" })}
            </FoldButton>
            <Unfold open={open}>
              <ul className="mt-1 flex flex-col gap-1 pl-5 text-detail text-muted-foreground">
                {b.searches.map((s, i) => (
                  <SearchLine key={i} search={s} />
                ))}
              </ul>
            </Unfold>
          </div>
        )}
      </div>
    </li>
  )
}

// What set the batch going and what it did: "Gathered · 10 papers", "Found more papers · +4 papers",
// "Read in full · the answers for 3 papers changed"
function BatchTitle({ batch: b, first, askedIn }: { batch: ThreadBatch; first: boolean; askedIn?: string }) {
  const chat = useChatStore((s) => (b.chatId ? s.chats[b.chatId] : undefined))
  const added = b.added
  const answered = b.answered
  const what =
    added > 0
      ? first
        ? plural(added, { one: "# paper", other: "# papers" })
        : plural(added, { one: "+# paper", other: "+# papers" })
      : answered > 0
        ? b.trigger === "read"
          ? plural(answered, { one: "the answers for # paper changed", other: "the answers for # papers changed" })
          : plural(answered, { one: "# answer", other: "# answers" })
        : t({ message: "nothing new", comment: "a batch of Owlit's work on a thread that added nothing" })
  const column = b.columns[0]
  // The chat the question was asked in is named with the question; its first batch is the gathering
  if (b.trigger === "chat" && !(first && b.chatId === askedIn && !b.asked)) {
    const label = chat?.title || t`a chat`
    const link = b.chatId ? <MentionLink label={label} to={mentionRoute(chatUri(b.chatId))} /> : label
    const asked = b.asked
    return asked ? (
      <Trans comment="a batch of a thread: Owlit added papers in a chat, for a later question">
        In {link}, for “{asked}” · {what}
      </Trans>
    ) : (
      <Trans comment="a batch of a thread: Owlit added papers in a chat">
        In {link} · {what}
      </Trans>
    )
  }
  const name =
    b.trigger === "more"
      ? t({ message: "Found more papers", comment: "a batch of a thread: the user asked Owlit to find more" })
      : b.trigger === "read"
        ? t({ message: "Read in full", comment: "a batch of a thread: Owlit read the papers' full texts" })
        : b.trigger === "fill" && column
          ? t({ message: `Answered “${column}”`, comment: "a batch of a thread: Owlit answered a column's question for every paper" })
          : first || b.trigger === "gather"
            ? t({ message: "Gathered", comment: "a batch of a thread: Owlit's first search for papers" })
            : t({ message: "Owlit", comment: "a batch of a thread Owlit made without saying why" })
  return (
    <>
      {name} · {what}
    </>
  )
}

const SOURCES: Record<string, string> = { openalex: "OpenAlex", s2: "Semantic Scholar", arxiv: "arXiv", crossref: "Crossref" }

// One search: its words in quotes, or the paper it followed; at the right, the source and how many it kept
// of what it found
function SearchLine({ search: s }: { search: ThreadSearch }) {
  const source = SOURCES[s.source] ?? s.source
  const kept = s.kept
  const found = s.found
  const tally = found
    ? t({ message: `kept ${kept} of ${found}`, comment: "of the papers a search found, how many became rows" })
    : t({ message: "nothing found", comment: "a search that found no papers" })
  const of = s.of ?? s.query
  const what =
    s.kind === "references"
      ? t`References of ${of}`
      : s.kind === "cited_by"
        ? t`Papers citing ${of}`
        : s.kind === "similar"
          ? t`Papers like ${of}`
          : s.kind === "listing"
            ? s.query
            : `“${s.query}”`
  return (
    <li className="flex items-baseline gap-4">
      <span className="min-w-0 flex-1">{what}</span>
      <span className="shrink-0 tabular-nums whitespace-nowrap">
        {source} · {tally}
      </span>
    </li>
  )
}
