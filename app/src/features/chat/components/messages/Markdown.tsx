import katex from "katex"
import { isValidElement, type ReactNode } from "react"
import "katex/dist/katex.min.css"
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown"
import { useLocation } from "react-router-dom"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { cn } from "@/lib/utils"
import { appLinkTitle, openAppLink } from "@/app/app-links"
import { useOpenFromChat } from "@/features/agent/hooks"
import { docUriOfLink, mentionTooltip, openMention, usePaperUnread } from "@/features/docs/lib/mentions"
import { MentionToken } from "@/components/mention/mention-token"
import { citationOf } from "@/components/citation"
import { CitationHover } from "@/components/citation-card"

// The default sanitizer drops unknown schemes; keep owlit:// so workspace references survive, and file://
// so a doc linked by its file is found (it is never rendered as a link)
const urlTransform = (url: string) => (url.startsWith("owlit://") || /^file:\/\//i.test(url) ? url : defaultUrlTransform(url))

// Math as docs draw it: $…$ inline, and $$…$$ as a block, also when it sits alone on one line (which
// remark-math would read as inline). A $ before a digit stays money ("$5 and $10"). Code is left as it is.
const prepareMath = (text: string) =>
  text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, "$$$$\n$1\n$$$$")
            .replace(/(^|[^\\$])\$(?=\d)/g, "$1\\$"),
    )
    .join("")

// KaTeX output by display flag and source: a streaming reply draws its math again with every chunk, and the
// same formulas come back across replies. Bounded, the oldest dropped first.
const TEX_CACHE_SIZE = 500
const texCache = new Map<string, string>()
function texHtml(tex: string, display: boolean) {
  const key = `${display ? "d" : "i"}${tex}`
  let html = texCache.get(key)
  if (html === undefined) {
    html = katex.renderToString(tex, { displayMode: display, throwOnError: false })
    if (texCache.size >= TEX_CACHE_SIZE) texCache.delete(texCache.keys().next().value!)
    texCache.set(key, html)
  }
  return html
}

function TeX({ tex, display }: { tex: string; display: boolean }) {
  const html = texHtml(tex, display)
  return display ? <div className="math-display" dangerouslySetInnerHTML={{ __html: html }} /> : <span dangerouslySetInnerHTML={{ __html: html }} />
}

const mathClass = (className: unknown) => {
  const names = String(className ?? "")
  return names.includes("math-display") ? "display" : names.includes("math-inline") ? "inline" : null
}

// The words of rendered Markdown, without its emphasis or code marks
// A cell of prose (a finding, a sentence) gets a floor width (.prose-cell in index.css). Without one, a
// table wider than a narrow panel squeezes every column to its longest word, and Chinese, which breaks
// between any two characters, to one character a line. Width counted in Latin letters, CJK as two.
const proseCell = (children: ReactNode) => ([...textOf(children)].reduce((w, c) => w + (c > "\u2e7f" ? 2 : 1), 0) > 24 ? "prose-cell" : undefined)

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : ""
}

// Markdown renderer for assistant text; styles live under `.markdown` in index.css. A place with its own
// marks (a digest's figures and pages) adds `components` for them and `prepare` to put them in. onLink
// takes a workspace link first and says whether it handled it (a thread's report scrolls to its own rows).
export function Markdown({
  text,
  className,
  components,
  prepare,
  onLink,
}: {
  text: string
  className?: string
  components?: Components
  prepare?: (text: string) => string
  onLink?: (uri: string) => boolean
}) {
  const openPage = useOpenFromChat()
  const { pathname } = useLocation()
  // A page link into the paper open beside the chat scrolls the reader there rather than reopening it
  const open = (href: string, quote?: string) => {
    if (onLink?.(href) || openAppLink(href)) return
    openMention(href, openPage, pathname, quote)
  }
  return (
    <div className={cn("markdown leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        urlTransform={urlTransform}
        components={{
          // remark-math hands math over as code marked math-inline or math-display (inside a pre)
          code: ({ className, children, ...rest }) => {
            const math = mathClass(className)
            if (math) return <TeX tex={String(children).replace(/\n$/, "")} display={math === "display"} />
            return (
              <code className={className} {...rest}>
                {children}
              </code>
            )
          },
          pre: ({ children, ...rest }) => {
            const child = Array.isArray(children) ? children[0] : children
            const props = (child as { props?: { className?: string } } | null)?.props
            if (mathClass(props?.className) === "display") return <>{children}</>
            return <pre {...rest}>{children}</pre>
          },
          // A table too wide for the column scrolls in its own box (.table-scroll in index.css)
          table: ({ children }) => (
            <div className="table-scroll">
              <table>{children}</table>
            </div>
          ),
          td: ({ children, ...rest }) => (
            <td {...rest} className={proseCell(children)}>
              {children}
            </td>
          ),
          // Workspace references look the same as the user's @-mentions, which are plain text: an agent
          // may still format inside the link ("[Lam et al., *Concept Induction*](owlit://…)"). The tooltip
          // says what the click does, which the text of a page link ("p5") doesn't. A doc linked by its
          // file's path (agents are given docs as files) is the same reference. Only web links leave the
          // app; a path to anything else has nowhere to open, so it reads as words.
          a: ({ href, title, children }) => {
            const uri = href?.startsWith("owlit://") ? href : href ? docUriOfLink(href) : null
            if (uri) return <WorkspaceLink uri={uri} label={textOf(children)} quote={title ?? undefined} onClick={() => open(uri, title ?? undefined)} />
            if (href?.startsWith("#")) return <a href={href}>{children}</a>
            if (!href || !/^https?:/i.test(href)) return <span title={href}>{children}</span>
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            )
          },
          ...components,
        }}
      >
        {prepareMath(prepare ? prepare(text) : text)}
      </ReactMarkdown>
    </div>
  )
}

// A reference to something in the workspace; a paper not read yet is lighter until it is. A paper's
// citation opens its card on hover, with the sentence it rests on (the link's title) checked against the
// paper; anything else says on hover where it goes.
function WorkspaceLink({ uri, label, quote, onClick }: { uri: string; label: string; quote?: string; onClick: () => void }) {
  const unread = usePaperUnread(uri)
  const citation = citationOf(uri, quote)
  if (citation)
    return (
      <CitationHover citation={citation}>
        <MentionToken label={label} title={null} unread={unread} onClick={onClick} />
      </CitationHover>
    )
  const title = appLinkTitle(uri) ?? mentionTooltip(uri) ?? label
  return <MentionToken label={label} title={title} unread={unread} onClick={onClick} />
}
