import { LibraryHeader } from "../components/LibraryHeader"
import { LibraryShell } from "./LibraryPage"

// What to read next. Its content gets its own design round; until then it says what it will hold.
export function UpNextPage() {
  return (
    <LibraryShell>
      <LibraryHeader />
      <div className="mx-auto mt-20 max-w-sm text-center">
        <p className="text-body font-medium">Nothing here yet</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          What to read next will appear here, ordered by what you're reading and what your searches turn up.
        </p>
      </div>
    </LibraryShell>
  )
}
