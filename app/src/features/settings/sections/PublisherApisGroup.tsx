import { Group, List, SecretRow } from "../parts"

// Publishers' own APIs give the university's subscription its PDFs with no publisher's page in the way,
// so no check for a person: the surest route where the publisher has one
export function PublisherApisGroup() {
  return (
    <Group id="publisher-apis" label="Publishers' APIs" note="Optional. With your university's subscription, these fetch PDFs without the publisher's check. They work on the university's network.">
      <List>
        <SecretRow
          name="elsevierApiKey"
          label="Elsevier API key"
          service="Elsevier"
          help="For ScienceDirect papers."
          getFrom={{ label: "dev.elsevier.com", href: "https://dev.elsevier.com/apikey/manage" }}
        />
        <SecretRow
          name="wileyTdmToken"
          label="Wiley TDM token"
          service="Wiley"
          help="For Wiley Online Library papers."
          getFrom={{ label: "onlinelibrary.wiley.com", href: "https://onlinelibrary.wiley.com/library-info/resources/text-and-datamining" }}
        />
      </List>
    </Group>
  )
}
