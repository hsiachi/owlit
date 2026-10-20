import { t } from "@lingui/core/macro"
import { useCallback, useEffect, useState } from "react"
import { OwlitLockup } from "@/components/owlit-lockup"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { ext } from "../lib/browser.ts"
import { clickPlan, pdfAddress } from "../lib/click.ts"
import { originsOf, send, type Connection, type Outcome, type PageState, type PopupState } from "../lib/messages.ts"
import { askForKnownSites, askForOrigins } from "../lib/permissions.ts"
import { cardOf } from "../lib/say.ts"

// The popup, where the page can't say it: the browser opens it on the toolbar button when the click
// needs a decision (connecting, a workspace) or when the page takes no card (the browser's own pages, a
// PDF viewer that runs no extension script). The page's paper first, as the app's paper row shows one,
// then its one button and what came of it, what this site waits for, and the one setting. The work itself
// happens in the background, which outlives the popup; the popup only asks and says how it went.
export function Popup() {
  const [tabId, setTabId] = useState<number | null>(null)
  const [state, setState] = useState<PopupState | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  // The browser wouldn't ask for the publishers' sites (permissions.ts)
  const [unasked, setUnasked] = useState(false)
  // The background answered null: it failed on the way (its error is logged there). A state already
  // shown stays.
  const [broken, setBroken] = useState(false)

  const refresh = useCallback(async (id: number) => {
    const answer = await send({ kind: "state", tabId: id }).catch(() => null)
    setBroken(!answer)
    if (answer) setState(answer)
    // What the click that opened the popup came to; the background gives it once
    if (answer?.said) setOutcome(answer.said)
  }, [])

  useEffect(() => {
    void ext.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id === undefined) return
      setTabId(tab.id)
      void refresh(tab.id)
    })
  }, [refresh])

  // The token arrives once the user allows the extension in owlit
  useEffect(() => {
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ("token" in changes && tabId !== null) void refresh(tabId)
    }
    ext.storage.local.onChanged.addListener(changed)
    return () => ext.storage.local.onChanged.removeListener(changed)
  }, [refresh, tabId])

  const connect = async () => {
    setOutcome(null)
    setState((s) => s && { ...s, connection: { state: "pairing" } })
    const connection = await send({ kind: "connect" }).catch(() => null)
    setState((s) => s && { ...s, connection: connection ?? { state: "unpaired" } })
    if (tabId !== null) void refresh(tabId)
  }

  const act = async (page: PageState) => {
    if (tabId === null) return
    // The PDF's site, asked for here and first (a permission can only be asked from the click itself): the
    // background fetches it with the user's cookies, which needs it. A site already allowed isn't asked again.
    const address = pdfAddress(page)
    if (address) {
      const site = new URL(address).hostname
      const asked = await askForOrigins(ext.permissions, [`${new URL(address).origin}/*`])
      if (asked === "refused") return setOutcome({ kind: "failed", message: t`owlit needs to read ${site} to get the PDF with your access.` })
      if (asked === "unasked") return setOutcome({ kind: "failed", message: t`Your browser didn't ask about ${site}. Allow it for owlit in the browser's extension settings.` })
    }
    setBusy(true)
    setOutcome(null)
    try {
      setOutcome((await send({ kind: "act", tabId }).catch(() => null)) ?? { kind: "failed", message: brokenText() })
      await refresh(tabId)
    } finally {
      setBusy(false)
    }
  }

  // owlit's papers waiting at a site the extension may not read: the permission is asked for from this
  // click, as the browser requires, and owlit goes on there once it is given
  const allow = async (host: string) => {
    if ((await askForOrigins(ext.permissions, originsOf(host))) !== "granted") return
    await send({ kind: "allowed", host })
    if (tabId !== null) void refresh(tabId)
  }

  // Every publisher site owlit knows, in one question; per site after that
  const allowKnown = async () => {
    const asked = await askForKnownSites(ext.permissions, ext.runtime.getManifest())
    setUnasked(asked === "unasked")
    if (tabId !== null) void refresh(tabId)
  }

  const connected = state?.connection.state === "connected"
  return (
    <main className="flex w-80 flex-col gap-3 p-4 text-sm">
      <header className="flex items-center justify-between gap-2">
        <OwlitLockup className="h-4.5 w-auto text-foreground" />
      </header>
      {state ? (
        <Body state={state} busy={busy} outcome={outcome} onConnect={() => void connect()} onAct={(page) => void act(page)} />
      ) : broken ? (
        <Muted>{brokenText()}</Muted>
      ) : (
        <Spinner className="text-muted-foreground" />
      )}
      {connected && (state.wait || state.going) && <Waiting state={state} />}
      {/* Asking for the sites means nothing before the browser is connected */}
      {connected && !state.knownSites && (
        <section className="flex flex-col items-start gap-2 border-t pt-3">
          <p className="text-detail">{t`The owlit extension may not read the publishers' sites yet, so it can't get their PDFs with your access.`}</p>
          {unasked && <Muted>{t`Your browser didn't ask. Allow the sites for owlit in the browser's extension settings.`}</Muted>}
          <Button size="sm" variant="outline" onClick={() => void allowKnown()}>
            {t({ message: "Allow the publishers' sites", comment: "button: let the owlit extension read every publisher site owlit knows, in one question" })}
          </Button>
        </section>
      )}
      {connected &&
        state.needs.map(({ host, papers }) => (
          <section key={host} className="flex items-center justify-between gap-3 border-t pt-3">
            <p className="min-w-0 text-detail">{cardOf({ kind: "wait", wait: { kind: "permission", host, papers } }).text}</p>
            <Button size="sm" variant="outline" onClick={() => void allow(host)}>
              {t({ message: "Allow", comment: "button: let the owlit extension read this site, for the papers waiting there" })}
            </Button>
          </section>
        ))}
      {connected && (
        <label className="flex items-center justify-between gap-3 border-t pt-3 text-detail text-muted-foreground">
          {t`Take PDFs I open for papers in my Library`}
          <Switch
            checked={state.takePdfs}
            onCheckedChange={(on) => {
              setState({ ...state, takePdfs: on })
              void send({ kind: "takePdfs", on })
            }}
          />
        </label>
      )}
    </main>
  )
}

