// The owlit command: a thin client of the open workspace's socket, as owlit-mcp is, for scripts and for
// agents outside owlit. Every command asks the running app; there is no headless mode.

import { connect, OwlitError, OwlitNotRunning, type OwlitClient } from "@owlit/client"
import { isTaskFinished, type ImportSource, type Task } from "@owlit/protocol"
import { execFile, spawn } from "node:child_process"
import { stat } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"

export interface Io {
  cwd: string
  env: Record<string, string | undefined>
  out: (text: string) => void
  err: (text: string) => void
  // Asks the person at the terminal; missing when no one is there (a script, a pipe)
  ask?: (question: string) => Promise<string>
}

export const HELP = `owlit: the owlit app from Terminal. owlit has to be open with the workspace.

Usage: owlit <command> [options]

Commands:
  list                     Papers in the library, newest first
  add <ref…>               Add papers by DOI, arXiv id, link or title
  known <ref…>             Which of these the library already has
  read <id>                A paper's text: --pages 3-4, --section <heading>; or --digest, --note
  search <words…>          Search the library: titles, abstracts, full text
  tasks                    What owlit is working on, and what finished since it opened
  open                     Open the workspace in owlit
  mcp                      owlit's tools for an agent, over stdio (owlit-mcp):
                           claude mcp add owlit -- owlit mcp --workspace ~/Research
  import <kind> <path>     Bring in a library: zotero (zotero.sqlite, its folder, or a
                           Better BibTeX .json), bibtex (a .bib file) or folder (its PDFs).
                           --tags makes Zotero collections tags; --parse / --no-parse answers
                           ahead whether MinerU reads every PDF of a big import
  index rebuild            Read the workspace again for search

Options:
  --workspace <folder>     The workspace (default: the one the current folder is in)
  --json                   Print JSON
  -h, --help               This help
`

// Exit codes: 1 something failed, 2 the command was wrong, 3 owlit isn't open with the workspace
const FAILED = 1
const USAGE = 2
const NOT_RUNNING = 3

class Usage extends Error {}

export async function run(argv: string[], io: Io): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        workspace: { type: "string" },
        json: { type: "boolean" },
        pages: { type: "string" },
        section: { type: "string" },
        digest: { type: "boolean" },
        note: { type: "boolean" },
        tags: { type: "boolean" },
        parse: { type: "boolean" },
        "no-parse": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        // Where the socket is, when not in the temp folder (tests)
        "socket-dir": { type: "string" },
      },
    })
  } catch (error) {
    io.err(`${(error as Error).message}\nRun owlit --help for the commands.\n`)
    return USAGE
  }
  const { values: flags, positionals } = parsed
  const [command, ...args] = positionals
  if (flags.help || !command) {
    io.out(HELP)
    return flags.help ? 0 : USAGE
  }

  const print = (human: string, json: unknown) => io.out(flags.json ? JSON.stringify(json, null, 2) + "\n" : human ? human + "\n" : "")
  const workspace = await findWorkspace(flags.workspace ?? io.env.OWLIT_WORKSPACE, io.cwd)
  if (!workspace) {
    io.err("This folder isn't in an owlit workspace. Run owlit in one, or say which with --workspace <folder>.\n")
    return USAGE
  }

  if (command === "open") return open(workspace, io, flags["socket-dir"])
  if (command === "mcp") return mcp(workspace, argv, io)

  let owlit: OwlitClient
  try {
    owlit = await connect(workspace, { dir: flags["socket-dir"] })
  } catch (error) {
    if (!(error instanceof OwlitNotRunning)) throw error
    const hint = (await isFolder(workspace)) ? ' Run "owlit open" to open it.' : ""
    io.err(`${error.message.replace(/ Open it in owlit first\.$/, "")}${hint}\n`)
    return NOT_RUNNING
  }

  try {
    return await commands(command, args, owlit, { flags, print, io })
  } catch (error) {
    if (error instanceof Usage) {
      io.err(`${error.message}\nRun owlit --help for the commands.\n`)
      return USAGE
    }
    if (error instanceof OwlitError || error instanceof OwlitNotRunning) {
      io.err(`${error.message}\n`)
      return error instanceof OwlitNotRunning ? NOT_RUNNING : FAILED
    }
    throw error
  } finally {
    owlit.close()
  }
}

interface Context {
  flags: { json?: boolean; pages?: string; section?: string; digest?: boolean; note?: boolean; tags?: boolean; parse?: boolean; "no-parse"?: boolean }
  print: (human: string, json: unknown) => void
  io: Io
}

