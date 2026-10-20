import { useEffect, useState } from "react"
import { t } from "@lingui/core/macro"
import { useNavigate } from "react-router-dom"
import { create } from "zustand"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { pickParent, switchWorkspace } from "@/lib/workspace"
import { CreateForm } from "./CreateForm"

// File › New Workspace… (and the top bar's workspace menu): the welcome page's Create form over the open
// workspace, so a workspace of one's own is a step away from anywhere, the example included

const useNewWorkspace = create<{ open: boolean }>(() => ({ open: false }))
export const openNewWorkspace = () => useNewWorkspace.setState({ open: true })
const close = () => useNewWorkspace.setState({ open: false })

export function NewWorkspaceDialog() {
  const open = useNewWorkspace((s) => s.open)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="gap-0 p-2 sm:max-w-md" showCloseButton={false}>
        <DialogTitle className="sr-only">{t`Create a workspace`}</DialogTitle>
        <DialogDescription className="sr-only">{t`A new folder for your own papers and notes`}</DialogDescription>
        {open && <Form />}
      </DialogContent>
    </Dialog>
  )
}

function Form() {
  const navigate = useNavigate()
  const [suggested, setSuggested] = useState<{ name: string; parent: string } | null>(null)
  const [name, setName] = useState("")
  const [parent, setParent] = useState("")
  useEffect(() => {
    rpc.workspace
      .welcome()
      .then(({ suggestion }) => {
        setSuggested(suggestion)
        setName(suggestion.name)
        setParent(suggestion.parent)
      })
      .catch((error: unknown) => {
        close()
        toastError(error)
      })
  }, [])
  if (!suggested) return null

  const chooseParent = async () => {
    const folder = await pickParent(parent)
    if (folder) setParent(folder)
  }
  // Home first, after the open workspace's writes are flushed: the page showing now belongs to the
  // workspace being left
  const createIt = () =>
    switchWorkspace(async () => {
      navigate("/")
      return rpc.workspace.create({ parent, name: name.trim() || suggested.name })
    }).then(close, toastError)

  return <CreateForm name={name} parent={parent} onName={setName} onChooseParent={() => void chooseParent()} onCancel={close} onCreate={() => void createIt()} />
}
