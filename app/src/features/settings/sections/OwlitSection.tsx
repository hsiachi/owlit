import { FIRST_CHOICE_AGENT } from "@owlit/protocol"
import { Switch } from "@/components/ui/switch"
import { isFound as isReady } from "@/features/chat/lib/connector-status"
import { useChatStore } from "@/features/chat/store"
import { CommitInput, Group, List, Picker, Row } from "../parts"
import { setActivity, updateSettings, useSettings } from "../store"

// What Owlit calls you, the work it does when nobody is waiting, and what it remembers of how you work.
// The agent for background work sits here rather than under Agents: people come to change their reading
// notes, and which agent writes them is part of that.
export function OwlitSection() {
  return (
    <>
      <Group id="profile">
        <NameRow />
      </Group>
      <Group id="background" label="Background work">
        <BackgroundWork />
      </Group>
      <Group id="privacy" label="Privacy" note="What owlit remembers stays in this workspace and is never sent anywhere.">
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
        name="Your name"
        control={
          <CommitInput
            value={name}
            onCommit={(next) => void updateSettings({ profile: { name: next || null } })}
            placeholder="What Owlit calls you"
            spellCheck={false}
            autoComplete="off"
            maxLength={60}
            aria-label="Your name"
          />
        }
      />
    </List>
  )
}

// Work nobody is waiting on: reading notes, and keeping Knowledge up to date
function BackgroundWork() {
  const connectors = useChatStore((s) => s.connectors)
  const view = useSettings((s) => s.view)
  const ready = connectors.filter(isReady)
  // Unset means the first agent that is ready, owlit's first choice first (core's own choice)
  const fallback = ready.find((c) => c.id === FIRST_CHOICE_AGENT) ?? ready[0]
  const chosen = view?.backgroundAgent ?? ""
  const options = [{ value: "", label: fallback ? `Automatic (${fallback.name})` : "Automatic" }, ...connectors.filter((c) => isReady(c) || c.id === chosen).map((c) => ({ value: c.id, label: c.name }))]
  // The agent doing the work, and the models it offers (an agent's own "Default" is not a real choice)
  const agent = connectors.find((c) => c.id === (chosen || fallback?.id))
  const models = agent?.models.filter((m) => m.id !== "default") ?? []
  const defaultModel = models.find((m) => m.id === agent?.defaultModelId) ?? models[0]
  const groups = new Set(models.map((m) => m.group).filter(Boolean)).size
  const modelOptions = [
    { value: "", label: defaultModel ? `Its default (${defaultModel.name})` : "Its default" },
    // Models from more than one sign-in say whose they are, as the composer's headings do
    ...models.map((m) => ({ value: m.id, label: groups > 1 && m.group ? `${m.group} · ${m.name}` : m.name })),
  ]
  const chosenModel = (agent && view?.backgroundModels?.[agent.id]) ?? ""
  return (
    <List>
      <Row
        name="Agent"
        help="Writes reading notes and keeps Knowledge up to date."
        control={<Picker label="Agent for background work" value={chosen} options={options} onChange={(id) => void updateSettings({ backgroundAgent: id || null })} />}
      />
      {agent && models.length > 1 && (
        <Row
          name="Model"
          info="A smaller one costs less; reading notes rarely need the strongest."
          control={<Picker label="Model for background work" value={chosenModel} options={modelOptions} onChange={(model) => void updateSettings({ backgroundModel: { agent: agent.id, model: model || null } })} />}
        />
      )}
      <Row
        name="Reading notes in"
        info="Papers keep their own language."
        // Unset is English (core's default), shown as the value rather than a placeholder that looks like one
        control={
          <CommitInput
            aria-label="Reading notes language"
            placeholder="English"
            value={view?.library.digestLanguage ?? "English"}
            onCommit={(language) => void updateSettings({ library: { digestLanguage: language && language !== "English" ? language : null } })}
            className="w-40"
          />
        }
      />
      <Row
        name="Reading notes for every paper"
        help="Otherwise only for papers you open or star."
        info="On, a big import keeps the agent busy for a while."
        control={<Switch checked={view?.library.digestEveryPaper ?? false} onCheckedChange={(on) => void updateSettings({ library: { digestEveryPaper: on } })} aria-label="Reading notes for every paper" />}
      />
    </List>
  )
}

function MemoryRow() {
  const enabled = useSettings((s) => s.view?.activity.enabled ?? true)
  return (
    <List>
      <Row
        name="Remember what I do in owlit"
        help="What you open, highlight and write keeps Knowledge and Home current."
        control={<Switch checked={enabled} onCheckedChange={(on) => void setActivity(on)} aria-label="Remember what I do in owlit" />}
      />
    </List>
  )
}