function Body({ state, busy, outcome, onConnect, onAct }: { state: PopupState; busy: boolean; outcome: Outcome | null; onConnect: () => void; onAct: (page: PageState) => void }) {
  const { connection, page } = state
  if (connection.state !== "connected") return <NotConnected connection={connection} onConnect={onConnect} />
  if (connection.workspace === null)
    return (
      <section className="flex flex-col items-start gap-2">
        <p>{t`owlit has no workspace open`}</p>
        <Muted>{t`Open one in owlit, then press the button again.`}</Muted>
        <Button size="sm" variant="outline" onClick={() => void send({ kind: "open" })}>
          {t({ message: "Open owlit", comment: "the owlit card or popup: bring the owlit app to the front" })}
        </Button>
      </section>
    )
  if (!page) return <Muted>{t`owlit can't read the browser's own pages. Open a paper's page and press the button there.`}</Muted>
  return <PagePaper state={state} page={page} busy={busy} outcome={outcome} onAct={onAct} />
}

function NotConnected({ connection, onConnect }: { connection: Exclude<Connection, { state: "connected" }>; onConnect: () => void }) {
  if (connection.state === "offline")
    return (
      <section className="flex flex-col gap-1">
        <p>{t`owlit isn't open`}</p>
        <Muted>{t`Open it, then press the button again.`}</Muted>
      </section>
    )
  // A preview or a second owlit has the port: this browser stays connected to its own
  if (connection.state === "elsewhere") {
    const { name } = connection
    return (
      <section className="flex flex-col gap-1">
        <p>{t`${name} answers here instead of your owlit`}</p>
        <Muted>{t`Quit it, and this browser goes on with your owlit.`}</Muted>
      </section>
    )
  }
  if (connection.state === "pairing")
    return (
      <p className="flex items-center gap-2 text-muted-foreground">
        <Spinner wait={false} className="size-3.5" />
        {t`Allow it in owlit…`}
      </p>
    )
  const problem = {
    refused: t`You didn't allow it in owlit.`,
    expired: t`Nobody answered in owlit in time. Press Connect to ask again.`,
    "no-window": t`Open the owlit window, then press Connect again.`,
  }
  return (
    <section className="flex flex-col items-start gap-2">
      <p>{t`Add the paper of any page to owlit, with its PDF.`}</p>
      {connection.problem && <Muted>{problem[connection.problem]}</Muted>}
      <Button className="self-start" onClick={onConnect}>
        {t`Connect to owlit`}
      </Button>
    </section>
  )
}

