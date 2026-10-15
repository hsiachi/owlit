import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { SelectionMenuItems } from "@/components/selection-menu-items"
import { TooltipProvider } from "@/components/ui/tooltip"

// The doc's selection menu items, drawn by React inside the menu CodeMirror builds, so they are the same
// items as a note's and a digest's, with the app's own tooltips. Returns what takes them away again.
export function mountSelectionMenu(host: HTMLElement, props: React.ComponentProps<typeof SelectionMenuItems>) {
  const root = createRoot(host)
  // Drawn at once: CodeMirror measures the menu as soon as it is made, to lift it above the selection
  flushSync(() =>
    root.render(
      <TooltipProvider>
        <SelectionMenuItems {...props} />
      </TooltipProvider>,
    ),
  )
  // Not while CodeMirror is updating, which is when it takes the menu away
  return () => queueMicrotask(() => root.unmount())
}
