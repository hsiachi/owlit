import { CommitInput, List, Row, SecretRow } from "../parts"
import { updateSettings, useSettings } from "../store"

const looksLikeEmail = (text: string) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text) ? null : "That doesn't look like an email address.")

export function SourcesSection() {
  const email = useSettings((s) => s.view?.library.contactEmail ?? "")
  return (
    <List>
      <Row
        name="Contact email"
        info="OpenAlex and Unpaywall ask for an address they can write to. With one, they answer faster and more often, and Unpaywall can be asked for open copies. owlit never fills this in for you."
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
        info="Optional. Without one, Semantic Scholar often asks owlit to slow down, and lookups wait. Kept in the system keychain."
        getFrom={{ label: "semanticscholar.org", href: "https://www.semanticscholar.org/product/api#api-key-form" }}
      />
      <SecretRow
        name="openalexApiKey"
        label="OpenAlex API key"
        service="OpenAlex"
        info="Optional. Only needed past OpenAlex's free daily allowance. Kept in the system keychain."
        getFrom={{ label: "openalex.org", href: "https://openalex.org/settings/api" }}
      />
    </List>
  )
}
