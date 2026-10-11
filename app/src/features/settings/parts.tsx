// The pieces every Settings section is made of: one bordered list with dividers, one setting per row,
// the control at the right, and a second line only for a problem or a form that is open.
//
// Every control ends on the same right edge. Text and icon buttons that come last are pulled out by
// their own padding, so their text lines up with a switch or a field and only their hover fill reaches
// into the row's padding. Controls shown only on hover sit to the left of what always shows, so nothing
// moves or leaves a gap when they appear.

import { useEffect, useRef, useState } from "react"
import type { SecretName, SettingsCheck } from "@owlit/protocol"
import { CheckIcon, ChevronsUpDownIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { BorderedList } from "@/components/bordered-list"
import { ChoiceMenu } from "@/components/choice-menu"
import { GroupLabel as SharedGroupLabel } from "@/components/group-label"
import { IconButton } from "@/components/icon-button"
import { Info } from "@/components/info"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tip } from "@/components/tip"
import { useFoldWhile, useCheck } from "./form-state"
import { setSecret, useSettings } from "./store"

export const List = BorderedList

// A second group in a section; its rows start at the list's edge, so the label does too
export function GroupLabel({ info, children }: { info?: string; children: React.ReactNode }) {
  return (
    <SharedGroupLabel as="div" flush info={info} className="mt-6">
      {children}
    </SharedGroupLabel>
  )
}

export function Row({
  name,
  info,
  control,
  children,
  className,
}: {
  name: React.ReactNode
  // The explanation, behind an info icon
  info?: string
  // What sits at the right of the row
  control?: React.ReactNode
  // A second line: a problem, or an open form
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("group/row flex min-h-12 flex-col justify-center px-3.5 py-2.5", className)}>
      <div className="flex min-h-7 items-center gap-3">
        <span className="flex shrink-0 items-center gap-1">
          {name}
          {info && <Info>{info}</Info>}
        </span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1">{control}</div>
      </div>
      {children}
    </div>
  )
}

// A second line under a row. Red only for something broken.
export function Note({ tone = "muted", children }: { tone?: "muted" | "bad"; children: React.ReactNode }) {
  return <div className={cn("mt-1 text-detail leading-5", tone === "bad" ? "text-destructive" : "text-muted-foreground")}>{children}</div>
}

// An action in a row: a small icon button whose label lives in a tooltip. All are one width, so the
// status text before them lines up from row to row.
export function IconAction({ label, onClick, disabled, className, children }: { label: string; onClick: () => void; disabled?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <IconButton label={label} className={cn("last:-mr-1.5", className)} onClick={onClick} disabled={disabled}>
      {children}
    </IconButton>
  )
}

// For controls shown only on hover or focus; they go before the ones that always show
export const onHover = "opacity-0 group-hover/row:opacity-100 focus-key:opacity-100"

// A row's choice: the shared text menu with the value in body tone and up-down chevrons, pulled out by its
// padding when it comes last
export function Picker<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  return <ChoiceMenu {...props} icon={<ChevronsUpDownIcon className="text-muted-foreground" />} className="h-7 gap-1 px-2 text-foreground last:-mr-2" />
}

// A text field that keeps its value when it loses focus or on Enter; Esc puts the saved value back.
// There is no Save button anywhere in Settings.
export function CommitInput({
  value,
  onCommit,
  validate,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string
  onCommit: (value: string) => void
  // A sentence when the text can't be kept
  validate?: (value: string) => string | null
}) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value])

  const commit = () => {
    editing.current = false
    const text = draft.trim()
    const problem = text ? (validate?.(text) ?? null) : null
    setError(problem)
    if (problem || text === value) return
    onCommit(text)
  }
  return (
    <div className="flex flex-col items-end">
      <Input
        {...props}
        value={draft}
        aria-invalid={!!error || undefined}
        className={cn("h-8 w-64 text-detail", className)}
        onChange={(e) => {
          editing.current = true
          setDraft(e.target.value)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
        }}
      />
      <ErrorLine error={error} />
    </div>
  )
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  return <div className="mt-1 w-64 text-detail leading-5 text-destructive">{error}</div>
}

type Check = { checking: boolean; result?: SettingsCheck }

// The check, beside the value it is about: a spinner while owlit asks, then a check mark if the service
// took it. It sits in the control's slot, so the row never changes height for it. accepted is what the
// mark says, for a value that isn't a key.
export function CheckMark({ checking, result, service, accepted = `${service} accepted it` }: Check & { service: string; accepted?: string }) {
  let mark: React.ReactNode = null
  let label = ""
  if (checking) {
    mark = <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
    label = `Checking with ${service}…`
  } else if (result?.result === "works") {
    mark = <CheckIcon className="size-3.5 text-success animate-in fade-in zoom-in-75" />
    label = accepted
  }
  return (
    <>
      {mark && (
        <Tip label={label}>
          <span className="inline-grid size-6 shrink-0 place-items-center">{mark}</span>
        </Tip>
      )}
      <span role="status" className="sr-only">
        {label}
      </span>
    </>
  )
}

