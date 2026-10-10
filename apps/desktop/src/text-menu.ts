// The right-click menu for text: Electron draws none of its own, so without this a right-click in the
// editor, the composer or any field did nothing. The page's own menus (rows in a list) cancel the event
// in the page and never reach here. Built the way macOS builds it: spelling first, then Look Up, then
// the edit commands, with "Ask Owlit" on top when the page says the selection can go to Owlit.

import { clipboard, ipcMain, Menu, shell, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from "electron"

const isMac = process.platform === "darwin"

// What each page said about its last right-click: whether its selection can be handed to Owlit. The page
// tells this synchronously as the right-click happens, so it is here before the menu is asked for.
const askable = new WeakMap<WebContents, boolean>()

ipcMain.on("text-menu-ask", (event, ask: unknown) => {
  askable.set(event.sender, ask === true)
  event.returnValue = null
})

// "A long selected passage" → "A long selected pass…", as macOS shortens it in Look Up
const short = (text: string) => {
  const one = text.trim().replace(/\s+/g, " ")
  return one.length > 24 ? `${one.slice(0, 23)}…` : one
}

function items(win: BrowserWindow, params: ContextMenuParams, ask: boolean): MenuItemConstructorOptions[][] {
  const web = win.webContents
  const selected = params.selectionText.trim()
  const flags = params.editFlags
  const groups: MenuItemConstructorOptions[][] = []

  if (ask) groups.push([{ label: "Ask Owlit", click: () => web.send("text-menu-ask") }])

  if (params.misspelledWord) {
    const guesses = params.dictionarySuggestions.slice(0, 5)
    groups.push([
      ...(guesses.length
        ? guesses.map((word) => ({ label: word, click: () => web.replaceMisspelling(word) }))
        : [{ label: "No Guesses Found", enabled: false }]),
      { label: "Learn Spelling", click: () => web.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
    ])
  }

  if (selected && isMac) groups.push([{ label: `Look Up “${short(selected)}”`, click: () => web.showDefinitionForSelection() }])

  if (/^https?:\/\//.test(params.linkURL))
    groups.push([
      { label: "Open Link in Browser", click: () => void shell.openExternal(params.linkURL) },
      { label: "Copy Link", click: () => clipboard.writeText(params.linkURL) },
    ])

  if (params.isEditable)
    groups.push([
      { role: "cut", enabled: flags.canCut && !!selected },
      { role: "copy", enabled: flags.canCopy && !!selected },
      { role: "paste", enabled: flags.canPaste },
      { role: "selectAll", enabled: flags.canSelectAll },
    ])
  else if (selected) groups.push([{ role: "copy" }])

  return groups.filter((g) => g.length)
}

export function attachTextMenu(win: BrowserWindow) {
  win.webContents.on("context-menu", (_event, params) => {
    const ask = askable.get(win.webContents) ?? false
    askable.delete(win.webContents)
    const groups = items(win, params, ask)
    // Right-clicking plain page chrome offers nothing, as in any Mac app
    if (!groups.length) return
    const template = groups.flatMap((g, i) => (i ? [{ type: "separator" as const }, ...g] : g))
    Menu.buildFromTemplate(template).popup({ window: win })
  })
}
