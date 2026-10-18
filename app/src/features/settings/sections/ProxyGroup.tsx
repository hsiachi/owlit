import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useState } from "react"
import { PencilIcon } from "lucide-react"
import { PROXY_PRESETS, proxyFromLink, type ProxyPreset, type ProxySettings } from "@owlit/protocol"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RpcError } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { useFoldWhile } from "../form-state"
import { Group, IconAction, List, Note, Picker, Row } from "../parts"
import { setProxy, signInToProxy, useSettings } from "../store"

type Choice = "none" | ProxyPreset | "other"

// PROXY_PRESETS names are English, for agents and logs; the picker shows them in the reader's language
const presetName = (id: ProxyPreset): string => ({ tsinghua: t`Tsinghua University` })[id]

const hostOf = (base: string) => base.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
const describe = (proxy: ProxySettings) => {
  const host = hostOf(proxy.base)
  return proxy.scheme === "host-rewrite" ? t`${host} · rewrites addresses` : t`${host} · sign-in link`
}

export function ProxyGroup() {
  const proxy = useSettings((s) => s.view?.library.proxy)
  // "Another library…" picked, link not given yet
  const [linkOpen, setLinkOpen] = useState(false)
  useFoldWhile(linkOpen && !!proxy, () => setLinkOpen(false))
  const saved: Choice = !proxy ? "none" : proxy.preset && proxy.preset in PROXY_PRESETS ? (proxy.preset as ProxyPreset) : "other"
  const choice: Choice = linkOpen ? "other" : saved

  const options: { value: Choice; label: string }[] = [
    { value: "none", label: t({ message: "None", comment: "no library proxy" }) },
    ...(Object.keys(PROXY_PRESETS) as ProxyPreset[]).map((id) => ({ value: id, label: presetName(id) })),
    { value: "other", label: t`Another library…` },
  ]
  const pick = (next: Choice) => {
    if (next === "other") return setLinkOpen(true)
    setLinkOpen(false)
    void setProxy(next === "none" ? {} : { preset: next })
  }

  return (
    <Group id="proxy" label={t`Library proxy`}>
      <List>
        {/* What a proxy is for, under the choice itself: nobody picks a library without knowing why */}
        <Row
          name={t`Your library`}
          help={t`Reaches paywalled PDFs through your university's proxy, signed in as you.`}
          control={<Picker label={t`Your library`} value={choice} options={options} onChange={pick} />}
        />
        {choice === "other" &&
          (linkOpen || !proxy ? (
            <LinkForm onDone={() => setLinkOpen(false)} />
          ) : (
            <Row
              name={t`Proxy`}
              control={
                <>
                  <span className="text-detail text-muted-foreground">{describe(proxy)}</span>
                  <IconAction label={t`Change proxy`} onClick={() => setLinkOpen(true)}>
                    <PencilIcon />
                  </IconAction>
                </>
              }
            />
          ))}
        {proxy && !linkOpen && <SignIn />}
      </List>
    </Group>
  )
}

// People can't name the kind of proxy their library runs, but they can copy a link from it
function LinkForm({ onDone }: { onDone: () => void }) {
  const [link, setLink] = useState("")
  const [error, setError] = useState<string | null>(null)
  const found = link.trim() ? proxyFromLink(link) : null
  const where = found ? describe(found) : ""
  const use = async () => {
    if (!found) return
    try {
      await setProxy({ link })
      onDone()
    } catch (e) {
      setError(e instanceof RpcError ? e.message : t`Couldn't keep that proxy.`)
    }
  }
  return (
    <div className="-mx-3 mb-2 flex flex-col gap-1.5 rounded-lg bg-muted px-3 py-3">
      <label className="text-xs text-muted-foreground" htmlFor="proxy-link">
        {t`A link to any paper, opened through your library`}
      </label>
      <div className="flex gap-2">
        <Input
          id="proxy-link"
          autoFocus
          spellCheck={false}
          // i18n-ignore
          placeholder="https://ezproxy.example.edu/login?url=https://doi.org/…"
          value={link}
          aria-invalid={(!!link.trim() && !found) || !!error || undefined}
          onChange={(e) => {
            setLink(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void use()
          }}
          className="h-8 flex-1 font-mono text-detail"
        />
        <Button size="sm" disabled={!found} onClick={() => void use()}>
          {t`Use this proxy`}
        </Button>
      </div>
      <div className={error || (link.trim() && !found) ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        {error ??
          (found ? (
            <Trans>
              Proxy at <span className="text-foreground">{where}</span>
            </Trans>
          ) : link.trim() ? (
            t`This link doesn't show a proxy. Open a paper from your library's website and copy the address from the browser.`
          ) : (
            t`Open a paper from your library's website and copy the address from the browser.`
          ))}
      </div>
    </div>
  )
}

// The sign-in happens in the user's own browser, where the owlit extension fetches through the proxy:
// owlit can't see it, so it only opens the page; the extension finds out by itself
function SignIn() {
  const [opened, setOpened] = useState(false)
  const signIn = async () => {
    try {
      await signInToProxy()
      setOpened(true)
    } catch (e) {
      toastError(e, t`Couldn't open your browser.`)
    }
  }
  return (
    <Row
      name={t`Sign-in`}
      info={t`The owlit extension fetches PDFs through the proxy in your browser, signed in as you. Libraries sign you out after a while; owlit says so when a fetch finds the sign-in page.`}
      control={
        <Button variant="outline" size="sm" onClick={() => void signIn()}>
          {t`Sign in…`}
        </Button>
      }
    >
      {opened && <Note>{t`Sign in there; the extension will notice.`}</Note>}
    </Row>
  )
}
