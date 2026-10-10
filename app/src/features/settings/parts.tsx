// The pieces every Settings section is made of: one bordered list with dividers, one setting per row,
// the control at the right, and a second line only for a problem or a form that is open.
//
// Every control ends on the same right edge. Text and icon buttons that come last are pulled out by
// their own padding, so their text lines up with a switch or a field and only their hover fill reaches
// into the row's padding. Controls shown only on hover sit to the left of what always shows, so nothing
// moves or leaves a gap when they appear.

import { useEffect, useRef, useState } from "react"
import type { SecretName, SettingsCheck } from "@owlit/protocol"
import { CheckIcon, ChevronsUpDownIcon, InfoIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useFoldWhile, useCheck } from "./form-state"
import { setSecret, useSettings } from "./store"

export function List({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("divide-y rounded-lg border bg-card", className)}>{children}</div>
}

export function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 mb-1.5 px-0.5 text-xs text-muted-foreground">{children}</div>
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
          {info && <Info text={info} />}
        </span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1">{control}</div>
      </div>
      {children}
    </div>
  )
}

export function Info({ text, label = "About this" }: { text: string; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-grid size-5 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-key:ring-2 focus-key:ring-ring/50"
          aria-label={label}
        >
          <InfoIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

// A second line under a row. Red only for something broken.
export function Note({ tone = "muted", children }: { tone?: "muted" | "bad"; children: React.ReactNode }) {
  return <div className={cn("mt-1 text-[13px] leading-5", tone === "bad" ? "text-destructive" : "text-muted-foreground")}>{children}</div>
}

// An action in a row: a small icon button whose label lives in a tooltip. All are one width, so the
// status text before them lines up from row to row.
export function IconAction({ label, onClick, disabled, className, children }: { label: string; onClick: () => void; disabled?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={cn("text-muted-foreground last:-mr-1.5 hover:text-foreground", className)} onClick={onClick} disabled={disabled} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

// For controls shown only on hover or focus; they go before the ones that always show
export const onHover = "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"

// A plain-text trigger that opens a words-only menu; the chosen item carries the check on the right
export function Picker<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  const current = options.find((o) => o.value === value) ?? options[0]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label} className="h-7 gap-1 px-2 font-normal last:-mr-2 data-open:bg-muted">
          {current.label}
          <ChevronsUpDownIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => onChange(o.value)} className="gap-3">
            <span className="flex-1">{o.label}</span>
            {o.value === value && <CheckIcon className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
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
        className={cn("h-8 w-64 text-[13px]", className)}
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
  return <div className="mt-1 w-64 text-[13px] leading-5 text-destructive">{error}</div>
}

export function CheckLine({ checking, result, service }: { checking: boolean; result?: SettingsCheck; service: string }) {
  if (checking) {
    return (
      <Note>
        <span className="inline-flex items-center gap-1.5">
          <Spinner className="size-3" />
          Checking with {service}…
        </span>
      </Note>
    )
  }
  if (!result) return null
  if (result.result === "works" && !result.message) return <Note>Works</Note>
  return <Note tone={result.result === "rejected" ? "bad" : "muted"}>{result.message}</Note>
}

// A key: "Not set" with Add, or its last four characters with Change and Remove. The actions are icons
// of one width, so the status before them lines up from row to row. Adding or changing opens a field in
// the row; Enter keeps it, and owlit tries it once.
export function SecretRow({ name, label, info, getFrom, service }: { name: SecretName; label: string; info: string; getFrom?: { label: string; href: string }; service: string }) {
  const last4 = useSettings((s) => s.view?.secrets[name])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const check = useCheck()
  const fold = () => {
    setEditing(false)
    setDraft("")
  }
  useFoldWhile(editing, fold)

  const save = async () => {
    const value = draft.trim()
    if (!value) return
    fold()
    await setSecret(name, value)
    void check.run(name)
  }

  let control: React.ReactNode
  if (editing) {
    control = (
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
            if (e.key === "Enter") void save()
          }}
          className="h-8 w-56 font-mono text-[13px]"
        />
        <IconAction label="Cancel" onClick={fold}>
          <XIcon />
        </IconAction>
      </>
    )
  } else if (last4) {
    control = (
      <>
        <IconAction
          label="Remove key"
          className={onHover}
          onClick={() => {
            check.reset()
            void setSecret(name, null)
          }}
        >
          <Trash2Icon />
        </IconAction>
        <span className="font-mono text-[13px] text-muted-foreground" aria-label={`Key ending in ${last4}`}>
          ••••{last4}
        </span>
        <IconAction label="Change key" onClick={() => setEditing(true)}>
          <PencilIcon />
        </IconAction>
      </>
    )
  } else {
    control = (
      <>
        <span className="text-[13px] text-muted-foreground">Not set</span>
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
      {!editing && <CheckLine checking={check.checking} result={check.result} service={service} />}
    </Row>
  )
}
