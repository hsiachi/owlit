import { Switch } from "@/components/ui/switch"
import { List, Row } from "../parts"
import { setActivity, useSettings } from "../store"

export function PrivacySection() {
  const enabled = useSettings((s) => s.view?.activity.enabled ?? true)
  return (
    <List>
      <Row
        name="Remember what I do in owlit"
        info="Owlit uses what you open, highlight and write to keep Knowledge and Home up to date. It stays in this workspace. Off means Owlit only knows what you tell it in a chat."
        control={<Switch checked={enabled} onCheckedChange={(on) => void setActivity(on)} aria-label="Remember what I do in owlit" />}
      />
    </List>
  )
}
