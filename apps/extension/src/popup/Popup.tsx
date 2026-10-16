import { t } from "@lingui/core/macro"
import { useCallback, useEffect, useState } from "react"
import { OwlitLockup } from "@/components/owlit-lockup"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { send, type Connection, type Outcome, type PageState, type PopupState } from "../lib/messages.ts"

// The toolbar button's popup: whether this browser is connected to owlit, the page's paper with the one
// thing to do with it, and the one setting. The work itself happens in the background, which outlives
// the popup; the popup only asks and says how it went.
export function Popup() {
  const [tabId, setTabId] = useState<number | null>(null)
  const [state, setState] = useState<PopupState | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const refresh = useCallback(async (id: number) => setState(await send({ kind: "state", tabId: id })), [])

  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
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
    chrome.storage.local.onChanged.addListener(changed)
    return () => chrome.storage.local.onChanged.removeListener(changed)
  }, [refresh, tabId])

  const connect = async () => {
    setState((s) => s && { ...s, connection: { state: "pairing" } })
    const connection = await send({ kind: "connect" })
    setState((s) => s && { ...s, connection })
    if (tabId !== null) void refresh(tabId)
  }

  const act = async (kind: "add" | "save", page: PageState) => {
    if (tabId === null) return
    // The PDF's site, asked for here (a permission can only be asked from a click): the background fetches
    // it with the user's cookies, which needs it
    const address = page.paper?.pdfUrl ?? (page.pdfTab ? page.url : undefined)
    const origins = address ? [`${new URL(address).origin}/*`] : []
    if (origins.length && !(await chrome.permissions.contains({ origins }))) {
      const granted = await chrome.permissions.request({ origins }).catch(() => false)
      const site = new URL(address!).hostname
      if (!granted) return setOutcome({ kind: "failed", message: t`owlit needs to read ${site} to get the PDF with your access.` })
    }
    setBusy(true)
    setOutcome(null)
    try {
      setOutcome(await send({ kind, tabId }))
      await refresh(tabId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex w-80 flex-col gap-3 p-4 text-sm">
      <header className="flex items-center justify-between gap-2">
        <OwlitLockup className="h-4.5 w-auto text-foreground" />
      </header>
      {state ? <Body state={state} busy={busy} outcome={outcome} onConnect={() => void connect()} onAct={(kind, page) => void act(kind, page)} /> : <Spinner className="text-muted-foreground" />}
      {state?.connection.state === "connected" && (
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

function Body({ state, busy, outcome, onConnect, onAct }: { state: PopupState; busy: boolean; outcome: Outcome | null; onConnect: () => void; onAct: (kind: "add" | "save", page: PageState) => void }) {
  const { connection, page } = state
  if (connection.state !== "connected") return <NotConnected connection={connection} onConnect={onConnect} />
  if (connection.workspace === null)
    return (
      <>
        <Muted>{t`Connected to owlit`}</Muted>
        <Muted>{t`Open a workspace in owlit`}</Muted>
      </>
    )
  return (
    <>
      <Muted>{t`Connected to owlit · ${connection.workspace}`}</Muted>
      <PagePaper page={page} busy={busy} outcome={outcome} onAct={onAct} />
    </>
  )
}

function NotConnected({ connection, onConnect }: { connection: Exclude<Connection, { state: "connected" }>; onConnect: () => void }) {
  if (connection.state === "offline") return <Muted>{t`Open owlit to connect`}</Muted>
  if (connection.state === "pairing")
    return (
      <p className="flex items-center gap-2 text-muted-foreground">
        <Spinner wait={false} className="size-3.5" />
        {t`Allow it in owlit…`}
      </p>
    )
  const problem = {
    refused: t`You didn't allow it in owlit.`,
    expired: t`Nobody answered in owlit.`,
    "no-window": t`Open the owlit window, then press Connect again.`,
  }
  return (
    <>
      <p>{t`Add the paper of any page to owlit, with its PDF.`}</p>
      {connection.problem && <Muted>{problem[connection.problem]}</Muted>}
      <Button className="self-start" onClick={onConnect}>
        {t`Connect to owlit`}
      </Button>
    </>
  )
}

function PagePaper({ page, busy, outcome, onAct }: { page: PageState | null; busy: boolean; outcome: Outcome | null; onAct: (kind: "add" | "save", page: PageState) => void }) {
  if (!page || (!page.paper && !page.inLibrary)) return <Muted>{page?.pdfTab ? t`owlit can't tell which paper this PDF is.` : t`This page doesn't show a paper.`}</Muted>
  const title = page.inLibrary?.title ?? page.paper?.title
  const pdfNamed = !!page.paper?.pdfUrl || page.pdfTab
  let action: React.ReactNode
  if (!page.inLibrary) {
    action = (
      <Button disabled={busy} onClick={() => onAct("add", page)}>
        {busy && <Spinner wait={false} />}
        {t`Add to owlit`}
      </Button>
    )
  } else if (page.inLibrary.hasPdf) {
    action = <Muted>{t`In your Library`}</Muted>
  } else if (pdfNamed) {
    action = (
      <Button disabled={busy} onClick={() => onAct("save", page)}>
        {busy && <Spinner wait={false} />}
        {t`Save PDF to owlit`}
      </Button>
    )
  } else {
    action = <Muted>{t`In your Library, without its PDF. This page names no PDF to save.`}</Muted>
  }
  return (
    <section className="flex flex-col items-start gap-2">
      {title && <p className="line-clamp-3 font-medium text-balance">{title}</p>}
      {/* What was just done takes the action's place once there is nothing more to do */}
      {outcome ? <Said outcome={outcome} /> : action}
      {outcome && page.inLibrary && !page.inLibrary.hasPdf && pdfNamed && outcome.kind !== "saved" && action}
    </section>
  )
}

function Said({ outcome }: { outcome: Outcome }) {
  const host = "host" in outcome ? (outcome.host ?? "") : ""
  let text: string
  switch (outcome.kind) {
    case "added":
      text = {
        saved: t`Added to owlit with its PDF`,
        "none-named": t`Added to owlit. owlit looks for its PDF.`,
        "not-a-pdf": t`Added; ${host} gave no PDF`,
        "not-this-paper": t`Added; the PDF there isn't this paper's`,
      }[outcome.pdf]
      break
    case "saved":
      text = t`PDF saved to owlit`
      break
    case "no-pdf":
      text = t`${host} gave no PDF`
      break
    case "not-this-paper":
      text = t`This isn't the paper's PDF`
      break
    case "has-pdf":
      text = t`In your Library`
      break
    case "no-workspace":
      text = t`Open a workspace in owlit`
      break
    case "offline":
      text = t`Open owlit to connect`
      break
    case "unpaired":
      text = t`This browser isn't connected to owlit.`
      break
    case "failed":
      text = outcome.message
      break
  }
  return (
    <p role="status" className="text-detail text-muted-foreground">
      {text}
    </p>
  )
}

const Muted = ({ children }: { children: React.ReactNode }) => <p className="text-detail text-muted-foreground">{children}</p>
