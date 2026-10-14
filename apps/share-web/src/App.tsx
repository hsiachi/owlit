import { plural, t } from "@lingui/core/macro"
import type { ShareAnchor, ShareBundle, ShareComment, SharedPaper } from "@owlit/protocol"
import { ArrowLeftIcon, ArrowUpRightIcon, LockIcon, MessageSquareIcon, XIcon } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { anchorOfRange, paint, rangeAtPoint, rangesFor } from "./anchors"
import { follow, loadComments, loadShare, postComment, storedName, storeName, type Loaded } from "./api"
import { citationsOf, type Citation } from "./citations"
import { Markdown } from "./Markdown"
import { ago } from "./time"

// The reader's page for one shared doc: the doc, the papers it cites, and comments. Everything comes from
// the share server, and follows it live: the author's edits and others' comments appear as they land.

type Panel = { kind: "paper"; id: string } | { kind: "thread"; id: string } | { kind: "new"; anchor: ShareAnchor } | { kind: "threads" }

interface Thread {
  root: ShareComment & { anchor: ShareAnchor }
  replies: ShareComment[]
}

const shareIdOf = (pathname: string) => /^\/s\/([A-Za-z0-9_-]+)\/?$/.exec(pathname)?.[1] ?? null

// Where a page of a paper can be read: arXiv's PDF opens at a page; other sources can't be pointed at one
function pageHref(paper: SharedPaper | undefined, page: number) {
  const arxiv = paper?.url && /^https:\/\/arxiv\.org\/abs\/(.+)$/.exec(paper.url)?.[1]
  return arxiv ? `https://arxiv.org/pdf/${arxiv}#page=${page}` : undefined
}

const meta = (paper: SharedPaper) => [paper.authors.length > 2 ? t`${paper.authors[0]} et al.` : paper.authors.join(", "), paper.year, paper.venue].filter(Boolean).join(" · ")

