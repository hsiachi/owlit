import { t } from "@lingui/core/macro"
import { cn } from "@/lib/utils"
import { Dot } from "@/components/marks"
import { isAbstractOnly, speakerName, verbOf, verbWords } from "../format"
import type { Line, Topic } from "../types"
import { Prose, Refs } from "./bits"

// A topic's line with its speaker in a 112px column at the left, written as a verb phrase: "You wrote",
// "Schick 2023 found", "Owlit thinks", the name in medium weight, the verb muted. `mark` goes before the
// speaker (the dot on a line changed since the user last looked); the line itself is `children`.
export function TopicLine({ line, mark, className, children, ...props }: { line: Line; mark?: React.ReactNode } & React.ComponentProps<"div">) {
  return (
    <div className={cn("grid grid-cols-[112px_1fr] gap-x-4", className)} {...props}>
      <div className="relative pt-[3px] text-detail leading-snug">
        {mark}
        <span className="font-medium text-foreground">{speakerName(line)}</span> <span className="text-muted-foreground">{verbWords(verbOf(line))}</span>
      </div>
      {children}
    </div>
  )
}

// The sentence, then its sources and condition, then what it was before Owlit rewrote it. A paper line
// that rests on the abstract alone is muted and says so. With its topic, lines named by ^id are links.
export function LineBody({ line, was, topic }: { line: Line; was?: string; topic?: Topic }) {
  const abstractOnly = isAbstractOnly(line)
  return (
    <>
      <p className={cn("text-body leading-relaxed text-pretty", abstractOnly && "text-muted-foreground")}>
        <Prose text={line.text} topic={topic} />
      </p>
      {(line.sources.length > 0 || line.condition || abstractOnly) && (
        <p className="mt-0.5 text-detail leading-relaxed text-muted-foreground">
          <Refs refs={line.sources} />
          {line.condition && (
            <>
              {line.sources.length > 0 && <Dot />}
              <Prose text={line.condition} topic={topic} />
            </>
          )}
          {abstractOnly && <span className="ml-2 inline-flex h-5 items-center rounded-md bg-muted px-1.5 align-[0.05em] text-xs">{t`abstract only`}</span>}
        </p>
      )}
      {was && <p className="mt-0.5 text-detail leading-relaxed text-muted-foreground">{t`Was: “${was}”`}</p>}
    </>
  )
}
