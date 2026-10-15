import { isTyping } from "@/lib/keys"

// Focus rings are for keyboard navigation (index.css, focus-key). A press of the pointer, or typing
// inside a field, does not count; Tab, arrows, Esc and the like do.

const setModality = (m: "pointer" | "keyboard") => {
  if (document.documentElement.dataset.modality !== m) document.documentElement.dataset.modality = m
}

export function startModality() {
  window.addEventListener("pointerdown", () => setModality("pointer"), true)
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.metaKey || e.ctrlKey || ["Shift", "Meta", "Control", "Alt"].includes(e.key)) return
      if (isTyping(e.target) && e.key !== "Tab") return
      setModality("keyboard")
    },
    true,
  )
}
