import { Switch } from "@/components/ui/switch"
import { List, Row } from "../parts"
import { setActivity, useSettings } from "../store"

export function PrivacySection() {
  const enabled = useSettings((s) => s.view?.activity.enabled ?? true)
  return (
    <List>
      <Row
        name="Remember what I do in owlit"
        help="What you open, highlight and write keeps Knowledge and Home up to date. It stays in this workspace."
        control={<Switch checked={enabled} onCheckedChange={(on) => void setActivity(on)} aria-label="Remember what I do in owlit" />}
      />
    </List>
  )
}
