import { useState } from "react"

const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files")

// Takes files dropped anywhere on an element. Enter/leave pairs are counted, so `dragging` doesn't flicker
// as the pointer crosses the element's children. Drags that carry no files pass through untouched.
export function useFileDrop(onDrop: (data: DataTransfer) => void) {
  const [depth, setDepth] = useState(0)
  return {
    dragging: depth > 0,
    dropProps: {
      onDragEnter: (e: React.DragEvent) => hasFiles(e) && setDepth((n) => n + 1),
      onDragLeave: (e: React.DragEvent) => hasFiles(e) && setDepth((n) => Math.max(0, n - 1)),
      onDragOver: (e: React.DragEvent) => hasFiles(e) && e.preventDefault(),
      onDrop: (e: React.DragEvent) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setDepth(0)
        onDrop(e.dataTransfer)
      },
    },
  }
}
