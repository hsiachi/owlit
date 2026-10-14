import { t } from "@lingui/core/macro"
import { useState } from "react"
import { FIRST_CHOICE_AGENT, NOTE_LANGUAGES } from "@owlit/protocol"
import { Switch } from "@/components/ui/switch"
import { isFound as isReady } from "@/features/chat/lib/connector-status"
import { useChatStore } from "@/features/chat/store"
import { CommitInput, Group, List, Picker, Row } from "../parts"
import { setActivity, updateSettings, useSettings } from "../store"

// What Owlit calls you, the work it does when nobody is waiting, and what it remembers of how you work.
// The agent for background work sits here rather than under Agents: people come to change their digests,
// and which agent writes them is part of that.
export function OwlitSection() {
  return (
    <>
      <Group id="profile">
        <NameRow />
      </Group>
      <Group id="background" label={t`Background work`}>
        <BackgroundWork />
      </Group>
      <Group id="privacy" label={t`Privacy`} note={t`What owlit remembers stays in this workspace and is never sent anywhere.`}>
        <MemoryRow />
      </Group>
    </>
  )
}

function NameRow() {
  const name = useSettings((s) => s.view?.profile.name ?? "")
  return (
    <List>
      <Row
        name={t`Your name`}
        control={
          <CommitInput
            value={name}
            onCommit={(next) => void updateSettings({ profile: { name: next || null } })}
            placeholder={t`What Owlit calls you`}
            spellCheck={false}
            autoComplete="off"
            maxLength={60}
            aria-label={t`Your name`}
          />
        }
      />
    </List>
  )
}

// Work nobody is waiting on: digests, and keeping Knowledge up to date
function BackgroundWork() {
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
        help={t`Writes digests and keeps Knowledge up to date.`}
        control={<Picker label={t`Agent for background work`} value={chosen} options={options} onChange={(id) => void updateSettings({ backgroundAgent: id || null })} />}
      />
      {agent && models.length > 1 && (
        <Row
          name={t`Model`}
          info={t`A smaller one costs less. Digests come out best from the strongest: it catches what a paper doesn't support.`}
          control={<Picker label={t`Model for background work`} value={chosenModel} options={modelOptions} onChange={(model) => void updateSettings({ backgroundModel: { agent: agent.id, model: model === defaultModel?.id ? null : model } })} />}
        />
      )}
      <LanguageRow />
      <Row
        name={t`Digests for every paper`}
        help={t`Otherwise only for papers you open or star.`}
        info={t`On, a big import keeps the agent busy for a while.`}
        control={<Switch checked={view?.library.digestEveryPaper ?? false} onCheckedChange={(on) => void updateSettings({ library: { digestEveryPaper: on } })} aria-label={t`Digests for every paper`} />}
      />
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

function MemoryRow() {
  const enabled = useSettings((s) => s.view?.activity.enabled ?? true)
  return (
    <List>
      <Row
        name={t`Remember what I do in owlit`}
        help={t`What you read, write and ask in this workspace is noted in .owlit/journal.jsonl, so Owlit can follow your work.`}
        control={<Switch checked={enabled} onCheckedChange={(on) => void setActivity(on)} aria-label={t`Remember what I do in owlit`} />}
      />
    </List>
  )
}
