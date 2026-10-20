import { t } from "@lingui/core/macro"
import { useState } from "react"
import { DEFAULT_ROLE, FIRST_CHOICE_AGENT, NOTE_LANGUAGES } from "@owlit/protocol"
import { RoleLines } from "@/components/role-lines"
import { isDesktop } from "@/lib/rpc"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { isFound as isReady } from "@/features/chat/lib/connector-status"
import { useChatStore } from "@/features/chat/store"
import { checkForUpdates, openReleaseNotes, restartToUpdate, setAutoUpdate, useUpdates } from "@/features/updates/store"
import { ago } from "@/lib/time"
import { useWorkspace } from "@/lib/workspace"
import { toastError } from "@/lib/toast"
import { CommitInput, Group, List, Picker, Row } from "../parts"
import { setActivity, updateSettings, useSettings } from "../store"
import { KeptInMindRow } from "./Memory"

// What Owlit calls you, what it keeps in mind about you, the agent for the tasks you hand it, and what it
// records of what you do. Owlit works only when you ask (a digest, a thread's papers), so
// there is no setting for work of its own.
// The agent for those tasks sits here rather than under Agents: people come to change their digests,
// and which agent writes them is part of that.
export function OwlitSection() {
  // What Owlit keeps in mind belongs to a workspace: on the welcome page and in the first launch there is
  // none to ask, and it isn't shown
  const workspace = useWorkspace((s) => !!s.current)
  return (
    <>
      <Group id="profile">
        <List>
          <NameRow />
          {(workspace || !isDesktop) && <KeptInMindRow />}
        </List>
      </Group>
      <Group id="roles" label={t`What Owlit may do`} note={t`Reviewer, which changes nothing of yours, and Co-author, which also runs commands, are in the composer, for one chat at a time. What the agent reads of your workspace is under Privacy.`}>
        <RoleLines role={DEFAULT_ROLE} className="mt-1 text-sm leading-6 text-foreground" />
      </Group>
      <Group id="background" label={t`Tasks you hand Owlit`}>
        <HandedTasks />
      </Group>
      <Group id="privacy" label={t`Privacy`} note={t`What owlit remembers stays on this Mac and is never sent anywhere but to the agent. The agent reads the files of this workspace and your papers through owlit, and what you did in owlit when Remember is on; nothing outside the workspace folder. Claude Code is held to that by its sandbox; Codex can't be.`}>
        <MemoryRow />
      </Group>
      {isDesktop && (
        <Group id="updates" label={t`Updates`}>
          <UpdatesRows />
        </Group>
      )}
    </>
  )
}

// What Owlit calls the user; the first launch's About you step shows this row too, narrower
export function NameRow({ className }: { className?: string }) {
  const name = useSettings((s) => s.view?.profile.name ?? "")
  return (
    <Row
      name={t`Your name`}
      control={
        <CommitInput
          value={name}
          onCommit={(next) => void updateSettings({ profile: { name: next || null } }).catch(toastError)}
          placeholder={t`What Owlit calls you`}
          spellCheck={false}
          autoComplete="off"
          maxLength={60}
          aria-label={t`Your name`}
          className={className}
        />
      }
    />
  )
}

// The tasks owlit starts a chat for when you press their button: a digest, a thread's work, a Go
// through, an answer under Owlit's comment
function HandedTasks() {
  const connectors = useChatStore((s) => s.connectors)
  const view = useSettings((s) => s.view)
  const ready = connectors.filter(isReady)
  // Unset means the first agent that is ready, owlit's first choice first (core's own choice)
  const fallback = ready.find((c) => c.id === FIRST_CHOICE_AGENT) ?? ready[0]
  const chosen = view?.backgroundAgent ?? ""
  const fallbackName = fallback?.name
  const options = [
    { value: "", label: fallbackName ? t`Automatic (${fallbackName})` : t`Automatic` },
    ...connectors.filter((c) => isReady(c) || c.id === chosen).map((c) => ({ value: c.id, label: c.name })),
  ]
  // The agent doing the work, and the models it offers (an agent's own "Default" is not a real choice)
  const agent = connectors.find((c) => c.id === (chosen || fallback?.id))
  const models = agent?.models.filter((m) => m.id !== "default") ?? []
  const defaultModel = models.find((m) => m.id === agent?.defaultModelId) ?? models[0]
  const groups = new Set(models.map((m) => m.group).filter(Boolean)).size
  // Only real models, as in the composer: unset shows the agent's default by name, and picking that
  // model goes back to unset, so it keeps following the agent's default if that changes. Models from more
  // than one sign-in say whose they are, as the composer's headings do.
  const modelOptions = models.map((m) => ({ value: m.id, label: groups > 1 && m.group ? `${m.group} · ${m.name}` : m.name }))
  const saved = agent && view?.backgroundModels?.[agent.id]
  const chosenModel = (saved && models.some((m) => m.id === saved) ? saved : defaultModel?.id) ?? ""
  return (
    <List>
      <Row
        name={t`Agent`}
        help={t`Writes digests, works on threads, goes through docs and answers under its comments.`}
        control={<Picker label={t`Agent for tasks you hand Owlit`} value={chosen} options={options} onChange={(id) => void updateSettings({ backgroundAgent: id || null })} />}
      />
      {agent && models.length > 1 && (
        <Row
          name={t`Model`}
          info={t`A smaller one costs less. Digests come out best from the strongest: it catches what a paper doesn't support.`}
          control={<Picker label={t`Model for tasks you hand Owlit`} value={chosenModel} options={modelOptions} onChange={(model) => void updateSettings({ backgroundModel: { agent: agent.id, model: model === defaultModel?.id ? null : model } })} />}
        />
      )}
      <LanguageRow />
    </List>
  )
}

