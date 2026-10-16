// owlit's browser extension as core reports it (extension.get, then extension.changed): the browsers
// the user allowed, the ones asking now, and whether this owlit has the port. Settings › Papers ›
// Browser extension and the pairing question (PairDialog) read it.

import type { ExtensionView } from "@owlit/protocol"
import { t } from "@lingui/core/macro"
import { create } from "zustand"
import { bridge, isDesktop, onNotify, rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { MINUTE } from "@/lib/time"

interface ExtensionState {
  view: ExtensionView | null
}

export const useExtension = create<ExtensionState>(() => ({ view: null }))

export async function answerPairing(id: string, allow: boolean) {
  const view = useExtension.getState().view
  // The question goes at once; core's answer (extension.changed) follows
  if (view) useExtension.setState({ view: { ...view, asking: view.asking.filter((a) => a.id !== id) } })
  if (isDesktop) await rpc.extension.answer({ id, allow }).catch(toastError)
}

export async function forgetPairing(id: string) {
  if (!isDesktop) return receive({ ...useExtension.getState().view!, paired: [] })
  await rpc.extension.forget({ id }).then(receive, toastError)
}

// Questions the system was already told about, so each is said once
const told = new Set<string>()

function receive(view: ExtensionView) {
  useExtension.setState({ view })
  // The extension waits in another app: the system says so while no owlit window is in front (the
  // desktop app shows it only then), so the user comes here to answer
  for (const asking of view.asking) {
    if (told.has(asking.id)) continue
    told.add(asking.id)
    if (!document.hasFocus()) {
      bridge?.notify({ title: t`An extension in ${asking.browser} wants to connect to owlit.`, body: t`Open owlit to allow it or not.` })
    }
  }
}

// dev:web: ?extension=none | taken | asking shows those states; otherwise one browser is connected
function mockView(): ExtensionView {
  const state = new URLSearchParams(location.search).get("extension")
  const now = Date.now()
  const paired = state === "none" || state === "taken" ? [] : [{ id: "mock-chrome", browser: "Chrome", pairedAt: now - 3 * 24 * 60 * MINUTE, lastSeenAt: now - 4 * MINUTE }]
  return {
    serving: state !== "taken",
    portTaken: state === "taken",
    paired,
    asking: state === "asking" ? [{ id: "mock-ask", browser: "Dia", at: now }] : [],
    waits: [],
  }
}

export function startExtension() {
  if (!isDesktop) {
    useExtension.setState({ view: mockView() })
    return
  }
  onNotify("extension.changed", receive)
  rpc.extension
    .get()
    .then(receive)
    .catch((error) => console.warn("[owlit] couldn't read the browser extension's state", error))
}
