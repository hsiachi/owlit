import { t } from "@lingui/core/macro"
import { Group, List, SecretRow } from "../parts"

// Publishers' own APIs give the university's subscription its PDFs with no publisher's page in the way,
// so no check for a person: the surest route where the publisher has one
export function PublisherApisGroup() {
  return (
    <Group
      id="publisher-apis"
      label={t`Publishers' APIs`}
      note={t`Optional. With your university's subscription, these fetch PDFs without the publisher's check. They work on the university's network.`}
    >
      <List>
        <SecretRow
          name="elsevierApiKey"
          label={t`Elsevier API key`}
          service="Elsevier"
          help={t`For ScienceDirect papers.`}
          getFrom={{ label: "dev.elsevier.com", href: "https://dev.elsevier.com/apikey/manage" }}
        />
        <SecretRow
          name="wileyTdmToken"
          label={t`Wiley TDM token`}
          service="Wiley"
          help={t`For Wiley Online Library papers.`}
          getFrom={{ label: "onlinelibrary.wiley.com", href: "https://onlinelibrary.wiley.com/library-info/resources/text-and-datamining" }}
        />
      </List>
    </Group>
  )
}
