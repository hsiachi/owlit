import { ext } from "../lib/browser.ts"
import type { Request, ToPage } from "../lib/messages.ts"
import { paperMarkup } from "../lib/page.ts"
import { drawCard } from "./card.ts"

// On a publisher's page (and any site the user let the extension read, or one the button was pressed on):
// the page's <head> and the scripts that describe its paper (page.ts paperMarkup) go to the background, which reads it (lib/page.ts)
// and asks owlit whether the paper is in the Library. Nothing else of the page leaves it. The background's
// cards are drawn here (card.ts).

const send = (request: Request) => ext.runtime.sendMessage(request).catch(() => undefined)

// The background injects this script again on a page the button was pressed on; one copy listens
const scope = globalThis as { owlitContent?: true }
if (!scope.owlitContent) {
  scope.owlitContent = true
  ext.runtime.onMessage.addListener((message: ToPage, sender, respond) => {
    if (sender.id !== ext.runtime.id || message?.kind !== "card") return false
    drawCard(document, message.card, {
      act: (action) => void send({ kind: "card", action }),
      closed: (key) => void (key && send({ kind: "closed", key })),
    })
    respond(true)
    return false
  })
  void send({ kind: "page", html: paperMarkup(), url: location.href })
}
