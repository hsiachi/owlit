import { plural, t } from "@lingui/core/macro"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import type { ClaudeNote, MemoryKind, MemoryLine } from "@owlit/protocol"
import { DialogHeading } from "@/components/info"
import { revealOnHover } from "@/components/row-list"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { shortDate } from "@/lib/time"
import { toastError } from "@/lib/toast"
import { useFold, useFoldWhile } from "../form-state"
import { decideClaudeNote, loadMemory, manageMemory, putLine, removeLine, useMemory } from "../memory"
import { List, Row } from "../parts"
import { closeSettings } from "../store"

// What Owlit keeps in mind about you (.owlit/memory.md). It can grow long, so Settings › Owlit holds one row
// for it, under your name, with how many lines it has and Manage…, as Claude's own memory setting does; the
// list opens in a dialog above Settings. Not named "Remember…": the Privacy row below is "Remember what I
// do in owlit", the activity journal, and the two must not read as one thing.
export function KeptInMindRow() {
  const lines = useMemory((s) => s.lines)
  const claudeNotes = useMemory((s) => s.claudeNotes)
  const loaded = useMemory((s) => s.loaded)
  useEffect(() => {
    void loadMemory().catch(toastError)
  }, [])
  const count = lines.length ? plural(lines.length, { one: "# line", other: "# lines" }) : t({ message: "Nothing yet", comment: "Owlit keeps nothing in mind about the user yet" })
  const fromClaude = claudeNotes.length ? plural(claudeNotes.length, { one: "# from Claude Code to look at", other: "# from Claude Code to look at" }) : null
  return (
    <div data-settings-group="memory" className="scroll-mt-1">
      <Row
        name={t`What Owlit keeps in mind`}
        info={t`Every chat in this workspace starts with this list, whichever agent runs it, the ones owlit starts for you too. Owlit adds to it when you tell it something worth keeping, and says so in the chat. It is kept in .owlit/memory.md in this folder; you can edit that file too.`}
        control={
          <>
            {loaded && <span className="mr-1.5 text-detail text-muted-foreground">{fromClaude ? `${count} · ${fromClaude}` : count}</span>}
            <Button variant="text" size="inline" className="-mr-1.5" onClick={() => manageMemory(true)}>
              {t({ message: "Manage…", comment: "open the list of what Owlit keeps in mind" })}
            </Button>
          </>
        }
      />
      <MemoryDialog />
    </div>
  )
}

// The list: one row per line, in two small groups for the two kinds, newest last as the file has them. A
// row is the line in your words; on hover it offers the chat it came from, Edit and Remove. Edit turns the
// row into a field in place (Enter or leaving it keeps it, Esc puts it back); Remove strikes the row
// through with Undo for as long as the dialog is open.
function MemoryDialog() {
  const open = useMemory((s) => s.managing)
  const lines = useMemory((s) => s.lines)
  const claudeNotes = useMemory((s) => s.claudeNotes)
  // Lines removed here, kept to put back while the dialog is open
  const [gone, setGone] = useState<MemoryLine[]>([])
  const [adding, setAdding] = useState<MemoryKind | null>(null)
  const close = () => {
    manageMemory(false)
    setGone([])
    setAdding(null)
  }
  const remove = (line: MemoryLine) => {
    setGone((g) => [...g, line])
    void removeLine(line.id).catch(toastError)
  }
  const putBack = (line: MemoryLine) => {
    setGone((g) => g.filter((l) => l.id !== line.id))
    void putLine(line).catch(toastError)
  }
  const empty = !lines.length && !gone.length
  const kinds: { kind: MemoryKind; label: string }[] = [
    { kind: "work", label: t({ message: "How you like Owlit to work", comment: "a group of lines Owlit keeps in mind: the user's preferences" }) },
    { kind: "about", label: t({ message: "About your work", comment: "a group of lines Owlit keeps in mind: facts about the user's work" }) },
  ]
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="sm:max-w-xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Esc folds a line being written before it closes the dialog
        onEscapeKeyDown={(e) => {
          const { fold } = useFold.getState()
          if (fold) {
            e.preventDefault()
            fold()
          }
        }}
      >
        <DialogHeading
          title={t`What Owlit keeps in mind`}
          about={t`Every chat in this workspace starts with this list, whichever agent runs it. Kept in .owlit/memory.md in this folder.`}
        />
        <div className="-mx-6 max-h-[60vh] overflow-y-auto px-6">
          {claudeNotes.length > 0 && <ClaudeNotes notes={claudeNotes} />}
          {kinds.map(({ kind, label }) => {
            const mine = [...lines.filter((l) => l.kind === kind), ...gone.filter((l) => l.kind === kind)]
            return (
              <div key={kind} className="not-first:mt-4">
                <div className="flex h-7 items-center text-detail text-muted-foreground">
                  {label}
                  <Button variant="text" size="inline" className="ml-auto -mr-1.5" onClick={() => setAdding(kind)}>
                    {t({ message: "Add one", comment: "add a line Owlit keeps in mind" })}
                  </Button>
                </div>
                {(mine.length > 0 || adding === kind) && (
                  <List>
                    {mine.map((line) =>
                      gone.some((g) => g.id === line.id) ? <GoneRow key={line.id} line={line} onUndo={() => putBack(line)} /> : <LineRow key={line.id} line={line} onRemove={() => remove(line)} />,
                    )}
                    {adding === kind && (
                      <Row
                        name={
                          <LineField
                            value=""
                            placeholder={kind === "work" ? t`e.g. Answer in Chinese` : t`e.g. I'm writing my thesis on proactive agents`}
                            onDone={(text) => {
                              setAdding(null)
                              if (text) void putLine({ kind, text }).catch(toastError)
                            }}
                          />
                        }
                      />
                    )}
                  </List>
                )}
              </div>
            )
          })}
          {empty && <p className="mt-3 text-detail leading-5 text-muted-foreground">{t`Nothing yet. Tell Owlit something to keep in any chat (“from now on, cite in APA”), or add a line here.`}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LineRow({ line, onRemove }: { line: MemoryLine; onRemove: () => void }) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <Row
        name={
          <LineField
            value={line.text}
            onDone={(text) => {
              setEditing(false)
              if (text && text !== line.text) void putLine({ ...line, text }).catch(toastError)
            }}
          />
        }
      />
    )
  }
  return (
    <Row
      name={<span className="text-sm text-pretty">{line.text}</span>}
      control={
        <>
          {line.chatId && (
            <Button
              variant="text"
              size="inline"
              className={revealOnHover}
              onClick={() => {
                manageMemory(false)
                closeSettings()
                navigate(`/chat/${line.chatId}`)
              }}
            >
              {t({ message: "Chat", comment: "open the chat a line Owlit keeps in mind came from" })}
            </Button>
          )}
          <Button variant="text" size="inline" className={revealOnHover} onClick={() => setEditing(true)}>
            {t({ message: "Edit", comment: "verb: change a line Owlit keeps in mind" })}
          </Button>
          <Button variant="text" size="inline" className={revealOnHover} onClick={onRemove}>
            {t({ message: "Remove", comment: "verb: take a line out of what Owlit keeps in mind" })}
          </Button>
          {line.at > 0 && <span className="ml-1.5 text-detail text-muted-foreground tabular-nums">{shortDate(line.at)}</span>}
        </>
      }
    />
  )
}