async function commands(command: string, args: string[], owlit: OwlitClient, { flags, print, io }: Context): Promise<number> {
  const need = (what: string) => {
    if (!args.length) throw new Usage(`owlit ${command} needs ${what}.`)
  }
  switch (command) {
    case "list": {
      const { papers } = await owlit.rpc.library.list()
      const sorted = [...papers].sort((a, b) => b.addedAt - a.addedAt)
      print(table(sorted.map((p) => [p.id, p.year ? String(p.year) : "", p.title])), sorted)
      return 0
    }

    case "add": {
      need("at least one ref: a DOI, arXiv id, link or title")
      const results: { ref: string; id?: string; title?: string; existed?: boolean; tasks?: string[]; error?: string }[] = []
      for (const ref of args) {
        try {
          const { paper, existingId } = await owlit.rpc.library.resolve({ input: ref })
          if (existingId) results.push({ ref, id: existingId, title: paper.title, existed: true })
          else {
            const added = await owlit.rpc.library.add({ paper })
            results.push({ ref, id: added.id, title: added.title, existed: false })
          }
        } catch (error) {
          if (!(error instanceof OwlitError)) throw error
          results.push({ ref, error: error.message })
        }
      }
      // The work an addition queued (metadata, PDF, text), so a script can follow it with owlit tasks
      const tasks = await owlit.rpc.tasks.list()
      for (const r of results) if (r.existed === false) r.tasks = tasks.filter((t) => t.subject === r.id).map((t) => t.id)
      const lines = results.map((r) =>
        r.error ? `Couldn't add ${r.ref}: ${r.error}` : r.existed ? `Already in the library: ${r.id} · ${r.title}` : `Added ${r.id} · ${r.title}`,
      )
      if (results.some((r) => r.existed === false)) lines.push("The PDF and text arrive by themselves; owlit tasks shows how far they are.")
      print(lines.join("\n"), results)
      return results.some((r) => r.error) ? FAILED : 0
    }

    case "known": {
      need("at least one ref")
      const ids = await owlit.rpc.library.known({ inputs: args })
      print(table(args.map((ref, i) => [ref, ids[i] ?? "-"])), args.map((ref, i) => ({ ref, id: ids[i] })))
      return 0
    }

    case "read": {
      need("a paper's id (owlit list shows them)")
      if (args.length > 1) throw new Usage("owlit read takes one id.")
      const part = flags.digest ? "digest" : flags.note ? "note" : "text"
      if (part !== "text" && (flags.pages || flags.section)) throw new Usage("--pages and --section are for the text, not the digest or note.")
      const read = await owlit.rpc.library.read({ id: args[0], part, ...(flags.pages ? { pages: flags.pages } : {}), ...(flags.section ? { section: flags.section } : {}) })
      if (!flags.json && !read.text.trim()) {
        io.err(part === "digest" ? "This paper has no digest yet.\n" : part === "note" ? "There is no note on this paper.\n" : "owlit hasn't read this paper's text yet.\n")
        return FAILED
      }
      print(read.text.replace(/\n+$/, ""), { id: args[0], part, ...read })
      return 0
    }

    case "search": {
      need("words to look for")
      const hits = await owlit.rpc.search.papers({ q: args.join(" ") })
      print(hits.map((h) => `${h.key} · ${h.title}${h.snippet ? `\n    ${h.snippet.replace(/\s+/g, " ").trim()}` : ""}`).join("\n"), hits)
      return 0
    }

    case "tasks": {
      const tasks = await owlit.rpc.tasks.list()
      print(table(tasks.map((t) => [t.state, t.kind, t.subject, taskNote(t)])), tasks)
      return 0
    }

    case "import": {
      const [source, from] = args
      if (!["zotero", "bibtex", "folder"].includes(source) || !from || args.length > 2) {
        throw new Usage("owlit import takes zotero, bibtex or folder, then the path.")
      }
      const started = await owlit.rpc.library.import({ source: source as ImportSource, path: path.resolve(io.cwd, from), ...(flags.tags ? { collectionsAsTags: true } : {}) })
      let shown = ""
      let task: Task | undefined
      for (;;) {
        task = (await owlit.rpc.tasks.list()).find((t) => t.id === started.taskId)
        if (!task || isTaskFinished(task)) break
        if (task.state === "waiting_for_you" && task.waiting?.reason === "confirm_spend") {
          const parse = flags.parse ? true : flags["no-parse"] ? false : await askParse(task.waiting.detail, io)
          if (parse === null) {
            io.err(`${task.waiting.detail} The import waits for an answer in owlit's Library.\n`)
            return FAILED
          }
          await owlit.rpc.library.importAnswer({ id: started.id, parse })
          continue
        }
        const line = task.progress?.total ? `Importing ${task.progress.done} of ${task.progress.total}` : "Reading it…"
        if (line !== shown && !flags.json) io.err(`${line}\n`)
        shown = line
        await new Promise((r) => setTimeout(r, 300))
      }
      const summary = (await owlit.rpc.library.imports()).find((i) => i.id === started.id) ?? started
      if (task?.state === "failed") {
        io.err(`The import stopped: ${task.error ?? "it failed"}\n`)
        return FAILED
      }
      const failed = summary.failed.map((f) => `  ${f.title ?? f.key}: ${f.error}`)
      const head = `${summary.added.length} added · ${summary.existed} already there${summary.failed.length ? ` · ${summary.failed.length} couldn't be added` : ""}`
      const lines = [task?.state === "cancelled" ? `Cancelled. ${head}` : head, ...failed]
      if (summary.added.length) lines.push("PDFs and text arrive by themselves; owlit tasks shows how far they are.")
      print(lines.join("\n"), summary)
      return task?.state === "done" ? 0 : FAILED
    }

    case "index": {
      if (args[0] !== "rebuild") throw new Usage("The index command is owlit index rebuild.")
      await owlit.rpc.search.rebuild()
      // The rebuild starts the reading and returns; the command waits for the reading to end
      let status = await owlit.rpc.search.status()
      while (status.state === "indexing") {
        await new Promise((r) => setTimeout(r, 200))
        status = await owlit.rpc.search.status()
      }
      print(`The search index is rebuilt: ${count(status.papers, "paper")}, ${count(status.docs, "doc")}, ${count(status.chats, "chat")}.`, status)
      return 0
    }

    default:
      throw new Usage(`There is no command ${command}.`)
  }
}