// What the service had to say, under the row: red for a refusal, muted for anything else
export function CheckNote({ checking, result }: Check) {
  if (checking || !result?.message) return null
  return <Note tone={result.result === "rejected" ? "bad" : "muted"}>{result.message}</Note>
}

// A key: "Not set" with Add, or its last four characters with Change and Remove. The actions are icons
// of one width, so the status before them lines up from row to row. Adding or changing opens a field in
// the row; Enter keeps it, and owlit tries it once.
export function SecretRow({ name, label, info, getFrom, service }: { name: SecretName; label: string; info: string; getFrom?: { label: string; href: string }; service: string }) {
  const last4 = useSettings((s) => s.view?.secrets[name])
  const [editing, setEditing] = useState(false)
  const check = useCheck()
  const fold = () => setEditing(false)
  useFoldWhile(editing, fold)

  const save = async (value: string) => {
    fold()
    check.reset()
    await setSecret(name, value)
    void check.run(name)
  }

  let control: React.ReactNode
  if (editing) {
    control = <KeyInput onSave={(value) => void save(value)} onCancel={fold} />
  } else if (last4) {
    control = (
      <MaskedKey
        last4={last4}
        onChange={() => setEditing(true)}
        onRemove={() => {
          check.reset()
          void setSecret(name, null)
        }}
      >
        <CheckMark {...check} service={service} />
      </MaskedKey>
    )
  } else {
    control = (
      <>
        <span className="text-detail text-muted-foreground">Not set</span>
        <IconAction label="Add key" onClick={() => setEditing(true)}>
          <PlusIcon />
        </IconAction>
      </>
    )
  }

  return (
    <Row name={label} info={info} control={control}>
      {editing && getFrom && (
        <Note>
          Get one at{" "}
          <a href={getFrom.href} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-4 hover:decoration-foreground">
            {getFrom.label}
          </a>
          . Press Enter to keep it.
        </Note>
      )}
      {!editing && <CheckNote {...check} />}
    </Row>
  )
}

// A key being added or changed, in place of the row's value: Enter keeps it, Cancel (or Esc) folds it
// and forgets what was typed
export function KeyInput({ onSave, onCancel }: { onSave: (value: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState("")
  return (
    <>
      <Input
        autoFocus
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="Paste the key"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) onSave(draft.trim())
        }}
        className="h-8 w-56 font-mono text-detail"
      />
      <IconAction label="Cancel" onClick={onCancel}>
        <XIcon />
      </IconAction>
    </>
  )
}

// A key that is set, by its last four characters, with Change; Remove shows on hover. children sit
// between the two (a check mark).
export function MaskedKey({ last4, onChange, onRemove, children }: { last4?: string; onChange: () => void; onRemove: () => void; children?: React.ReactNode }) {
  return (
    <>
      <IconAction label="Remove key" className={onHover} onClick={onRemove}>
        <Trash2Icon />
      </IconAction>
      {children}
      <span className="font-mono text-detail text-muted-foreground" aria-label={last4 ? `Key ending in ${last4}` : "Key set"}>
        ••••{last4}
      </span>
      <IconAction label="Change key" onClick={onChange}>
        <PencilIcon />
      </IconAction>
    </>
  )
}

// A form under a list, folded behind a quiet "Add …" button until asked for ("Add an agent", "Add a
// sign-in"); the button's label is the form's title once open
export function FoldedForm({
  label,
  open,
  onOpen,
  onCancel,
  onSubmit,
  aside,
  submit,
  submitDisabled,
  children,
}: {
  label: string
  open: boolean
  onOpen: () => void
  onCancel: () => void
  onSubmit: () => void
  // At the right of the title
  aside?: React.ReactNode
  // What the submit button says
  submit: React.ReactNode
  submitDisabled?: boolean
  children: React.ReactNode
}) {
  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="mt-2 -ml-2 font-normal text-muted-foreground" onClick={onOpen}>
        <PlusIcon />
        {label}
      </Button>
    )
  }
  const title = <div className="text-sm font-medium">{label}</div>
  return (
    <form
      className="mt-3 flex flex-col gap-3.5 rounded-lg border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      {aside ? (
        <div className="flex items-center justify-between gap-3">
          {title}
          {aside}
        </div>
      ) : (
        title
      )}
      {children}
      <div className="flex justify-end gap-2 pt-0.5">
        <Button type="button" variant="ghost" className="text-muted-foreground" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitDisabled}>
          {submit}
        </Button>
      </div>
    </form>
  )
}