function GoneRow({ line, onUndo }: { line: MemoryLine; onUndo: () => void }) {
  return (
    <Row
      name={
        <span className="text-sm text-pretty text-muted-foreground line-through decoration-1">
          {line.text}
        </span>
      }
      control={
        <Button variant="text" size="inline" className="-mr-1.5" onClick={onUndo}>
          {t({ message: "Undo", comment: "verb: put back a line just removed from what Owlit keeps in mind" })}
        </Button>
      }
    />
  )
}

// A line being written or edited, in the row's place. Enter or leaving keeps it; Esc puts it back.
function LineField({ value, placeholder, onDone }: { value: string; placeholder?: string; onDone: (text: string | null) => void }) {
  const [draft, setDraft] = useState(value)
  const [done, setDone] = useState(false)
  const finish = (text: string | null) => {
    if (done) return
    setDone(true)
    onDone(text)
  }
  // Esc folds the field before it closes the dialog
  useFoldWhile(!done, () => finish(null))
  return (
    <Input
      autoFocus
      value={draft}
      placeholder={placeholder}
      maxLength={300}
      aria-label={t`A line Owlit keeps in mind`}
      className="h-8 w-full text-sm"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(draft.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(draft.trim() || null)
        if (e.key === "Escape") finish(null)
      }}
    />
  )
}

// What Claude Code kept for this folder before owlit had a memory of its own (its memory is off in owlit
// now). Offered once: each note is kept as a line or dropped, and either way isn't offered again.
function ClaudeNotes({ notes }: { notes: ClaudeNote[] }) {
  const decide = (note: ClaudeNote, keep: boolean) => void decideClaudeNote(note, keep).catch(toastError)
  return (
    <div className="mb-4">
      <div className="flex min-h-7 items-center text-detail text-muted-foreground">{t`Claude Code kept these about you in this folder. Keep the ones Owlit should keep in mind.`}</div>
      <List>
        {notes.map((note) => (
          <Row
            key={note.file}
            name={<span className="text-sm text-pretty">{note.text}</span>}
            control={
              <>
                <Button variant="text" size="inline" onClick={() => decide(note, false)}>
                  {t({ message: "Drop", comment: "verb: don't keep a note Claude Code had kept" })}
                </Button>
                <Button variant="text" size="inline" className="-mr-1.5" onClick={() => decide(note, true)}>
                  {t({ message: "Keep", comment: "verb: keep a note Claude Code had kept as a line Owlit keeps in mind" })}
                </Button>
              </>
            }
          />
        ))}
      </List>
    </div>
  )
}
