import { useState } from "react"

// Open while `live`: it opens each time it turns live (work resuming after a permission is answered) and
// closes when it stops; in between, the user's own choice holds
export function useOpenWhile(live: boolean) {
  const [open, setOpen] = useState(live)
  const [was, setWas] = useState(live)
  if (was !== live) {
    setWas(live)
    setOpen(live)
  }
  return [open, setOpen] as const
}
