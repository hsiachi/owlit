// owlit's browser extension as core reports it (extension.get, then extension.changed): the browsers
// the user allowed, the ones asking now, and whether this owlit has the port. Settings › Papers ›
// Browser extension and the pairing question (PairDialog) read it.

import type { ExtensionView, ExtensionWait } from "@owlit/protocol"
import { t } from "@lingui/core/macro"
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { bridge, onNotify, rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { waitsOnYou } from "@/features/library/lib/pdf-wait"
import { waitWords } from "./waits"

interface ExtensionState {
  view: ExtensionView | null
}

export const useExtension = create<ExtensionState>(() => ({ view: null }))

// The sites where the extension waits for the user (waits.ts says them)
const NO_WAITS: ExtensionWait[] = []
export const useExtensionWaits = () => useExtension(useShallow((s) => s.view?.waits ?? NO_WAITS))

export async function answerPairing(id: string, allow: boolean) {
  const view = useExtension.getState().view
  // The question goes at once; core's answer (extension.changed) follows
  if (view) useExtension.setState({ view: { ...view, asking: view.asking.filter((a) => a.id !== id) } })
  await rpc.extension.answer({ id, allow }).catch(toastError)
}

export async function forgetPairing(id: string) {
  await rpc.extension.forget({ id }).then(receive, toastError)
}

// Questions the system was already told about, so each is said once
const told = new Set<string>()
// Sites waiting on the user that the system was told about, until each is over
const toldWaits = new Set<string>()

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
  // A site that stopped a paper the user asked for waits on them (waitsOnYou): said once while no owlit
  // window is in front, like a question; a site nobody asked about stays a grey line
  const now = new Set<string>()
  for (const wait of view.waits) {
    if (!waitsOnYou(wait)) continue
    const key = `${wait.kind}:${wait.host}`
    now.add(key)
    if (toldWaits.has(key)) continue
    toldWaits.add(key)
    if (!document.hasFocus()) {
      const { what, papers } = waitWords(wait)
      bridge?.notify({ title: what, body: papers })
    }
  }
  for (const key of toldWaits) if (!now.has(key)) toldWaits.delete(key)
}

export function startExtension() {
  onNotify("extension.changed", receive)
  rpc.extension
    .get()
    .then(receive)
    .catch((error) => console.warn("[owlit] couldn't read the browser extension's state", error))
}
