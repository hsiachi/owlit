import { CommitInput, List, Row, SecretRow } from "../parts"
import { updateSettings, useSettings } from "../store"

const looksLikeEmail = (text: string) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text) ? null : "That doesn't look like an email address.")

export function SourcesSection() {
  const email = useSettings((s) => s.view?.library.contactEmail ?? "")
  return (
    <List>
      <Row
        name="Contact email"
        help="With an address, OpenAlex and Unpaywall answer faster and more often, and Unpaywall can find open copies."
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
        help="Optional. Without one, lookups often wait. Kept in the system keychain."
        getFrom={{ label: "semanticscholar.org", href: "https://www.semanticscholar.org/product/api#api-key-form" }}
      />
      <SecretRow
        name="openalexApiKey"
        label="OpenAlex API key"
        service="OpenAlex"
        help="Optional. Only needed past the free daily allowance. Kept in the system keychain."
        getFrom={{ label: "openalex.org", href: "https://openalex.org/settings/api" }}
      />
    </List>
  )
}
