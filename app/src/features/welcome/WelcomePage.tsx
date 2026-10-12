import { useEffect, useRef, useState } from "react"
import type { RecentWorkspace, WelcomeInfo } from "@owlit/protocol"
import { FolderIcon, FolderOpenIcon, FolderPlusIcon, FolderXIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { BorderedList } from "@/components/bordered-list"
import { GroupLabel } from "@/components/group-label"
import { IconButton } from "@/components/icon-button"
import { ListRow } from "@/components/list-row"
import { OwlitLockup } from "@/components/owlit-lockup"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SettingsDialog } from "@/features/settings/SettingsDialog"
import { useSettingsShortcut } from "@/features/settings/hooks"
import { CommitInput } from "@/features/settings/parts"
import { updateSettings, useSettings } from "@/features/settings/store"
import { bridge, rpc } from "@/lib/rpc"
import { useControlsRoom } from "@/lib/window-frame"
import { AgentCheck } from "./AgentCheck"

// The page the window shows while no workspace is open: on a first launch, or when the last workspace is
// no longer where it was. It asks where to work, and, until the user has given one, what Owlit should
// call them (optional; Settings › Profile keeps it). Either workspace choice opens Home at once; there
// are no further steps. The window has no rail here, since none of the places exist yet.

// "~/Documents" rather than the whole home path
const tilde = (p: string) => p.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~")
const parentOf = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/"

const failed = (error: unknown) => toast.error(error instanceof Error ? error.message : String(error))

export function WelcomePage() {
  const [info, setInfo] = useState<WelcomeInfo | null>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState("")
  const [parent, setParent] = useState("")
  const controlsRoom = useControlsRoom((s) => s.room)
  useSettingsShortcut()

  const load = () =>
    rpc.workspace
      .welcome()
      .then((next) => {
        setInfo(next)
        setName(next.suggestion.name)
        setParent(next.suggestion.parent)
      })
      .catch(failed)
  useEffect(() => {
    void load()
  }, [])

  const create = () => rpc.workspace.create({ parent, name: name.trim() || info!.suggestion.name }).catch(failed)

  const openFolder = async () => {
    const folder = await bridge?.chooseFolder({
      title: "Open a Folder",
      message: "Choose the folder owlit works in. Your files stay as they are; owlit keeps its own state in .owlit.",
      buttonLabel: "Open",
    })
    if (folder) await rpc.workspace.open({ path: folder }).catch(failed)
  }

  const chooseParent = async () => {
    const folder = await bridge?.chooseFolder({ title: "Where the Workspace Goes", buttonLabel: "Choose", defaultPath: parent })
    if (folder) setParent(folder)
  }

  // A moved workspace, found again: it opens, and its old place leaves the list
  const locate = async (gone: RecentWorkspace) => {
    const folder = await bridge?.chooseFolder({ title: `Locate ${gone.name}`, buttonLabel: "Open", defaultPath: parentOf(gone.path) })
    if (!folder) return
    try {
      await rpc.workspace.open({ path: folder })
      await rpc.workspace.forget({ path: gone.path })
    } catch (error) {
      failed(error)
    }
  }

  const forget = (gone: RecentWorkspace) =>
    rpc.workspace
      .forget({ path: gone.path })
      .then(load)
      .catch(failed)

  return (
    <TooltipProvider>
      <div className="flex h-svh flex-col bg-background">
        {/* Moves the window, as the app's top bar does; the traffic lights sit at its left */}
        <div className="app-drag h-10 shrink-0" style={controlsRoom ? { paddingLeft: controlsRoom } : undefined} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[460px] px-4 pt-[9vh] pb-16">
            <OwlitLockup className="ml-0.5 h-auto w-34 text-foreground" />
            <p className="mt-4.5 text-body leading-normal text-muted-foreground">
              Read, write and think through papers with Owlit. Everything lives in a folder on your Mac.
            </p>

            <NameField />

            <BorderedList className="mt-7">
              {editing ? (
                <CreateForm
                  name={name}
                  parent={parent}
                  onName={setName}
                  onChooseParent={chooseParent}
                  onCancel={() => {
                    setEditing(false)
                    if (info) {
                      setName(info.suggestion.name)
                      setParent(info.suggestion.parent)
                    }
                  }}
                  onCreate={create}
                />
              ) : (
                <div className="flex min-h-15 items-center gap-3 pr-2.5 pl-3.5 transition-colors hover:bg-muted">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 self-stretch text-left outline-none focus-key:bg-muted" disabled={!info} onClick={create}>
                    <FolderPlusIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">Create a workspace</span>
                      <span className="block truncate text-detail text-muted-foreground">{info ? `${tilde(parent)}/${name}` : " "}</span>
                    </span>
                  </button>
                  <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={!info} onClick={() => setEditing(true)}>
                    Change…
                  </Button>
                </div>
              )}
              <button
                type="button"
                className="flex min-h-15 w-full items-center gap-3 px-3.5 text-left transition-colors outline-none hover:bg-muted focus-key:bg-muted"
                onClick={openFolder}
              >
                <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Open a folder you have</span>
                  <span className="block truncate text-detail text-muted-foreground">Notes, an Obsidian vault, PDFs. Your files stay as they are.</span>
                </span>
              </button>
            </BorderedList>

            {!!info?.recent.length && (
              <section className="mt-7">
                <GroupLabel>Recent</GroupLabel>
                <div className="flex flex-col gap-0.5">
                  {info.recent.map((w) =>
                    w.missing ? (
                      <div key={w.path} className="group/gone flex h-9 min-w-0 items-center gap-2.5 rounded-md pr-1 pl-2.5 text-sm">
                        <FolderXIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="max-w-[60%] shrink-0 truncate text-muted-foreground">{w.name}</span>
                        <span className="min-w-0 flex-1 truncate text-detail text-muted-foreground" title={w.path}>
                          isn’t at {tilde(w.path)} anymore
                        </span>
                        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => locate(w)}>
                          Locate…
                        </Button>
                        <IconButton label="Remove from Recent" size="icon-xs" className="opacity-0 group-hover/gone:opacity-100 focus-key:opacity-100" onClick={() => forget(w)}>
                          <XIcon />
                        </IconButton>
                      </div>
                    ) : (
                      <ListRow key={w.path} icon={FolderIcon} title={w.name} detail={tilde(w.path)} onClick={() => rpc.workspace.open({ path: w.path }).catch(failed)} />
                    ),
                  )}
                </div>
              </section>
            )}

            <AgentCheck />
          </div>
        </main>
      </div>
      <SettingsDialog />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}

