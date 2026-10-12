import { useEffect } from "react"
import { Switch } from "@/components/ui/switch"
import { useCheck } from "../form-state"
import { CheckMark, CheckNote, CommitInput, Group, List, Picker, Row, SecretRow } from "../parts"
import { updateSettings, useSettings } from "../store"

type Reader = "builtin" | "cloud" | "self-hosted"

const OPTIONS: { value: Reader; label: string }[] = [
  { value: "builtin", label: "Built-in only" },
  { value: "cloud", label: "MinerU cloud" },
  { value: "self-hosted", label: "MinerU on my own server" },
]

export function ReadingGroup() {
  const parsing = useSettings((s) => s.view?.parsing)
  const reader: Reader = parsing?.service ?? "builtin"
  return (
    <Group id="reading" label="Reading PDFs">
      <List>
        <Row
          name="Read PDFs with"
          help="Built-in is instant. MinerU is slower but gets tables, formulas and scans right."
          control={<Picker label="Read PDFs with" value={reader} options={OPTIONS} onChange={(next) => void updateSettings({ parsing: { service: next === "builtin" ? null : next } })} />}
        />
        {reader === "cloud" && (
          <SecretRow
            name="mineruToken"
            label="Token"
            service="MinerU"
            info="MinerU's API token. Kept in the system keychain."
            getFrom={{ label: "mineru.net", href: "https://mineru.net/apiManage/token" }}
          />
        )}
        {reader === "self-hosted" && <ServerRow url={parsing?.url ?? ""} />}
        {reader !== "builtin" && (
          <Row
            name="Read new PDFs with MinerU automatically"
            help="Off, MinerU reads a paper only when you ask on its page."
            control={<Switch checked={parsing?.auto ?? true} onCheckedChange={(auto) => void updateSettings({ parsing: { auto } })} aria-label="Read new PDFs with MinerU automatically" />}
          />
        )}
      </List>
    </Group>
  )
}

function ServerRow({ url }: { url: string }) {
  const check = useCheck()
  // Whether the server answers, each time the section opens with an address set
  useEffect(() => {
    if (url) void check.run("mineruServer")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <Row
      name="Address"
      control={
        <>
          <CheckMark {...check} service="MinerU" accepted="MinerU answered" />
          <CommitInput
            aria-label="MinerU address"
            spellCheck={false}
            placeholder="http://127.0.0.1:8000"
            value={url}
            className="font-mono"
            validate={(text) => (/^https?:\/\/\S+$/.test(text) ? null : "An address starts with http:// or https://.")}
            onCommit={async (next) => {
              await updateSettings({ parsing: { url: next || null } })
              void check.run("mineruServer")
            }}
          />
        </>
      }
    >
      <CheckNote {...check} />
    </Row>
  )
}
