import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import { useNavigate } from "react-router-dom"
import remarkGfm from "remark-gfm"
import { cn } from "cn"
import { mentionRoute, mentionTitle } from "@/features/docs/lib/mentions"
import { MentionToken } from "../composer/MentionToken"

// The default sanitizer drops unknown schemes; keep owlit:// so workspace references survive
const urlTransform = (url: string) => (url.startsWith("owlit://") ? url : defaultUrlTransform(url))

// Markdown renderer for assistant text; styles live under `.markdown` in index.css
export function Markdown({ text, className }: { text: string; className?: string }) {
  const navigate = useNavigate()
  const open = (href: string) => {
    const to = mentionRoute(href)
    if (to) navigate(to)
  }
  return (
    <div className={cn("markdown leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={{
          // Workspace references look the same as the user's @-mentions
          a: ({ href, children }) =>
            href?.startsWith("owlit://") ? (
              <MentionToken label={String(children)} title={mentionTitle(href) ?? String(children)} onClick={() => open(href)} />
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
