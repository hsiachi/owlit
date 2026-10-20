import { plural, t } from "@lingui/core/macro"
import type { ThreadRead } from "@owlit/protocol"
import { Button } from "@/components/ui/button"
import { stopChat, tryAgain } from "@/features/chat/started"
import { shown as shownOf } from "../lib"
import { useThreadWork, workWords } from "../work"

// What Owlit is doing on the thread, one muted line under the title while it works (its words
// shimmer) with Stop, or why it stopped with Retry. Nothing when it isn't working. Several chats can work
// on the thread at once: the line says the earliest, and how many more.
export function WorkLine({ thread }: { thread: ThreadRead }) {
  const { running, failed } = useThreadWork(thread.id)
  const chat = running[0]
  if (chat) {
    const papers = shownOf(thread).rows.length
    const more = running.length - 1
    return (
      <p className="mt-2 flex items-center gap-1.5 text-detail text-muted-foreground">
        <span className="shimmer">{workWords()}</span>
        {chat.about.recipe === "gather" && papers > 0 && <span>{t`${papers} so far`}</span>}
        {more > 0 && <span>{plural(more, { one: "and # more", other: "and # more" })}</span>}
        <Button variant="text" size="inline" onClick={() => stopChat(chat)}>
          {t({ message: "Stop", comment: "stop Owlit's work on a thread" })}
        </Button>
      </p>
    )
  }
  if (failed) {
    const why = failed.reply.error ?? ""
    return (
      <p className="mt-2 flex items-center gap-1.5 text-detail text-muted-foreground">
        <span className="text-destructive">{t`Owlit stopped.`}</span>
        <span className="min-w-0 truncate" title={why}>
          {why}
        </span>
        <Button variant="text" size="inline" onClick={() => void tryAgain(failed.chatId)}>
          {t`Retry`}
        </Button>
      </p>
    )
  }
  return null
}
