import { useMemo, useState } from "react"
import { CheckIcon, PlusIcon, XIcon } from "lucide-react"
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
import { collectTags, useLibraryStore } from "../store"

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
  const allTags = useMemo(() => collectTags(papers), [papers])
  const q = query.trim().toLowerCase().replace(/\s+/g, "-")
  const canCreate = q.length > 0 && !allTags.includes(q)

  const pick = (tag: string) => {
    onPick(tag)
    setQuery("")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-56 p-0">
        <Command>
          <CommandInput placeholder="Find or create a tag" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No tags yet.</CommandEmpty>
            {canCreate && (
              <CommandGroup>
                <CommandItem value={`create-${q}`} onSelect={() => pick(q)}>
                  <PlusIcon />
                  Create “{q}”
                </CommandItem>
              </CommandGroup>
            )}
            {allTags.length > 0 && (
              <CommandGroup heading="Tags">
                {allTags.map((tag) => (
                  <CommandItem key={tag} value={tag} onSelect={() => pick(tag)}>
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

// The tag list on one paper: chips with remove, plus an add button
export function TagsEditor({
  tags,
  onChange,
  className,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  className?: string
}) {
  const toggle = (tag: string) =>
    onChange(tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag])

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {tags.map((tag) => (
        <span key={tag} className="group/tag inline-flex h-6 items-center gap-0.5 rounded-md bg-muted pr-1 pl-2 text-xs text-foreground/80">
          {tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            onClick={() => toggle(tag)}
            className="rounded-sm p-0.5 text-muted-foreground opacity-60 hover:bg-foreground/10 hover:text-foreground group-hover/tag:opacity-100"
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <TagPicker selected={tags} onPick={toggle}>
        <Button variant="ghost" size="xs" className="font-normal text-muted-foreground">
          <PlusIcon />
          {tags.length === 0 ? "Add tag" : null}
        </Button>
      </TagPicker>
    </div>
  )
}