// The page's paper as the app's paper row shows one: its title on two lines at most, then who, where and
// when, then whether the Library has it
function PagePaper({ state, page, busy, outcome, onAct }: { state: PopupState; page: PageState; busy: boolean; outcome: Outcome | null; onAct: (page: PageState) => void }) {
  const plan = clickPlan({ connection: state.connection, page })
  const title = page.inLibrary?.title ?? page.paper?.title
  const byline = [authorsOf(page.paper?.authors ?? []), page.paper?.venue, page.paper?.year].filter(Boolean).join(" · ")
  const where = page.inLibrary ? (page.inLibrary.hasPdf ? t`In your Library` : t`In your Library, without its PDF`) : undefined
  const label = plan.do === "add" ? t`Add to owlit` : plan.do === "save" ? t`Save PDF to owlit` : plan.do === "take" ? t`Give this PDF to owlit` : undefined
  return (
    <section className="flex flex-col items-start gap-2">
      {title && (
        <div className="flex min-w-0 flex-col gap-0.5 self-stretch">
          <p className="line-clamp-2 font-medium text-balance">{title}</p>
          {byline && <p className="truncate text-detail text-muted-foreground">{byline}</p>}
          {where && <p className="text-detail text-muted-foreground">{where}</p>}
        </div>
      )}
      {/* What was just done takes the button's place; the button stays while there is still something to do */}
      {outcome ? <Said outcome={outcome} /> : plan.do === "say" && <Said outcome={plan.outcome} />}
      {label && (!outcome || outcome.kind === "failed" || outcome.kind === "needs-site") && (
        <Button disabled={busy} onClick={() => onAct(page)}>
          {busy && <Spinner wait={false} />}
          {label}
        </Button>
      )}
    </section>
  )
}

// The first two authors, else the first and "et al."
const authorsOf = (authors: string[]) => (authors.length > 2 ? t`${authors[0]} et al.` : authors.join(", "))

// What this tab's site waits for, or owlit going on there once the person got through
function Waiting({ state }: { state: PopupState }) {
  if (state.going) {
    const { done, total } = state.going
    return <p className="border-t pt-3 text-detail text-muted-foreground">{t({ message: `Going on · ${done} of ${total}`, comment: "popup: owlit fetches the papers that waited at this site; how many came so far" })}</p>
  }
  const { text, detail } = cardOf({ kind: "wait", wait: state.wait! })
  return (
    <section className="flex flex-col gap-0.5 border-t pt-3">
      <p className="text-detail">{text}</p>
      {detail && <Muted>{detail}</Muted>}
    </section>
  )
}

function Said({ outcome }: { outcome: Outcome }) {
  const { text, detail, action } = cardOf(outcome)
  const paperId = action?.do.kind === "open-paper" ? action.do.paperId : undefined
  return (
    <div role="status" className="flex flex-col items-start gap-2">
      <div className="flex flex-col gap-0.5">
        <p>{text}</p>
        {detail && <Muted>{detail}</Muted>}
      </div>
      {paperId && (
        <Button size="sm" variant="outline" onClick={() => void send({ kind: "open", paperId })}>
          {t`Open in owlit`}
        </Button>
      )}
    </div>
  )
}

const brokenText = () => t`Something went wrong in the owlit extension. Close this and try again.`

const Muted = ({ children }: { children: React.ReactNode }) => <p className="text-detail text-muted-foreground">{children}</p>