// Whether MinerU reads every PDF of a big import, asked at the terminal; null with no one to ask
async function askParse(question: string, io: Io): Promise<boolean | null> {
  if (!io.ask) return null
  const answer = (await io.ask(`${question} Have MinerU read them? [y/N] `)).trim().toLowerCase()
  return answer === "y" || answer === "yes"
}

// Opens the workspace in the app (the bundle the installed command belongs to, as OWLIT_APP says; else
// whatever app is called Owlit) and waits until it answers, so a script can go on with the next command
async function open(workspace: string, io: Io, socketDir?: string): Promise<number> {
  if (!(await isFolder(workspace))) {
    io.err(`There is no folder at ${workspace}.\n`)
    return FAILED
  }
  const running = () =>
    connect(workspace, { dir: socketDir }).then(
      (c) => (c.close(), true),
      () => false,
    )
  if (await running()) return 0
  const app = io.env.OWLIT_APP || "Owlit"
  const failure = await new Promise<string | null>((resolve) => execFile("open", ["-a", app, workspace], (error, _out, stderr) => resolve(error ? stderr.trim() || error.message : null)))
  if (failure) {
    io.err(`Couldn't open owlit: ${failure}\n`)
    return FAILED
  }
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await running()) return 0
  }
  io.err(`owlit didn't open ${path.basename(workspace)} within 30 seconds.\n`)
  return NOT_RUNNING
}

// owlit-mcp in this process's place: the agent talks to it over this command's stdin and stdout. The
// installed command says where the bundled one is (OWLIT_MCP); from the repo it is the package's source.
function mcp(workspace: string, argv: string[], io: Io): Promise<number> {
  const script = io.env.OWLIT_MCP || path.join(import.meta.dirname, "../../owlit-mcp/src/main.ts")
  const rest = argv.filter((a, i) => a !== "mcp" && a !== "--workspace" && argv[i - 1] !== "--workspace")
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, "--workspace", workspace, ...rest], { stdio: "inherit", env: { ...process.env, ...io.env } })
    child.on("close", (code) => resolve(code ?? FAILED))
    child.on("error", () => resolve(FAILED))
  })
}

// The workspace a folder is in: the nearest folder upward that has .owlit/
async function findWorkspace(given: string | undefined, cwd: string): Promise<string | null> {
  if (given) return path.resolve(cwd, given)
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (await isFolder(path.join(dir, ".owlit"))) return dir
    if (path.dirname(dir) === dir) return null
  }
}

const isFolder = (p: string) => stat(p).then(
  (s) => s.isDirectory(),
  () => false,
)

function taskNote(t: Task) {
  if (t.waiting) return `waiting for you: ${t.waiting.detail}`
  if (t.error) return t.error
  // A finished task's count is where it stopped, which says nothing; its note (the route that worked) does
  if (t.state !== "running") return t.progress?.note ?? ""
  if (t.progress) return `${t.progress.done}${t.progress.total ? ` of ${t.progress.total}` : ""}${t.progress.note ? ` · ${t.progress.note}` : ""}`
  return ""
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

// Columns padded to their widest cell; the last one runs on
function table(rows: string[][]) {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => r[i].length))) ?? []
  return rows.map((r) => r.map((cell, i) => (i < r.length - 1 ? cell.padEnd(widths[i]) : cell)).join("  ").trimEnd()).join("\n")
}