export function App() {
  const shareId = useMemo(() => shareIdOf(window.location.pathname), [])
  const [loaded, setLoaded] = useState<Loaded | { kind: "loading" }>({ kind: "loading" })
  const [comments, setComments] = useState<ShareComment[]>([])
  const [tab, setTab] = useState<"doc" | "papers">("doc")
  const [paperPage, setPaperPage] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [lost, setLost] = useState<string[]>([])
  const [flash, setFlash] = useState<{ anchor: ShareAnchor; key: number } | null>(null)
  const [name, setName] = useState(storedName)

  const reload = useCallback(async () => {
    if (!shareId) return
    const next = await loadShare(shareId)
    // A blip while following keeps what is already on the page
    setLoaded((prev) => (next.kind === "offline" && prev.kind === "ok" ? prev : next))
  }, [shareId])
  const reloadComments = useCallback(async () => {
    if (!shareId) return
    const next = await loadComments(shareId)
    if (next) setComments(next)
  }, [shareId])

  useEffect(() => {
    if (!shareId) {
      setLoaded({ kind: "missing" })
      return
    }
    void reload()
    void reloadComments()
  }, [shareId, reload, reloadComments])

  // Following starts once the share has said how (its live channel)
  const live = loaded.kind === "ok" ? (loaded.view.live ?? "events") : null
  useEffect(() => {
    if (!shareId || !live) return
    return follow(shareId, live, { update: reload, comments: reloadComments, stopped: () => setLoaded({ kind: "stopped" }) })
  }, [shareId, live, reload, reloadComments])

  const view = loaded.kind === "ok" ? loaded.view : null
  useEffect(() => {
    document.title = view ? `${view.bundle.title} · owlit` : "owlit"
  }, [view])

  const threads = useMemo<Thread[]>(() => {
    const roots = comments.filter((c): c is Thread["root"] => !c.parent && !!c.anchor)
    return roots.map((root) => ({ root, replies: comments.filter((c) => c.parent === root.id) }))
  }, [comments])

  if (loaded.kind === "loading") return <Empty title={t`Opening…`} />
  if (loaded.kind === "missing") return <Empty title={t`There is nothing at this link`} detail={t`Check that the whole link was copied, or ask for it again.`} />
  if (loaded.kind === "stopped") return <Empty title={t`The author stopped sharing this doc`} detail={t`Ask them for a new link if you still need it.`} />
  if (loaded.kind === "offline" || !view)
    return (
      <Empty title={t`Couldn't reach the server`} detail={t`Check your connection.`}>
        <button type="button" onClick={() => void reload()} className="mt-2 h-8 rounded-[10px] border border-input bg-card px-3 font-medium hover:bg-muted">
          {t`Try again`}
        </button>
      </Empty>
    )

  const { bundle } = view
  const canComment = view.permission === "comment"
  const openThread = panel?.kind === "thread" ? panel.id : null
  const openPaper = (id: string) => setPanel({ kind: "paper", id })
  const goTo = (citation: Citation) => {
    setTab("doc")
    setPaperPage(null)
    setFlash({ anchor: citation.anchor, key: Date.now() })
  }
  const paperCount = Object.keys(bundle.papers).length
  const openThreads = threads.filter((th) => !th.root.resolved)

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-5 border-b-[0.5px] border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Feather />
          <span className="truncate font-medium">{bundle.title}</span>
          {bundle.author && <span className="hidden shrink-0 text-detail text-muted-foreground sm:inline">· {t`Shared by ${bundle.author}`}</span>}
        </div>
        <nav className="flex gap-4 self-stretch">
          <Tab on={tab === "doc"} onClick={() => setTab("doc")}>
            {t`Doc`}
          </Tab>
          {paperCount > 0 && (
            <Tab
              on={tab === "papers"}
              onClick={() => {
                setTab("papers")
                setPaperPage(null)
              }}
            >
              {t`Cited papers`} <span className="text-xs font-normal text-muted-foreground tabular-nums">{paperCount}</span>
            </Tab>
          )}
        </nav>
        <div className="flex-1" />
        {!canComment && (
          <span className="hidden items-center gap-1.5 text-detail text-muted-foreground sm:flex">
            <LockIcon className="size-3.5" />
            {t`Read only`}
          </span>
        )}
        {threads.length > 0 && (
          <button type="button" onClick={() => setPanel({ kind: "threads" })} className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-detail text-muted-foreground hover:bg-muted hover:text-foreground">
            <MessageSquareIcon className="size-3.5" />
            {openThreads.length ? plural(openThreads.length, { one: "# comment", other: "# comments" }) : t`Comments`}
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto">
          {tab === "doc" ? (
            <DocView
              bundle={bundle}
              updatedAt={view.updatedAt}
              threads={openThreads}
              openThread={openThread}
              draft={panel?.kind === "new" ? panel.anchor : null}
              canComment={canComment}
              flash={flash}
              onOpenThread={(id) => setPanel(id ? { kind: "thread", id } : null)}
              onCite={openPaper}
              onComment={(anchor) => setPanel({ kind: "new", anchor })}
              onLost={setLost}
            />
          ) : paperPage && bundle.papers[paperPage] ? (
            <div className="mx-auto max-w-2xl px-6 pt-6 pb-16">
              <button type="button" onClick={() => setPaperPage(null)} className="-ml-2 mb-4 flex h-7 items-center gap-1 rounded-lg px-2 text-detail text-muted-foreground hover:bg-muted hover:text-foreground">
                <ArrowLeftIcon className="size-3.5" />
                {t`Cited papers`}
              </button>
              <PaperView paper={bundle.papers[paperPage]} bundle={bundle} full onCite={openPaper} onGoTo={goTo} />
            </div>
          ) : (
            <PapersList bundle={bundle} onOpen={setPaperPage} />
          )}
        </main>

        {panel && (
          <aside className="w-[360px] shrink-0 overflow-y-auto border-l-[0.5px] border-border bg-sidebar-panel max-md:fixed max-md:inset-0 max-md:z-20 max-md:w-auto">
            <div className="sticky top-0 z-10 flex h-11 items-center justify-end bg-sidebar-panel px-2">
              {panel.kind !== "threads" && threads.length > 0 && panel.kind !== "paper" && (
                <button type="button" onClick={() => setPanel({ kind: "threads" })} className="mr-auto ml-1 flex h-7 items-center gap-1 rounded-lg px-2 text-detail text-muted-foreground hover:bg-muted hover:text-foreground">
                  <ArrowLeftIcon className="size-3.5" />
                  {t`All comments`}
                </button>
              )}
              <button type="button" aria-label={t`Close`} title={t`Close`} onClick={() => setPanel(null)} className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
                <XIcon className="size-4" />
              </button>
            </div>
            <div className="px-4 pb-8">
              {panel.kind === "paper" && bundle.papers[panel.id] && <PaperView paper={bundle.papers[panel.id]} bundle={bundle} onCite={openPaper} onGoTo={goTo} />}
              {panel.kind === "thread" && threads.find((th) => th.root.id === panel.id) && (
                <ThreadView
                  thread={threads.find((th) => th.root.id === panel.id)!}
                  lost={lost.includes(panel.id)}
                  canComment={canComment}
                  name={name}
                  onSend={async (text, who) => {
                    const sent = await postComment(view.id, { parent: panel.id, name: who, text })
                    keepName(who)
                    setComments((all) => [...all, sent])
                  }}
                />
              )}
              {panel.kind === "new" && (
                <NewComment
                  anchor={panel.anchor}
                  name={name}
                  onCancel={() => setPanel(null)}
                  onSend={async (text, who) => {
                    const sent = await postComment(view.id, { anchor: panel.anchor, name: who, text })
                    keepName(who)
                    setComments((all) => [...all, sent])
                    setPanel({ kind: "thread", id: sent.id })
                  }}
                />
              )}
              {panel.kind === "threads" && <ThreadList threads={threads} lost={lost} onOpen={(id) => setPanel({ kind: "thread", id })} />}
            </div>
          </aside>
        )}
      </div>
    </div>
  )

  function keepName(who: string) {
    setName(who)
    storeName(who)
  }
}

function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-1.5 text-sm font-medium transition-colors ${on ? "text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground" : "text-foreground/60 hover:text-foreground"}`}
    >
      {children}
    </button>
  )
}

function Empty({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-1.5 bg-background px-6 text-center">
      <p className="text-[15px] font-medium">{title}</p>
      {detail && <p className="max-w-sm text-sm text-muted-foreground">{detail}</p>}
      {children}
    </div>
  )
}

function Feather() {
  return (
    <svg viewBox="9.59 7.14 249.12 249.12" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={21} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M 53 225 C 55 167 85 93 136 58 C 164 39 199 32 211 45 C 228 64 191 96 155 111 C 128 122 107 137 91 154 C 108 140 126 128 146 124 C 171 117 176 128 159 145 C 146 158 124 164 111 169 C 134 163 143 177 125 190 C 114 198 101 201 91 201" />
    </svg>
  )
}

// ---- The doc

function DocView(props: {
  bundle: ShareBundle
  updatedAt: number
  threads: Thread[]
  openThread: string | null
  draft: ShareAnchor | null
  canComment: boolean
  flash: { anchor: ShareAnchor; key: number } | null
  onOpenThread: (id: string | null) => void
  onCite: (id: string) => void
  onComment: (anchor: ShareAnchor) => void
  onLost: (ids: string[]) => void
}) {
  const { bundle, threads, openThread, draft, canComment, flash, onOpenThread, onCite, onComment, onLost } = props
  const article = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const ranges = useRef(new Map<string, Range>())
  const lostKey = useRef("")
  const [picked, setPicked] = useState<{ anchor: ShareAnchor; top: number; left: number } | null>(null)

  // Underlines follow the text: found again after every redraw, the open one washed
  useLayoutEffect(() => {
    const root = article.current
    if (!root) return
    const found = rangesFor(root, threads.map((th) => ({ id: th.root.id, anchor: th.root.anchor })))
    ranges.current = found
    paint("share-comment", [...found].filter(([id]) => id !== openThread).map(([, r]) => r))
    paint("share-comment-open", openThread && found.get(openThread) ? [found.get(openThread)!] : [])
    const draftRange = draft ? rangesFor(root, [{ id: "draft", anchor: draft }]).get("draft") : undefined
    paint("share-draft", draftRange ? [draftRange] : [])
    const missing = threads.filter((th) => !found.has(th.root.id)).map((th) => th.root.id)
    if (missing.join() !== lostKey.current) {
      lostKey.current = missing.join()
      onLost(missing)
    }
  })
  useEffect(
    () => () => {
      paint("share-comment", [])
      paint("share-comment-open", [])
      paint("share-draft", [])
    },
    [],
  )

  // A passage reached from a paper's citations: scrolled to, and lit for a moment
  useEffect(() => {
    if (!flash || !article.current) return
    const range = rangesFor(article.current, [{ id: "flash", anchor: flash.anchor }]).get("flash")
    if (!range) return
    const el = range.startContainer.parentElement
    el?.scrollIntoView({ block: "center", behavior: "smooth" })
    paint("share-flash", [range])
    const timer = setTimeout(() => paint("share-flash", []), 1600)
    return () => clearTimeout(timer)
  }, [flash])

  // A selection offers Comment just under it
  useEffect(() => {
    if (!canComment) return
    const update = () => {
      const sel = window.getSelection()
      const root = article.current
      const box = frame.current
      if (!sel || sel.isCollapsed || !sel.rangeCount || !root || !box) return setPicked(null)
      const range = sel.getRangeAt(0)
      const anchor = anchorOfRange(root, range)
      if (!anchor) return setPicked(null)
      const rect = range.getBoundingClientRect()
      const at = box.getBoundingClientRect()
      setPicked({ anchor, top: rect.bottom - at.top + 6, left: Math.min(Math.max(rect.left - at.left, 0), at.width - 110) })
    }
    document.addEventListener("selectionchange", update)
    return () => document.removeEventListener("selectionchange", update)
  }, [canComment])

  const titleOf = (id: string) => bundle.papers[id]?.title
  return (
    <div ref={frame} className="relative mx-auto max-w-3xl px-6 pt-8 pb-24">
      <p className="mb-5 text-detail text-muted-foreground">
        {t`Updated ${ago(props.updatedAt)}`}
        {canComment ? ` · ${t`Select words to comment on them.`}` : ""}
      </p>
      <div
        ref={article}
        onClick={(e) => {
          if (!window.getSelection()?.isCollapsed) return
          if ((e.target as HTMLElement).closest("button, a")) return
          const id = rangeAtPoint(ranges.current, e.clientX, e.clientY)
          if (id || openThread) onOpenThread(id)
        }}
      >
        <Markdown text={bundle.markdown} className="markdown share-doc" onCite={onCite} titleOf={titleOf} pageHref={(id, page) => pageHref(bundle.papers[id], page)} />
      </div>
      {picked && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onComment(picked.anchor)
            window.getSelection()?.removeAllRanges()
            setPicked(null)
          }}
          style={{ top: picked.top, left: picked.left }}
          className="menu-surface absolute z-10 flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-detail"
        >
          <MessageSquareIcon className="size-3.5" />
          {t({ message: "Comment", context: "verb: say something about the selected words" })}
        </button>
      )}
    </div>
  )
}

// ---- Papers

function PapersList({ bundle, onOpen }: { bundle: ShareBundle; onOpen: (id: string) => void }) {
  const ids = Object.keys(bundle.papers)
  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-16">
      <p className="mb-3 px-2.5 text-detail text-muted-foreground">{t`The papers this doc cites, in the order it first cites them.`}</p>
      <div className="flex flex-col gap-0.5">
        {ids.map((id) => {
          const paper = bundle.papers[id]
          const count = citationsOf(bundle.markdown, id).length
          return (
            <button key={id} type="button" onClick={() => onOpen(id)} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left hover:bg-muted">
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{paper.title}</span>
                <span className="block text-detail text-muted-foreground">{meta(paper)}</span>
              </span>
              <span className="shrink-0 text-detail text-muted-foreground">{plural(count, { one: "Cited once", other: "Cited # times" })}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PaperView({ paper, bundle, full, onCite, onGoTo }: { paper: SharedPaper; bundle: ShareBundle; full?: boolean; onCite: (id: string) => void; onGoTo: (c: Citation) => void }) {
  const citations = citationsOf(bundle.markdown, paper.id)
  const titleOf = (id: string) => bundle.papers[id]?.title
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className={full ? "text-title font-medium tracking-[-0.015em] text-balance" : "text-base font-semibold leading-snug text-balance"}>{paper.title}</h1>
        <p className="text-detail text-muted-foreground">{meta(paper)}</p>
        {paper.url && (
          <a href={paper.url} target="_blank" rel="noreferrer noopener" className="mt-0.5 flex w-fit items-center gap-1 text-detail text-mention hover:underline">
            {t`Read the paper`}
            <ArrowUpRightIcon className="size-3.5" />
          </a>
        )}
      </div>
      {paper.digest && (
        <section className="flex flex-col gap-1">
          <h2 className="text-xs text-muted-foreground">{t`Digest · written by Owlit`}</h2>
          <Markdown text={paper.digest} className="markdown text-sm" onCite={onCite} titleOf={titleOf} pageHref={(id, page) => pageHref(bundle.papers[id], page)} />
        </section>
      )}
      {paper.note && (
        <section className="flex flex-col gap-1">
          <h2 className="text-xs text-muted-foreground">{bundle.author ? t`${bundle.author}'s note` : t`The author's note`}</h2>
          <Markdown text={paper.note} className="markdown text-sm" onCite={onCite} titleOf={titleOf} pageHref={(id, page) => pageHref(bundle.papers[id], page)} />
        </section>
      )}
      {citations.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-xs text-muted-foreground">{plural(citations.length, { one: "Where the doc cites it", other: "Where the doc cites it · #" })}</h2>
          <div className="flex flex-col gap-0.5">
            {citations.map((c, i) => (
              <button key={i} type="button" onClick={() => onGoTo(c)} className="rounded-r-md border-l-2 border-border py-1.5 pr-2 pl-2.5 text-left text-detail text-muted-foreground hover:bg-muted hover:text-foreground">
                {c.sentence}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ---- Comments

function Quote({ text, lost }: { text: string; lost?: boolean }) {
  const shown = text.length > 160 ? `${text.slice(0, 160)}…` : text
  return (
    <div className="border-l-2 border-person-mark pl-2.5 text-detail text-muted-foreground">
      {lost && <p className="mb-0.5">{t`The words this was on have changed since:`}</p>}
      <p className="line-clamp-4">{shown}</p>
    </div>
  )
}

function Comment({ comment }: { comment: ShareComment }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs text-muted-foreground">
        {comment.name}
        {comment.by === "author" ? ` · ${t`author`}` : ""} · {ago(comment.at)}
      </p>
      <p className="text-sm whitespace-pre-wrap">{comment.text}</p>
    </div>
  )
}

function ThreadView({ thread, lost, canComment, name, onSend }: { thread: Thread; lost: boolean; canComment: boolean; name: string; onSend: (text: string, name: string) => Promise<void> }) {
  return (
    <div className="flex flex-col gap-3">
      <Quote text={thread.root.anchor.quote} lost={lost} />
      <div className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-3">
        <Comment comment={thread.root} />
        {thread.replies.map((r) => (
          <div key={r.id} className="border-t border-border pt-3">
            <Comment comment={r} />
          </div>
        ))}
        {thread.root.resolved && <p className="text-xs text-muted-foreground">{t`The author marked this resolved.`}</p>}
      </div>
      {canComment && <Composer key={thread.root.id} name={name} placeholder={t`Reply…`} action={t`Reply`} onSend={onSend} />}
    </div>
  )
}

function NewComment({ anchor, name, onCancel, onSend }: { anchor: ShareAnchor; name: string; onCancel: () => void; onSend: (text: string, name: string) => Promise<void> }) {
  return (
    <div className="flex flex-col gap-3">
      <Quote text={anchor.quote} />
      <Composer name={name} placeholder={t`Your comment…`} action={t({ message: "Comment", context: "verb: say something about the selected words" })} onSend={onSend} onCancel={onCancel} autoFocus />
    </div>
  )
}

function Composer({ name, placeholder, action, onSend, onCancel, autoFocus }: { name: string; placeholder: string; action: string; onSend: (text: string, name: string) => Promise<void>; onCancel?: () => void; autoFocus?: boolean }) {
  const [text, setText] = useState("")
  const [who, setWho] = useState(name)
  const [editingName, setEditingName] = useState(!name)
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const send = async () => {
    if (!text.trim() || !who.trim() || sending) return
    setSending(true)
    setProblem(null)
    try {
      await onSend(text.trim(), who.trim())
      setText("")
      setEditingName(false)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setSending(false)
    }
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
    >
      {editingName ? (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t`Your name, shown with what you write`}</span>
          <input
            id="share-name"
            value={who}
            maxLength={60}
            onChange={(e) => setWho(e.target.value)}
            className="h-8 rounded-[10px] border border-input bg-background px-2.5 text-sm outline-none focus:border-ring"
          />
        </label>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t`As ${who}`} ·{" "}
          <button type="button" onClick={() => setEditingName(true)} className="rounded px-1 hover:bg-muted hover:text-foreground">
            {t`Change`}
          </button>
        </p>
      )}
      <textarea
        id="share-text"
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder}
        maxLength={4000}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send()
        }}
        className="resize-none rounded-[10px] border border-input bg-background px-2.5 py-2 text-sm leading-relaxed outline-none focus:border-ring"
      />
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="h-7 rounded-lg px-2.5 text-detail font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            {t`Cancel`}
          </button>
        )}
        <button type="submit" disabled={!text.trim() || !who.trim() || sending} className="h-7 rounded-lg bg-primary px-2.5 text-detail font-medium text-primary-foreground disabled:opacity-50">
          {action}
        </button>
      </div>
    </form>
  )
}

function ThreadList({ threads, lost, onOpen }: { threads: Thread[]; lost: string[]; onOpen: (id: string) => void }) {
  const open = threads.filter((th) => !th.root.resolved)
  const resolved = threads.filter((th) => th.root.resolved)
  const row = (th: Thread) => (
    <button key={th.root.id} type="button" onClick={() => onOpen(th.root.id)} className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-muted">
      <span className="text-xs text-muted-foreground">
        {th.root.name} · {ago(th.root.at)}
        {th.replies.length ? ` · ${plural(th.replies.length, { one: "# reply", other: "# replies" })}` : ""}
        {lost.includes(th.root.id) ? ` · ${t`words changed`}` : ""}
      </span>
      <span className="line-clamp-2 text-sm">{th.root.text}</span>
    </button>
  )
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">{open.length ? open.map(row) : <p className="px-2.5 text-sm text-muted-foreground">{t`No open comments.`}</p>}</div>
      {resolved.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="mb-1 px-2.5 text-xs text-muted-foreground">{t`Resolved`}</p>
          {resolved.map(row)}
        </div>
      )}
    </div>
  )
}

