import { t } from "@lingui/core/macro"
import { RELEASES_URL } from "@owlit/protocol"
import { Button } from "@/components/ui/button"
import { ago, shortDate } from "@/lib/time"
import { forgetPairing, useExtension } from "@/features/extension/store"
import { Group, List, Row } from "../parts"

// Where to get the extension until owlit has a site of its own: the latest release's page, which the
// release checklist keeps saying where it is (CONTRIBUTING.md › Releases)
const INSTALL_URL = RELEASES_URL

// The browsers whose owlit extension may connect, each forgettable; with none, how to get one
export function ExtensionGroup() {
  const view = useExtension((s) => s.view)
  const paired = view?.paired ?? []
  return (
    <Group
      id="extension"
      label={t`Browser extension`}
      info={t`The extension adds the paper of the page you're on to owlit and saves its PDF with your browser's access. A PDF you open for a paper in your Library without one comes to owlit by itself.`}
      note={view?.portTaken ? t`Another Owlit is connected to the extension. This one takes over once that one quits.` : undefined}
    >
      <List>
        {paired.map((p) => (
          <Row
            key={p.id}
            name={p.browser}
            control={
              <>
                <span className="mr-1 text-detail text-muted-foreground">
                  {p.lastSeenAt ? t`Last seen ${ago(p.lastSeenAt, { inSentence: true })}` : t`Allowed ${shortDate(p.pairedAt)}`}
                </span>
                <Button variant="ghost" size="sm" className="last:-mr-2.5" onClick={() => void forgetPairing(p.id)}>
                  {t({ message: "Forget", comment: "take back a browser's permission to connect to owlit" })}
                </Button>
              </>
            }
          />
        ))}
        {!paired.length && (
          <Row
            name={t`Not connected`}
            help={t`Install the owlit extension in Chrome, Edge, Brave, Arc or Firefox, then press Connect in it.`}
            control={
              <Button variant="outline" size="sm" asChild>
                <a href={INSTALL_URL} target="_blank" rel="noreferrer">
                  {t`Install`}
                </a>
              </Button>
            }
          />
        )}
      </List>
    </Group>
  )
}
