import { MessageSquarePlusIcon } from "lucide-react"
import { createRoot } from "react-dom/client"
import { Tip } from "@/components/tip"
import { TooltipProvider } from "@/components/ui/tooltip"

// The selection menu's comment icon, drawn by React inside the menu CodeMirror builds, so its tooltip is
// the app's own (with the key) rather than the system's. Returns what takes it away again.
export function mountCommentIcon(host: HTMLElement, { label, shortcut, onClick }: { label: string; shortcut: string; onClick: () => void }) {
  const root = createRoot(host)
  root.render(
    <TooltipProvider>
      <Tip label={label} shortcut={shortcut}>
        <button
          type="button"
          className="selection-menu-icon"
          aria-label={label}
          // Keep the selection and focus in the editor while clicking
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
        >
          <MessageSquarePlusIcon className="size-[15px]" />
        </button>
      </Tip>
    </TooltipProvider>,
  )
  // Not while CodeMirror is updating, which is when it takes the menu away
  return () => queueMicrotask(() => root.unmount())
}
