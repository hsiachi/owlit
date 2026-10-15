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

const SHELL_WAIT_MS = 10_000
// After a miss, the shell isn't asked again for this long, so a shell that keeps hanging costs one wait
// now and then rather than one per agent started
const RETRY_AFTER_MS = 30_000

// An app opened from the Finder gets a bare PATH (/usr/bin:/bin:…), without what the user's shell adds
// (~/.local/bin, Homebrew, nvm, …). The login shell is asked for its PATH; if that fails, common places
// are added to what the process has. Only the shell's answer is kept: a fallback is used for that call
// alone, since the shell can miss once (it timed out when macOS reopened Owlit at login, and the fallback,
// without nvm, then hid Claude Code's adapter until Owlit was quit) and answer fine a moment later.
export const userPath = pathFinder(askShell)

export function pathFinder(ask: () => Promise<string | null>, retryAfterMs = RETRY_AFTER_MS, now = Date.now): () => Promise<string> {
  const fallback = () => [process.env.PATH, path.join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(":")
  // Callers while the shell is being asked share its answer
  let found: Promise<string> | undefined
  let missedAt = -Infinity
  return () => {
    if (found) return found
    if (now() - missedAt < retryAfterMs) return Promise.resolve(fallback())
    found = ask().then((shell) => {
      if (shell) return [shell, fallback()].join(":")
      missedAt = now()
      found = undefined
      return fallback()
    })
    return found
  }
}

function askShell(): Promise<string | null> {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || "/bin/zsh"
    const marker = "__OWLIT_PATH__"
    execFile(shell, ["-ilc", `printf '${marker}%s${marker}' "$PATH"`], { timeout: SHELL_WAIT_MS, env: { ...process.env } }, (error, stdout) => {
      resolve((!error && new RegExp(`${marker}(.*)${marker}`).exec(stdout)?.[1]) || null)
    })
  })
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
