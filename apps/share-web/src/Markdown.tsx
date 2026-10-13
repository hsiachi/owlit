import katex from "katex"
import "katex/dist/katex.min.css"
import { parseOwlitUri } from "@owlit/protocol"
import { isValidElement, type ReactNode } from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"

// Markdown as owlit draws it (app/src/features/chat/components/messages/Markdown.tsx), for a reader:
// a cited paper is a mention that opens it beside the text, a page of a paper links to that page where
// the paper can be read, and web links open in a new tab. Raw HTML is never drawn.

const urlTransform = (url: string) => (url.startsWith("owlit://") ? url : defaultUrlTransform(url))

// $…$ inline, $$…$$ as a block even alone on a line; a $ before a digit stays money
const prepareMath = (text: string) =>
  text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((part, i) => (i % 2 ? part : part.replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, "$$$$\n$1\n$$$$").replace(/(^|[^\\$])\$(?=\d)/g, "$1\\$")))
    .join("")

function TeX({ tex, display }: { tex: string; display: boolean }) {
  const html = katex.renderToString(tex, { displayMode: display, throwOnError: false })
  return display ? <div className="math-display" dangerouslySetInnerHTML={{ __html: html }} /> : <span dangerouslySetInnerHTML={{ __html: html }} />
}

const mathClass = (className: unknown) => {
  const names = String(className ?? "")
  return names.includes("math-display") ? "display" : names.includes("math-inline") ? "inline" : null
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : ""
}

export interface MarkdownProps {
  text: string
  className?: string
  // A cited paper was clicked
  onCite?: (paperId: string) => void
  // The paper a citation names, for its tooltip; undefined when the share doesn't carry it
  titleOf?: (paperId: string) => string | undefined
  // Where a page of a paper can be read, when it can
  pageHref?: (paperId: string, page: number) => string | undefined
}

export function Markdown({ text, className, onCite, titleOf, pageHref }: MarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        urlTransform={urlTransform}
        components={{
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
          table: ({ children }) => (
            <div className="table-scroll">
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) => {
            const uri = href?.startsWith("owlit://") ? parseOwlitUri(href) : null
            if (uri?.kind === "paper") {
              const page = uri.page !== undefined ? pageHref?.(uri.id, uri.page) : undefined
              if (page)
                return (
                  <a href={page} target="_blank" rel="noreferrer noopener">
                    {children}
                  </a>
                )
              const title = titleOf?.(uri.id)
              if (!title || !onCite) return <span>{children}</span>
              return (
                <button type="button" title={title} onClick={() => onCite(uri.id)} className="cite -mx-[0.2em] inline items-baseline rounded-[0.3em] px-[0.2em] text-mention transition-colors hover:bg-mention/10">
                  {textOf(children)}
                </button>
              )
            }
            if (!href || !/^(https?:|mailto:)/i.test(href)) return <span>{children}</span>
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            )
          },
        }}
      >
        {prepareMath(text)}
      </ReactMarkdown>
    </div>
  )
}
