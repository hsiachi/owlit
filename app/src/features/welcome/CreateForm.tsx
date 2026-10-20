import { useEffect, useRef } from "react"
import { t } from "@lingui/core/macro"
import { FolderPlusIcon } from "lucide-react"
import { RowIcon, rowClass } from "@/components/row-list"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { tilde } from "@/lib/workspace"

// Create a workspace, with its name and place open for changing first
export function CreateForm({
  name,
  parent,
  onName,
  onChooseParent,
  onCancel,
  onCreate,
}: {
  name: string
  parent: string
  onName: (name: string) => void
  onChooseParent: () => void
  onCancel: () => void
  onCreate: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  return (
    <form
      className={cn("bg-accent py-3", rowClass)}
      onSubmit={(e) => {
        e.preventDefault()
        onCreate()
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <div className="flex items-center gap-3">
        <RowIcon>
          <FolderPlusIcon />
        </RowIcon>
        <span className="text-sm font-medium">{t`Create a workspace`}</span>
      </div>
      <div className="mt-3 grid grid-cols-[4.5rem_1fr] items-center gap-x-2 gap-y-1.5 pl-11 text-detail">
        <label htmlFor="workspace-name" className="text-muted-foreground">
          {t({ message: "Name", comment: "label: the new workspace folder's name" })}
        </label>
        <Input id="workspace-name" ref={input} value={name} onChange={(e) => onName(e.target.value)} spellCheck={false} autoComplete="off" />
        <span className="text-muted-foreground">{t({ message: "In", comment: "label: the folder the new workspace goes in" })}</span>
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate" title={parent}>
            {tilde(parent)}
          </span>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={onChooseParent}>
            {t`Choose…`}
          </Button>
        </span>
      </div>
      <div className="mt-3 flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t`Cancel`}
        </Button>
        <Button type="submit" size="sm" disabled={!name.trim()}>
          {t({ message: "Create", comment: "verb: create the workspace" })}
        </Button>
      </div>
    </form>
  )
}
