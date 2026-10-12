import { EmptyPlace } from "@/components/empty-place"
import { PageShell } from "@/components/page"
import { LibraryHeader } from "../components/LibraryHeader"

// What to read next. Its content gets its own design round; until then it says what it will hold.
export function UpNextPage() {
  return (
    <PageShell>
      <LibraryHeader />
      <EmptyPlace
        title="Nothing here yet"
        detail="What to read next will appear here, ordered by what you're reading and what your searches turn up."
        className="mt-20"
      />
    </PageShell>
  )
}
