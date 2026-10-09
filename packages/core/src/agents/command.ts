import { execFile } from "node:child_process"
import { access, constants } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

// A command line as the user writes it: words split on spaces, with "double" or 'single' quotes
// keeping spaces inside a word. No variables, globs or pipes: it is run directly, not by a shell.
export function splitCommand(line: string): string[] {
  const words: string[] = []
  let word = ""
  let quote: string | null = null
  let started = false
  for (const ch of line.trim()) {
    if (quote) {
      if (ch === quote) quote = null
      else word += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      started = true
    } else if (/\s/.test(ch)) {
      if (started || word) words.push(word)
      word = ""
      started = false
    } else word += ch
  }
  if (started || word) words.push(word)
  return words
}

// An app opened from the Finder gets a bare PATH (/usr/bin:/bin:…), without what the user's shell adds
// (~/.local/bin, Homebrew, nvm, …). The login shell is asked once for its PATH; if that fails, common
// places are added to what the process has.
let shellPath: Promise<string> | undefined

export function userPath(): Promise<string> {
  shellPath ??= new Promise((resolve) => {
    const fallback = [process.env.PATH, path.join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(":")
    const shell = process.env.SHELL || "/bin/zsh"
    const marker = "__OWLIT_PATH__"
    execFile(shell, ["-ilc", `printf '${marker}%s${marker}' "$PATH"`], { timeout: 5000, env: { ...process.env } }, (error, stdout) => {
      const found = !error && new RegExp(`${marker}(.*)${marker}`).exec(stdout)?.[1]
      resolve(found ? [found, fallback].join(":") : fallback)
    })
  })
  return shellPath
}

// The executable a command's first word names: itself when it is a path, else the first match on PATH
export async function resolveExecutable(name: string, searchPath: string): Promise<string | null> {
  const isFile = (file: string) =>
    access(file, constants.X_OK).then(
      () => true,
      () => false,
    )
  if (name.includes("/")) return (await isFile(path.resolve(name.replace(/^~(?=\/)/, homedir())))) ? path.resolve(name.replace(/^~(?=\/)/, homedir())) : null
  for (const dir of searchPath.split(":")) {
    if (dir && (await isFile(path.join(dir, name)))) return path.join(dir, name)
  }
  return null
}
