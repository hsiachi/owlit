import { t } from "@lingui/core/macro"
import { CommitInput, Group, List, Row, SecretRow } from "../parts"
import { updateSettings, useSettings } from "../store"

const looksLikeEmail = (text: string) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text) ? null : t`That doesn't look like an email address.`)

export function SourcesGroup() {
  const email = useSettings((s) => s.view?.library.contactEmail ?? "")
  return (
    <Group id="sources" label={t`Finding papers`} note={t`All optional: lookups work without them, only slower. Keys are kept in the system keychain.`}>
      <List>
        <Row
          name={t`Contact email`}
          info={t`With an address, OpenAlex and Unpaywall answer faster and more often, and Unpaywall can find open copies.`}
          control={
            <CommitInput
              type="email"
              aria-label={t`Contact email`}
              // i18n-ignore
              placeholder="you@university.edu"
              value={email}
              validate={looksLikeEmail}
              onCommit={(contactEmail) => void updateSettings({ library: { contactEmail: contactEmail || null } })}
            />
          }
        />
        <SecretRow
          name="s2ApiKey"
          label={t`Semantic Scholar API key`}
          service="Semantic Scholar"
          help={t`Without a key, searches are slow and often refused.`}
          getFrom={{ label: "semanticscholar.org", href: "https://www.semanticscholar.org/product/api#api-key-form" }}
        />
        <SecretRow
          name="openalexApiKey"
          label={t`OpenAlex API key`}
          service="OpenAlex"
          info={t`Only needed past the free daily allowance.`}
          getFrom={{ label: "openalex.org", href: "https://openalex.org/settings/api" }}
        />
      </List>
    </Group>
  )
}
