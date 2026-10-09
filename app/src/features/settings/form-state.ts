// State the Settings forms share: which form is open (so Esc can fold it first), and trying a value
// with its service.

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

// The result of trying a value with its service: "Checking…", then "Works" for a moment, or the problem
export function useCheck() {
  const [state, setState] = useState<{ checking: boolean; result?: SettingsCheck }>({ checking: false })
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const run = async (target: Parameters<typeof checkSetting>[0]) => {
    window.clearTimeout(timer.current)
    setState({ checking: true })
    let result: SettingsCheck
    try {
      result = await checkSetting(target)
    } catch {
      result = { result: "unknown", message: "Couldn't check it just now." }
    }
    setState({ checking: false, result })
    // "Works" is news once; a problem stays until it changes
    if (result.result === "works" && !result.message) timer.current = window.setTimeout(() => setState({ checking: false }), 2500)
  }
  const reset = () => setState({ checking: false })
  return { ...state, run, reset }
}
