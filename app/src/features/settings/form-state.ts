// State the Settings forms share: which form is open (so Esc can fold it first), and trying a value
// with its service.

import { t } from "@lingui/core/macro"
import { useEffect, useRef, useState } from "react"
import type { SettingsCheck } from "@owlit/protocol"
import { create } from "zustand"
import { checkSetting } from "./store"

// The form that is open, so Esc folds it before it closes the dialog (Radix handles Esc at the
// document, before a field's own onKeyDown)
export const useFold = create<{ fold: (() => void) | null }>(() => ({ fold: null }))

export function useFoldWhile(open: boolean, fold: () => void) {
  const latest = useRef(fold)
  useEffect(() => {
    latest.current = fold
  })
  useEffect(() => {
    if (!open) return
    const handler = () => latest.current()
    useFold.setState({ fold: handler })
    return () => {
      if (useFold.getState().fold === handler) useFold.setState({ fold: null })
    }
  }, [open])
}

// The result of trying a value with its service. It stays while the section is open: a check beside the
// value when it works, a sentence under the row when there is something to say.
export function useCheck() {
  const [state, setState] = useState<{ checking: boolean; result?: SettingsCheck }>({ checking: false })
  // Only the latest try counts, so a slow answer can't overwrite a newer one or a reset
  const latest = useRef(0)
  const run = async (target: Parameters<typeof checkSetting>[0]) => {
    const id = ++latest.current
    setState({ checking: true })
    let result: SettingsCheck
    try {
      result = await checkSetting(target)
    } catch {
      result = { result: "unknown", message: t`Couldn't check it just now.` }
    }
    if (id === latest.current) setState({ checking: false, result })
  }
  const reset = () => {
    latest.current++
    setState({ checking: false })
  }
  return { ...state, run, reset }
}