// What Owlit should call the user. Asked only while no name is set: the page also shows when a workspace
// has moved, and someone who already answered isn't asked again. Once shown it stays for the visit, so
// it doesn't vanish under the cursor when the name is kept.
function NameField() {
  const view = useSettings((s) => s.view)
  const [asking, setAsking] = useState<boolean | null>(null)
  if (view && asking === null) setAsking(!view.profile.name)
  if (!asking) return null
  return (
    <div className="mt-7 flex items-center gap-3 rounded-lg border bg-card py-2.5 pr-2.5 pl-3.5">
      <label htmlFor="welcome-name" className="flex-1 text-sm font-medium">
        What should Owlit call you?
      </label>
      <CommitInput
        id="welcome-name"
        value={view?.profile.name ?? ""}
        onCommit={(name) => void updateSettings({ profile: { name: name || null } }).catch(failed)}
        placeholder="Your name"
        spellCheck={false}
        autoComplete="off"
        maxLength={60}
        className="w-44"
      />
    </div>
  )
}

// Create a workspace, with its name and place open for changing first
function CreateForm({
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
      className="py-3 pr-3.5 pl-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        onCreate()
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <div className="flex items-center gap-3">
        <FolderPlusIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">Create a workspace</span>
      </div>
      <div className="mt-3 grid grid-cols-[4.5rem_1fr] items-center gap-x-2 gap-y-1.5 pl-7 text-detail">
        <label htmlFor="workspace-name" className="text-muted-foreground">
          Name
        </label>
        <Input id="workspace-name" ref={input} value={name} onChange={(e) => onName(e.target.value)} spellCheck={false} autoComplete="off" />
        <span className="text-muted-foreground">In</span>
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate" title={parent}>
            {tilde(parent)}
          </span>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={onChooseParent}>
            Choose…
          </Button>
        </span>
      </div>
      <div className="mt-3 flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!name.trim()}>
          Create
        </Button>
      </div>
    </form>
  )
}
