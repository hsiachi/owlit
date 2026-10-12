import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Tabs as TabsPrimitive } from "radix-ui"

// Where each line list's underline last was, by its tabs' names: a list drawn anew on a page switch (the
// Library's) still slides from the tab the person left
const inkWas = new Map<string, { left: number; width: number }>()

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "relative gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const list = React.useRef<HTMLDivElement>(null)
  const ink = React.useRef<HTMLSpanElement>(null)
  const placed = React.useRef(false)
  // The underline of the line variant: one mark that travels to the active tab over --t-layout rather than
  // a mark on each tab that switches, so "you are here" moves and the eye follows (DESIGN.md › Motion). It
  // sits where each tab's own underline did: 2px, 1px below the list.
  React.useLayoutEffect(() => {
    const el = list.current
    const mark = ink.current
    if (variant !== "line" || !el || !mark) return
    const place = () => {
      const triggers = [...el.querySelectorAll<HTMLElement>('[data-slot="tabs-trigger"]')]
      const active = triggers.find((t) => t.dataset.state === "active")
      if (!active) {
        mark.style.width = "0px"
        return
      }
      const key = triggers.map((t) => t.textContent).join("|")
      const at = { left: active.offsetLeft, width: active.offsetWidth }
      if (!placed.current) {
        // The first placement is not a move: the ink starts where this list's ink last was, or in place
        const from = inkWas.get(key) ?? at
        mark.style.transition = "none"
        mark.style.left = `${from.left}px`
        mark.style.width = `${from.width}px`
        void mark.offsetWidth
        mark.style.transition = ""
        placed.current = true
      }
      mark.style.left = `${at.left}px`
      mark.style.width = `${at.width}px`
      inkWas.set(key, at)
    }
    place()
    // Radix marks the active trigger in the DOM; the list is measured again as it resizes
    const mo = new MutationObserver(place)
    mo.observe(el, { attributes: true, subtree: true, attributeFilter: ["data-state"] })
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => {
      mo.disconnect()
      ro.disconnect()
    }
  }, [variant])
  return (
    <TabsPrimitive.List
      ref={list}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      {children}
      {variant === "line" && (
        <span
          ref={ink}
          aria-hidden
          className="absolute -bottom-px h-0.5 w-0 bg-foreground transition-[left,width] duration-(--t-layout) ease-(--ease) motion-reduce:transition-none"
        />
      )}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-key:border-ring focus-key:ring-[3px] focus-key:ring-ring/50 focus-key:outline-1 focus-key:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
