import { CommitInput, List, Row } from "../parts"
import { updateSettings, useSettings } from "../store"

export function ProfileSection() {
  const name = useSettings((s) => s.view?.profile.name ?? "")
  return (
    <List>
      <Row
        name="Name"
        help="What Owlit calls you, in the Chat greeting and in chats."
        control={<CommitInput value={name} onCommit={(next) => void updateSettings({ profile: { name: next || null } })} placeholder="What Owlit calls you" spellCheck={false} autoComplete="off" maxLength={60} aria-label="Name" />}
      />
    </List>
  )
}
