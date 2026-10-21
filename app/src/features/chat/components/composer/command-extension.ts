import { Extension, type Editor } from "@tiptap/core"
import { PluginKey } from "@tiptap/pm/state"
import { ReactRenderer } from "@tiptap/react"
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion"
import type { CommandName } from "@owlit/protocol"
import { commandsFor } from "../../lib/commands"
import { CommandList, type CommandListHandle, type CommandListProps } from "./CommandList"
import { mentionPopup } from "./mention-extension"

// "/" at the very start of a message offers the commands (core's recipes a person starts by name). Picking
// one puts "/<name> " in as text, the way it is sent and the way it may be typed by hand, and tells the
// composer (onPick), which sets the chat's role for it. Only at the start: core reads a command only there.
export const SlashCommands = Extension.create<{ onPick: (name: CommandName) => void }>({
  name: "slashCommands",
  addOptions: () => ({ onPick: () => {} }),
  addProseMirrorPlugins() {
    const onPick = (name: CommandName) => this.options.onPick(name)
    return [
      Suggestion<CommandName, CommandName>({
        editor: this.editor,
        pluginKey: new PluginKey("slashCommands"),
        char: "/",
        findSuggestionMatch: ({ $position }) => {
          // The first line of the message, up to the cursor
          if ($position.depth !== 1 || $position.index(0) !== 0) return null
          const before = $position.parent.textBetween(0, $position.parentOffset, undefined, "￼")
          const m = /^\/([a-z-]*)$/.exec(before)
          if (!m) return null
          const from = $position.start()
          return { range: { from, to: $position.pos }, query: m[1]!, text: m[0] }
        },
        items: ({ query }) => commandsFor(query),
        command: ({ editor, range, props: name }) => {
          editor.chain().focus().insertContentAt(range, `/${name} `).run()
          onPick(name)
        },
        render: () => {
          let component: ReactRenderer<CommandListHandle, CommandListProps> | null = null
          let unmount: (() => void) | undefined
          const close = () => {
            mentionPopup.open = false
            unmount?.()
            unmount = undefined
          }
          return {
            onStart: (props: SuggestionProps<CommandName, CommandName>) => {
              component = new ReactRenderer(CommandList, { props: { items: props.items, command: props.command }, editor: props.editor as Editor })
              unmount = props.mount(component.element)
              // The composer's Enter yields to the popup while it is open, as it does to "@"
              mentionPopup.open = true
            },
            onUpdate: (props: SuggestionProps<CommandName, CommandName>) => component?.updateProps({ items: props.items, command: props.command }),
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === "Escape") {
                close()
                return true
              }
              return component?.ref?.onKeyDown(props) ?? false
            },
            onExit: () => {
              close()
              component?.destroy()
              component = null
            },
          }
        },
      }),
    ]
  },
})
