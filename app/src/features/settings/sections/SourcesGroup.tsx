import { CommitInput, Group, List, Row, SecretRow } from "../parts"
import { updateSettings, useSettings } from "../store"

const looksLikeEmail = (text: string) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text) ? null : "That doesn't look like an email address.")

export function SourcesGroup() {
  const email = useSettings((s) => s.view?.library.contactEmail ?? "")
  return (
    <Group id="sources" label="Finding papers" note="All optional: lookups work without them, only slower. Keys are kept in the system keychain.">
      <List>
        <Row
          name="Contact email"
          help="OpenAlex and Unpaywall answer faster, and Unpaywall can find open copies."
          control={
            <CommitInput
              type="email"
              aria-label="Contact email"
              placeholder="you@university.edu"
              value={email}
              validate={looksLikeEmail}
              onCommit={(contactEmail) => void updateSettings({ library: { contactEmail: contactEmail || null } })}
            />
          }
        />
        <SecretRow
          name="s2ApiKey"
          label="Semantic Scholar API key"
          service="Semantic Scholar"
          help="Without one, lookups often wait their turn."
          getFrom={{ label: "semanticscholar.org", href: "https://www.semanticscholar.org/product/api#api-key-form" }}
        />
        <SecretRow
          name="openalexApiKey"
          label="OpenAlex API key"
          service="OpenAlex"
          help="Only needed past the free daily allowance."
          getFrom={{ label: "openalex.org", href: "https://openalex.org/settings/api" }}
        />
      </List>
    </Group>
  )
}
