import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "cn"
import { MentionToken } from "../composer/MentionToken"

// The default sanitizer drops unknown schemes; keep owlit:// so workspace references survive
const urlTransform = (url: string) => (url.startsWith("owlit://") ? url : defaultUrlTransform(url))

// Markdown renderer for assistant text; styles live under `.markdown` in index.css
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("markdown leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={{
          // Workspace references look the same as the user's @-mentions
          a: ({ href, children }) =>
            href?.startsWith("owlit://") ? (
              <MentionToken label={String(children)} title={href} />
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
