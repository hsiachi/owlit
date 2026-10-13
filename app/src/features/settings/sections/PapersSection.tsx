import { ProxyGroup } from "./ProxyGroup"
import { PublisherApisGroup } from "./PublisherApisGroup"
import { ReadingGroup } from "./ReadingGroup"
import { SourcesGroup } from "./SourcesGroup"

// Everything about getting papers in, as one job: finding them, getting their PDFs, reading their text.
// A missing PDF or a garbled table is then one place to look, not three.
export function PapersSection() {
  return (
    <>
      <SourcesGroup />
      <ProxyGroup />
      <PublisherApisGroup />
      <ReadingGroup />
    </>
  )
}
