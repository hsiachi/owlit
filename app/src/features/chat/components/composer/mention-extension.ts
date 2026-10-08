import Mention from "@tiptap/extension-mention"
import { ReactNodeViewRenderer, ReactRenderer } from "@tiptap/react"
import type { Editor } from "@tiptap/core"
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion"
import type { Mentionable, SourceKind } from "../../types"
import { searchMentionables } from "../../mocks/sources"
import { MentionChip } from "./MentionChip"
import { MentionList, type MentionListHandle } from "./MentionList"

export interface MentionAttrs {
  id: string
  label: string
  kind: SourceKind
}

// Lets the "+" menu open the popup pre-filtered to one source
export const mentionFilter: { next: SourceKind | "all" } = { next: "all" }

// True while the popup is mounted, so the composer's Enter shortcut can yield to it
export const mentionPopup = { open: false }

export const WorkspaceMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: {
        default: "paper",
        parseHTML: (el) => el.getAttribute("data-kind"),
        renderHTML: (attrs) => ({ "data-kind": attrs.kind }),
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(MentionChip, { as: "span", className: "inline" })
  },
}).configure({
  deleteTriggerWithBackspace: true,
  renderText: ({ node }) => `@[${node.attrs.label ?? node.attrs.id}]`,
  suggestion: {
    char: "@",
    allowSpaces: false,
    items: ({ query }: { query: string }) => searchMentionables(query),
    render: () => {
      let component: ReactRenderer<MentionListHandle, SuggestionProps<Mentionable, MentionAttrs>> | null = null
      let unmount: (() => void) | undefined

      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionList, {
            props: { ...props, initialFilter: mentionFilter.next },
            editor: props.editor as Editor,
          })
          mentionFilter.next = "all"
          unmount = props.mount(component.element)
          mentionPopup.open = true
        },
        onUpdate: (props) => component?.updateProps(props),
        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (props.event.key === "Escape") {
            unmount?.()
            unmount = undefined
            mentionPopup.open = false
            return true
          }
          return component?.ref?.onKeyDown(props) ?? false
        },
        onExit: () => {
          mentionPopup.open = false
          unmount?.()
          unmount = undefined
          component?.destroy()
          component = null
        },
      }
    },
  },
})
