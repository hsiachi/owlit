import { useEffect, useRef, useState, type RefObject } from "react"
import { CARD_CLOSE_DELAY, CARD_OPEN_DELAY, citationCardSurface, citationOf, type Citation } from "@/components/citation"
import { CitationCard } from "@/components/citation-card"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"

const CITATION = '.cm-mention[data-uri^="owlit://library/"]'

// The citation card over a doc's paper mentions. CodeMirror draws them as plain DOM, so the card is one
// popover for the whole editor, anchored to the mention the pointer rests on, with the same delays as
// the hover card elsewhere, or at once when one gets the keyboard's focus. It never takes focus itself.
// onOpen: the card's passage was clicked, for the citation at el
export function DocCitationHover({ host, onOpen }: { host: RefObject<HTMLElement | null>; onOpen: (el: HTMLElement, citation: Citation) => void }) {
  const [shown, setShown] = useState<{ el: HTMLElement; citation: Citation } | null>(null)
  const anchor = useRef<HTMLElement | null>(null)
  const timers = useRef<{ open?: ReturnType<typeof setTimeout>; close?: ReturnType<typeof setTimeout> }>({})
  const clear = () => {
    clearTimeout(timers.current.open)
    clearTimeout(timers.current.close)
  }
  const closeSoon = () => {
    clearTimeout(timers.current.open)
    clearTimeout(timers.current.close)
    timers.current.close = setTimeout(() => setShown(null), CARD_CLOSE_DELAY)
  }

  useEffect(() => {
    const el = host.current
    if (!el) return
    const over = (e: PointerEvent) => {
      const mention = (e.target as HTMLElement).closest<HTMLElement>(CITATION)
      if (!mention) return
      clear()
      if (anchor.current === mention) return
      timers.current.open = setTimeout(() => {
        const citation = citationOf(mention.dataset.uri!, mention.dataset.quote)
        if (!citation || !mention.isConnected) return
        anchor.current = mention
        setShown({ el: mention, citation })
      }, CARD_OPEN_DELAY)
    }
    const out = (e: PointerEvent) => {
      const mention = (e.target as HTMLElement).closest<HTMLElement>(CITATION)
      if (!mention || mention.contains(e.relatedTarget as Node | null)) return
      closeSoon()
    }
    // A click goes to the paper: the card has nothing more to say
    const down = () => {
      clear()
      setShown(null)
    }
    // A citation reached by keyboard shows its card at once, and leaving it puts the card away
    const focus = (e: FocusEvent) => {
      const mention = (e.target as HTMLElement).closest<HTMLElement>(CITATION)
      if (!mention) return
      const citation = citationOf(mention.dataset.uri!, mention.dataset.quote)
      if (!citation) return
      clear()
      anchor.current = mention
      setShown({ el: mention, citation })
    }
    const blur = (e: FocusEvent) => {
      if ((e.target as HTMLElement).closest(CITATION)) closeSoon()
    }
    el.addEventListener("pointerover", over)
    el.addEventListener("pointerout", out)
    el.addEventListener("mousedown", down)
    el.addEventListener("focusin", focus)
    el.addEventListener("focusout", blur)
    return () => {
      el.removeEventListener("pointerover", over)
      el.removeEventListener("pointerout", out)
      el.removeEventListener("mousedown", down)
      el.removeEventListener("focusin", focus)
      el.removeEventListener("focusout", blur)
      clear()
    }
  }, [host])

  useEffect(() => {
    if (!shown) anchor.current = null
  }, [shown])

  return (
    <Popover open={!!shown} onOpenChange={(open) => !open && setShown(null)}>
      <PopoverAnchor virtualRef={anchor as RefObject<HTMLElement>} />
      {shown && (
        <PopoverContent
          align="start"
          className={citationCardSurface}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onPointerEnter={clear}
          onPointerLeave={closeSoon}
        >
          <CitationCard
            citation={shown.citation}
            onOpen={(citation) => {
              setShown(null)
              onOpen(shown.el, citation)
            }}
          />
        </PopoverContent>
      )}
    </Popover>
  )
}