// The language of digests: a listed one, or Other with the user's own words for it. Unset follows
// the system's language, shown as the value; picking the system's language goes back to unset, so it
// keeps following the system. Terms keeping the paper's wording is the digest's rule, not a choice here.
export function LanguageRow() {
  const stored = useSettings((s) => s.view?.library.digestLanguage)
  const system = useSettings((s) => s.view?.library.digestLanguageSystem) ?? "en"
  const listed = !stored || NOTE_LANGUAGES.some((l) => l.code === stored)
  const [typing, setTyping] = useState(false)
  const other = typing || !listed
  const options = [...NOTE_LANGUAGES.map((l) => ({ value: l.code, label: l.native })), { value: OTHER, label: t({ message: "Other…", comment: "a language not in the list" }) }]
  const save = (language: string | null) => void updateSettings({ library: { digestLanguage: language } })
  return (
    <Row
      name={t`Digests in`}
      info={t`Technical terms stay as the paper writes them, whatever the language.`}
      control={
        <div className="flex items-center gap-2">
          {other && (
            <CommitInput
              aria-label={t`Language for digests`}
              placeholder={t`Language`}
              value={listed ? "" : (stored ?? "")}
              onCommit={(words) => {
                if (words) save(words)
              }}
              autoFocus={typing}
              className="w-36"
            />
          )}
          <Picker
            label={t`Language for digests`}
            value={other ? OTHER : (stored ?? system)}
            options={options}
            onChange={(code) => {
              setTyping(code === OTHER)
              if (code !== OTHER) save(code === system ? null : code)
            }}
          />
        </div>
      }
    />
  )
}

const OTHER = "other"

// This version, where an update stands, and the switch for checking by itself. A build that doesn't update
// itself says why, and has no switch.
function UpdatesRows() {
  const view = useUpdates((s) => s.view)
  if (!view) return null
  const { build, status, checkedAt } = view
  const version = build.version
  const label = [build.channel, build.commit].filter(Boolean).join(" · ")
  const checkNow = (
    <Button variant="text" size="inline" className="last:-mr-1.5" onClick={() => void checkForUpdates().catch(toastError)}>
      {t`Check now`}
    </Button>
  )
  let help: string
  let control: React.ReactNode = null
  if (status.kind === "off" && status.available) {
    // An unsigned build: the newer release is downloaded from its page
    const { available } = status
    help = t`Owlit ${available.version} is out. This build can't install updates itself yet.`
    control = (
      <>
        {available.notes && (
          <Button variant="text" size="inline" onClick={openReleaseNotes}>
            {t`What's new`}
          </Button>
        )}
        <Button variant="outline" size="sm" className="last:-mr-0.5" asChild>
          <a href={available.url} target="_blank" rel="noreferrer">
            {t({ message: "Download", comment: "a button: open the new version's release page to download it" })}
          </a>
        </Button>
      </>
    )
  } else if (status.kind === "off") {
    help =
      status.reason === "location"
        ? t`Move Owlit to the Applications folder to get updates.`
        : status.reason === "unsigned"
          ? t`This build can't install updates itself yet.`
          : t`Built from source (${label}), so it doesn't update itself.`
    if (status.reason === "unsigned") control = checkNow
  } else if (status.kind === "checking") {
    help = t`Checking…`
  } else if (status.kind === "downloading") {
    const percent = status.percent
    help = percent === undefined ? t`Downloading Owlit ${status.version}…` : t`Downloading Owlit ${status.version}… ${percent}%`
  } else if (status.kind === "ready") {
    help = t`Owlit ${status.version} is ready. It installs when you quit Owlit.`
    control = (
      <Button variant="text" size="inline" className="last:-mr-1.5" onClick={() => void restartToUpdate()}>
        {t({ message: "Restart", comment: "a button: restart Owlit to install the update" })}
      </Button>
    )
  } else if (status.kind === "failed") {
    help = status.message
    control = checkNow
  } else {
    const when = checkedAt && ago(checkedAt, { inSentence: true })
    help = when ? t`Up to date · checked ${when}` : t`Not checked yet`
    control = checkNow
  }
  return (
    <List>
      <Row name={t`Owlit ${version}`} help={help} control={control} />
      {status.kind !== "off" && (
        <Row
          name={t`Check for updates automatically`}
          help={t`About once a day. A new version downloads in the background and installs when you quit Owlit.`}
          control={<Switch checked={view.auto} onCheckedChange={(on) => void setAutoUpdate(on).catch(toastError)} aria-label={t`Check for updates automatically`} />}
        />
      )}
    </List>
  )
}

function MemoryRow() {
  const enabled = useSettings((s) => s.view?.activity.enabled ?? true)
  return (
    <List>
      <Row
        name={t`Remember what I do in owlit`}
        // A machine setting (settings.json), for every workspace opened here. Off also stops a finished
        // paper turning Read: the read-in-full check (core's read-in-full.ts) reads only the journal.
        help={t`What you read, write and ask on this Mac is noted in the workspace's .owlit/journal.jsonl, so Owlit can follow your work. This file goes wherever the folder goes. Off: nothing is noted, and papers you finish stay as you left them.`}
        control={<Switch checked={enabled} onCheckedChange={(on) => void setActivity(on)} aria-label={t`Remember what I do in owlit`} />}
      />
    </List>
  )
}
