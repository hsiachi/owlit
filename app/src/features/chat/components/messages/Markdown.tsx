import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "cn"

// Markdown renderer for assistant text; styles live under `.markdown` in index.css
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("markdown text-sm leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target={href?.startsWith("owlit://") ? undefined : "_blank"} rel="noreferrer" onClick={(e) => href?.startsWith("owlit://") && e.preventDefault()}>
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
