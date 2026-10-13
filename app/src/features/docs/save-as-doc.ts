import { t } from "@lingui/core/macro"
import type { NavigateFunction } from "react-router-dom"
import { toast } from "sonner"
import { useDocsStore } from "./store"
import { displayName } from "./types"
import { useDocsUiStore } from "./ui-store"

// Keeps an answer from Chat as a doc, titled after the chat, where new docs land. The answer's
// owlit:// links stay links, so its citations show as mentions in the doc.
export function saveAnswerAsDoc(title: string, markdown: string, navigate: NavigateFunction) {
  const { createDoc, writeDoc } = useDocsStore.getState()
  const doc = createDoc(useDocsUiStore.getState().targetFolder)
  writeDoc(doc.id, `# ${title.trim() || t`Answer`}\n\n${markdown.trim()}\n`)
  const saved = useDocsStore.getState().files[doc.id]
  toast(t`Saved as doc`, {
    description: saved ? displayName(saved.path) : undefined,
    action: { label: t({ message: "Open", comment: "verb: open the saved doc" }), onClick: () => navigate(`/docs/${doc.id}`) },
  })
}
