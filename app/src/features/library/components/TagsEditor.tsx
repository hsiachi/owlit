import { t } from "@lingui/core/macro"
import { useMemo, useState } from "react"
import { CheckIcon, PlusIcon, XIcon } from "lucide-react"
import { toggle } from "@/lib/multi-select"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { normalizeTag, tagColorVar } from "../lib/tags"
import { collectTags, useLibraryStore } from "../store"

// A tag's colour: the one mark that tells tags apart at a glance
export function TagDot({ tag, className }: { tag: string; className?: string }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-full", className)} style={{ backgroundColor: tagColorVar(tag) }} />
}

// A tag on a translucent fill, used where a tag can be acted on (the peek, About): clicking it
// shows every paper with that tag; with onRemove it also carries a remove button on hover, whose
// hit area reaches 24px past the small glyph. Read-only places show just the dot and the name.
function TagChip({
  tag,
  onClick,
  onRemove,
  className,
}: {
  tag: string
  onClick?: () => void
  onRemove?: () => void
  className?: string
}) {
  return (
    <span className={cn("group/tag inline-flex h-6 items-center rounded-md bg-muted text-xs text-foreground", className)}>
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className={cn("flex h-full items-center gap-1.5 rounded-md pl-2 outline-none", onRemove ? "pr-1" : "pr-2", onClick && "hover:text-foreground focus-key:ring-2 focus-key:ring-ring/50")}
      >
        <TagDot tag={tag} className="size-1.5" />
        {tag}
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label={t`Remove tag ${tag}`}
          onClick={onRemove}
          className="relative mr-1 grid size-4 place-items-center rounded-sm text-muted-foreground after:absolute after:-inset-1 after:content-[''] opacity-0 group-hover/tag:opacity-100 hover:bg-foreground/10 hover:text-foreground focus-key:opacity-100"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </span>
  )
}

// A popover listing every tag in the library, with "Create" for a new one.
// `selected` tags show a check; picking one calls onPick either way.
export function TagPicker({
  selected = [],
  onPick,
  children,
  align = "start",
}: {
  selected?: string[]
  onPick: (tag: string) => void
  children: React.ReactNode
  align?: "start" | "end"
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const papers = useLibraryStore((s) => s.papers)
  const allTags = useMemo(() => collectTags(papers).map(([tag]) => tag), [papers])
  const q = normalizeTag(query)
  const canCreate = q.length > 0 && !allTags.includes(q)

  const pick = (tag: string) => {
    onPick(tag)
    setQuery("")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-60 p-0">
        <Command>
          <CommandInput placeholder={t`Find or create a tag`} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{t`No tags yet.`}</CommandEmpty>
            {canCreate && (
              <CommandGroup>
                <CommandItem value={`create-${q}`} onSelect={() => pick(q)}>
                  {t`Create “${q}”`}
                </CommandItem>
              </CommandGroup>
            )}
            {allTags.length > 0 && (
              <CommandGroup>
                {allTags.map((tag) => (
                  <CommandItem key={tag} value={tag} onSelect={() => pick(tag)}>
                    <TagDot tag={tag} />
                    <span className="flex-1 truncate">{tag}</span>
                    {selected.includes(tag) && <CheckIcon className="text-muted-foreground" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// The tags on one paper: chips that open the tag, remove on hover, and an add button
export function TagsEditor({
  tags,
  onChange,
  onOpenTag,
  className,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  onOpenTag?: (tag: string) => void
  className?: string
}) {
  const pick = (tag: string) => onChange(toggle(tags, tag))

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {tags.map((tag) => (
        <TagChip key={tag} tag={tag} onClick={onOpenTag && (() => onOpenTag(tag))} onRemove={() => pick(tag)} />
      ))}
      <TagPicker selected={tags} onPick={pick}>
        <Button variant="ghost" size="xs" className="font-normal text-muted-foreground">
          <PlusIcon />
          {t({ message: "Tag", comment: "button: add a tag to the paper" })}
        </Button>
      </TagPicker>
    </div>
  )
}
