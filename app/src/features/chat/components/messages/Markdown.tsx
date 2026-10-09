import katex from "katex"
import "katex/dist/katex.min.css"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import { useNavigate } from "react-router-dom"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { cn } from "cn"
import { appLinkTitle, openAppLink } from "@/app/app-links"
import { mentionRoute, mentionTitle } from "@/features/docs/lib/mentions"
import { MentionToken } from "../composer/MentionToken"

// The default sanitizer drops unknown schemes; keep owlit:// so workspace references survive
const urlTransform = (url: string) => (url.startsWith("owlit://") ? url : defaultUrlTransform(url))

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

function TeX({ tex, display }: { tex: string; display: boolean }) {
  const html = katex.renderToString(tex, { displayMode: display, throwOnError: false })
  return display ? <div className="math-display" dangerouslySetInnerHTML={{ __html: html }} /> : <span dangerouslySetInnerHTML={{ __html: html }} />
}

const mathClass = (className: unknown) => {
  const names = String(className ?? "")
  return names.includes("math-display") ? "display" : names.includes("math-inline") ? "inline" : null
}

// Markdown renderer for assistant text; styles live under `.markdown` in index.css
export function Markdown({ text, className }: { text: string; className?: string }) {
  const navigate = useNavigate()
  const open = (href: string) => {
    if (openAppLink(href)) return
    const to = mentionRoute(href)
    if (to) navigate(to)
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
          // Workspace references look the same as the user's @-mentions
          a: ({ href, children }) =>
            href?.startsWith("owlit://") ? (
              <MentionToken label={String(children)} title={appLinkTitle(href) ?? mentionTitle(href) ?? String(children)} onClick={() => open(href)} />
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {prepareMath(text)}
      </ReactMarkdown>
    </div>
  )
}
