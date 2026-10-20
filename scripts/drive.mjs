// pnpm drive: Owlit Dev (Electron) driven from the command line, so an agent can try a feature in the real
// app and see what it did. Node built-ins only; one command per run, so each is one Bash call.
//
//   pnpm drive start [--engine fake|claude|codex] [--workspace <dir> | --mine] [--fresh] [--slow <ms>]
//     Starts Owlit Dev on scratch app data (a folder of its own under the system temp dir, never your real
//     data), serves the renderer on a fixed port, opens the fixture workspace (a copy of the example
//     workspace; --mine: a clone of your own data and workspace, as pnpm try makes one, kept apart from
//     pnpm try's; --workspace: a folder as it is, which may be a copy but never one of your real
//     workspaces, which it refuses) and makes the chat's
//     agent the fake engine (packages/core/src/agents/fake-acp.ts: no sign-in, answers "echo: <text>", and
//     its header lists the prompts that make it ask, edit, crash and so on) or Claude Code / Codex from
//     PATH, already signed in. Prints where everything is. --fresh starts the data and the fixture over
//     (with --mine, clones your data again).
//     --slow makes the fake engine take that long over each digest, so Stop, a quit in the middle and
//     the running state can be seen.
//   pnpm drive status | stop | restart
//     restart quits the app and starts it again on the same data and ports, for persistence checks.
//   pnpm drive shot [file.png]            the window at 1 CSS px per pixel; prints the file's path
//   pnpm drive look [css-selector] [--all]  the visible elements: #id role [name] "text" @x,y w×h (--all: scrolled-out too)
//   pnpm drive find <text>                the same, only lines containing the text (case-insensitive)
//   pnpm drive click|hover <#id | x,y> [--right] [--double]
//   pnpm drive scroll <#id | x,y> <dy>    wheel by dy CSS px (negative is up)
//   pnpm drive type <text>                into whatever has focus
//   pnpm drive paste <workspace path>     a file of the workspace, pasted into what has focus (a picture
//                                         into the chat's composer, as ⌘V does; the file picker can't be driven)
//   pnpm drive key <combo>                Enter, Escape, Tab, ArrowDown, Meta+j, Shift+Meta+j, …
//   pnpm drive text [#id | css-selector]  the element's (or the page's) text
//   pnpm drive eval <js>                  an expression in the page (await works); prints JSON
//   pnpm drive url                        the page's route
//   pnpm drive go <route>                 to a route inside the app (/library/<paper id>, /docs/<doc id>, /chat)
//   pnpm drive reload                     loads the page again (after rpc made something the window should show)
//   pnpm drive wait <ms> | text <t> | gone <t> | js <expr>   [--timeout <ms>]
//   pnpm drive rpc <method> [json]        core, through the window's own bridge (window.owlit.rpc)
//   pnpm drive log [lines]                the launcher's output: Vite, esbuild, main's and core's lines
//
// A typical check: start → look → click #12 → type "hello" → key Enter → wait text "echo: hello" → shot →
// restart → wait text "echo: hello" → stop. Ids come from the last look or find on the same page and stay
// until the page reloads (a restart does). Write what a shot shows into the work folder's Verification
// with the file's path.
//
// Traps this handles, so a run doesn't have to:
// - Electron can't start inside the agent sandbox: run start and restart with the sandbox off. Every other
//   command talks over a local socket and runs anywhere.
// - The app outlives the command that started it (detached, output in a log), and the Bash call returns
//   once the app answers.
// - The app data is always a scratch folder, and the renderer's port is fixed per data folder: localStorage
//   is per origin, so the chat's agent and the panel's size would be lost on a restart otherwise (dev.mjs
//   picks a new port each time).
// - The window usually opens in another Space, where Chromium throttles timers and stops drawing: the
//   no-throttle flags keep it live, and shot draws the page through the debugger wherever the window is.
//   Native views aren't in it (a PDF's own viewer is blank in a shot).
// - The debugging port is a free one, checked against lsof too: a port a dying process still holds can
//   accept a listen() and still refuse Chromium.
// - A quit is a real quit (SIGTERM to Electron's own process, which runs will-quit), so core releases the
//   workspace and cuts running chats off as it does for a person.
// - OWLIT_NO_EXTERNAL=1: links the app would open in your browser go to the log instead.
// - The extension server gets its own port, so an Owlit Dev of your own can stay open beside this one.
// - A native dialog (Open…, a message box) blocks the page and nothing here can close it: open
//   workspaces with rpc, and don't click what opens one.
// - key reaches the page only: the menu's accelerators (⌘, for Settings) don't fire. Use the page's own
//   shortcuts, a click, or rpc.
// - The variables Claude Code sets for its children are not passed on, so an agent the app starts doesn't
//   take owlit's chats for desktop sessions (core agents.ts, agentEnv, says what they cost).
// - rpc runs as the window, so what it makes (a doc, a comment) is signed as the person and isn't on
//   screen until reload; Owlit's own comments and digests come from a chat, fake or real.

import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { previewData, realData } from "../apps/desktop/scripts/preview.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
// One home per checkout, so two worktrees can be driven at once
const home = process.env.OWLIT_DRIVE_HOME || path.join(os.tmpdir(), "owlit-drive", `${path.basename(root)}-${createHash("sha1").update(root).digest("hex").slice(0, 6)}`)
const stateFile = path.join(home, "drive.json")
const dataDir = path.join(home, "data")
const logFile = path.join(home, "launcher.log")
const pidFile = path.join(home, "electron.pid")
const shotsDir = path.join(home, "shots")
const fakeAgent = path.join(root, "packages/core/src/agents/fake-acp.ts")
const exampleWorkspace = path.join(root, "apps/desktop/resources/example-workspace")

const NO_THROTTLE = ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"]
const ENGINES = { fake: null, claude: "claude-code", codex: "codex" }

const [command, ...rest] = process.argv.slice(2)
const flags = {}
const args = []
for (let i = 0; i < rest.length; i++) {
  const arg = rest[i]
  if (arg === "--engine" || arg === "--workspace" || arg === "--timeout" || arg === "--slow") flags[arg.slice(2)] = rest[++i]
  else if (arg === "--mine") flags.mine = true
  else if (arg.startsWith("--")) flags[arg.slice(2)] = true
  else args.push(arg)
}

const realPath = (p) => (existsSync(p) ? realpathSync(p) : path.join(realpathSync(path.dirname(p)), path.basename(p)))
const readState = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null)
const writeState = (state) => writeFileSync(stateFile, JSON.stringify(state, null, 2))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const running = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function main() {
  switch (command) {
    case "start":
      return start()
    case "stop":
      return stop()
    case "restart": {
      await stop()
      return start()
    }
    case "status":
      return status()
    case "log": {
      const lines = readFileSync(logFile, "utf8").split("\n")
      return console.log(lines.slice(-(Number(args[0]) || 40)).join("\n"))
    }
    case "shot":
      return shot(args[0])
    case "look":
      return console.log(await look(args[0]))
    case "find":
      return console.log(await look(undefined, args.join(" ")))
    case "click":
    case "hover":
      return pointer(command, args[0])
    case "scroll":
      return scroll(args[0], Number(args[1]))
    case "paste":
      return paste(args[0])
    case "type":
      return withPage((page) => page.send("Input.insertText", { text: args.join(" ") }))
    case "key":
      return key(args[0])
    case "text":
      return console.log(await text(args[0]))
    case "eval":
      return console.log(JSON.stringify(await withPage((page) => evaluate(page, args.join(" "))), null, 2))
    case "url":
      return console.log(await withPage((page) => evaluate(page, "location.pathname + location.search + location.hash")))
    case "reload":
      // The window takes rpc calls from here for its own and expects to apply their results itself, so a
      // doc or chat made over rpc isn't on screen until the page loads again
      return withPage((page) => page.send("Page.reload"))
    case "go":
      // The router listens for popstate, so this is a navigation inside the app, not a page load
      return withPage((page) => evaluate(page, `(history.pushState({}, "", ${JSON.stringify(args[0])}), dispatchEvent(new PopStateEvent("popstate")))`))
    case "wait":
      return wait(args)
    case "rpc":
      return console.log(JSON.stringify(await withPage((page) => rpc(page, args[0], args[1] && JSON.parse(args[1]))), null, 2))
    default:
      console.error(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n\n")[0].replaceAll(/^\/\/ ?/gm, ""))
      process.exit(2)
  }
}

// ---- The app's life ----

async function start() {
  let old = readState()
  if (old?.launcherPid && running(old.launcherPid) && (await fetchJson(`http://127.0.0.1:${old.cdpPort}/json/version`).catch(() => null))) {
    console.log("[drive] already running")
    return status()
  }
  // --fresh forgets the last run entirely: its data, its fixture copy and its choices (engine, workspace)
  if (flags.fresh) {
    rmSync(dataDir, { recursive: true, force: true })
    if (old?.workspace?.startsWith(realPath(home) + path.sep)) rmSync(old.workspace, { recursive: true, force: true })
    rmSync(path.join(home, "Owlit Example"), { recursive: true, force: true })
    old = null
  }
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(shotsDir, { recursive: true })
  rmSync(pidFile, { force: true })

  const engine = flags.engine ?? old?.engine ?? "fake"
  if (!(engine in ENGINES)) throw new Error(`--engine is fake, claude or codex, not ${engine}`)
  // --mine: your data and workspaces cloned the way pnpm try clones them (preview.mjs), into a preview of
  // this checkout's own; its settings already name the cloned workspace to open
  const mine = flags.mine || (old?.mine && !flags.workspace)
  const userData = mine ? previewData({ checkout: root, fresh: Boolean(flags.fresh), suffix: "drive" }) : dataDir
  // The folder's real path, as core names it (the temp dir is a symlink on macOS)
  const workspace = realPath(
    flags.workspace ? path.resolve(flags.workspace) : mine ? (JSON.parse(readFileSync(path.join(userData, "settings.json"), "utf8")).lastWorkspace ?? path.join(home, "Owlit Example")) : (old?.workspace ?? path.join(home, "Owlit Example")),
  )
  refuseReal(workspace)
  const devPort = old?.devPort ?? (await freePort())
  const extensionPort = old?.extensionPort ?? (await freePort())
  const cdpPort = await freePort()

  const env = { ...process.env, OWLIT_USER_DATA: userData, OWLIT_DEV_PORT: String(devPort), OWLIT_EXTENSION_PORT: String(extensionPort), OWLIT_PID_FILE: pidFile, OWLIT_NO_EXTERNAL: "1" }
  // The app passes its environment on to the agents it starts
  if (flags.slow) env.FAKE_ACP_SLOW_MS = String(Number(flags.slow))
  for (const name of Object.keys(env)) {
    if (/^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|AI_AGENT|CLAUDE_CODE_ENTRYPOINT)$/.test(name) || /^(CLAUDE_AGENT_SDK_|CLAUDE_PREVIEW_)/.test(name)) delete env[name]
  }
  const out = openSync(logFile, "a")
  writeFileSync(logFile, `\n[drive] ${new Date().toISOString()} start --engine ${engine}\n`, { flag: "a" })
  const child = spawn(process.execPath, [path.join(root, "scripts/try.mjs"), "--", `--remote-debugging-port=${cdpPort}`, ...NO_THROTTLE], {
    cwd: root,
    env,
    detached: true,
    stdio: ["ignore", out, out],
  })
  child.unref()
  const state = { devPort, cdpPort, extensionPort, engine, workspace, mine, userData, launcherPid: child.pid, startedAt: new Date().toISOString() }
  writeState(state)

  // A launcher that dies (pnpm install, Vite or Electron failing) ends the wait at once
  const unless = (check) => async () => (running(child.pid) ? check() : new Error("the launcher exited: pnpm drive log says why"))
  await until(unless(() => fetchJson(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null)), 180_000, "Electron to answer on its debugging port")
  const page = await until(unless(() => connectPage(state).catch(() => null)), 120_000, "the window to load")
  try {
    await until(() => evaluate(page, "typeof window.owlit === 'object'"), 60_000, "the window's bridge")
    const settings = await until(() => rpc(page, "settings.get").catch(() => null), 60_000, "core to answer")

    if (!existsSync(path.join(workspace, ".owlit", "workspace.json"))) {
      if (flags.workspace) throw new Error(`${workspace} isn't a workspace (no .owlit/workspace.json)`)
      makeFixture(workspace, settings.profile?.id ?? JSON.parse(readFileSync(path.join(userData, "settings.json"), "utf8")).profile?.id)
    }
    const current = await rpc(page, "workspace.current")
    if (current?.path !== workspace) await rpc(page, "workspace.open", { path: workspace })

    const id = await chooseEngine(page, engine)
    await rpc(page, "settings.update", { patch: { backgroundAgent: id } })
    // The agent new chats start on is the renderer's (chat/store.ts persists its selection under
    // owlit.chat); set it and load the page again, so the renderer starts with the agent and the
    // workspace both in place instead of hearing about them one by one
    await evaluate(
      page,
      `(() => { const key = "owlit.chat"; const stored = JSON.parse(localStorage.getItem(key) || '{"state":{},"version":1}'); stored.state = { ...stored.state, selection: { connectorId: ${JSON.stringify(id)} } }; localStorage.setItem(key, JSON.stringify(stored)) })()`,
    )
    await page.send("Page.reload")
    page.close()
    await sleep(500)
    const again = await until(() => connectPage(state).catch(() => null), 60_000, "the window to load again")
    await until(() => rpc(again, "workspace.current").then((w) => w?.path === workspace, () => false), 60_000, "the workspace to open")
    again.close()
    state.engineId = id
    writeState(state)
    console.log("[drive] Owlit Dev is up")
    status()
  } finally {
    page.close()
  }
}

// The fake engine is a custom agent (what Settings › Agents › Add would make); Claude Code and Codex are
// the built-in ones, found on PATH. Each is checked, as Settings does, so its models and modes are known
// and a sign-in problem shows here rather than in the first chat.
async function chooseEngine(page, engine) {
  let id = ENGINES[engine]
  if (!id) {
    const agents = await rpc(page, "agents.list")
    id = agents.find((a) => a.command.includes(fakeAgent))?.id
    if (!id) id = (await rpc(page, "agents.add", { name: "Fake engine", command: `"${process.execPath}" "${fakeAgent}"` })).id
  }
  const checked = await rpc(page, "agents.check", { id })
  if (checked.status !== "available" && checked.status !== "connected") console.log(`[drive] ${checked.name} is ${checked.status}: ${checked.error ?? ""}`)
  return id
}

// A real workspace of yours is never driven: what the app does to it (digests, comments, moves) would be
// done for real. The real app data's settings say which folders those are.
function refuseReal(workspace) {
  let settings
  try {
    settings = JSON.parse(readFileSync(path.join(realData, "settings.json"), "utf8"))
  } catch {
    return
  }
  const real = [settings.lastWorkspace, ...(settings.recentWorkspaces ?? [])].filter((w) => typeof w === "string").map((w) => realPath(w))
  if (real.some((w) => workspace === w || workspace.startsWith(w + path.sep))) throw new Error(`${workspace} is one of your real workspaces; drive a copy (--mine clones it)`)
}

// The example workspace as the app ships it, signed as this app data's person: its records are the
// example person's (core workspace/example.ts, signAs), and the app treats those as someone else's
function makeFixture(workspace, profileId) {
  cpSync(exampleWorkspace, workspace, { recursive: true })
  if (!profileId) return
  const records = path.join(workspace, ".owlit")
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.jsonl?$/.test(e.name) ? [path.join(dir, e.name)] : []))
  for (const file of walk(records)) {
    const text = readFileSync(file, "utf8")
    const signed = text.replaceAll('"p_example"', `"p_${profileId}"`).replaceAll('"o_example"', `"o_${profileId}"`)
    if (signed !== text) writeFileSync(file, signed)
  }
  const seen = path.join(records, "seen", "p_example.json")
  if (existsSync(seen)) renameSync(seen, path.join(records, "seen", `p_${profileId}.json`))
}

async function stop() {
  const state = readState()
  if (!state?.launcherPid || !running(state.launcherPid)) {
    console.log("[drive] not running")
    return
  }
  const electron = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : null
  // Electron first: SIGTERM is a quit to it (will-quit runs, core releases the workspace), and dev.mjs
  // ends when its Electron does. A launcher that doesn't follow within a while is killed with its group.
  if (electron && running(electron)) process.kill(electron, "SIGTERM")
  else process.kill(state.launcherPid, "SIGTERM")
  const gone = await until(() => !running(state.launcherPid), 20_000, "").catch(() => false)
  if (!gone) {
    try {
      process.kill(-state.launcherPid, "SIGKILL")
    } catch {}
  }
  writeState({ ...state, launcherPid: null })
  console.log(`[drive] stopped${gone ? "" : " (killed)"}`)
}

function status() {
  const state = readState()
  const up = state?.launcherPid && running(state.launcherPid)
  console.log(`  ${up ? "running" : "stopped"}`)
  if (!state) return
  console.log(`  data       ${state.userData ?? dataDir}${state.mine ? " (a clone of yours)" : ""}`)
  console.log(`  workspace  ${state.workspace}`)
  console.log(`  engine     ${state.engine}${state.engineId ? ` (${state.engineId})` : ""}`)
  console.log(`  renderer   http://localhost:${state.devPort}/`)
  console.log(`  debugger   http://127.0.0.1:${state.cdpPort}/`)
  console.log(`  log        ${logFile}`)
  console.log(`  shots      ${shotsDir}`)
}

// ---- Looking and acting ----

async function shot(file) {
  const out = file ? path.resolve(file) : path.join(shotsDir, `${new Date().toISOString().slice(11, 19).replaceAll(":", "")}-${Math.random().toString(36).slice(2, 5)}.png`)
  await withPage(async (page) => {
    const { cssVisualViewport: v } = await page.send("Page.getLayoutMetrics")
    const dpr = await evaluate(page, "devicePixelRatio")
    const { data } = await page.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: v.clientWidth, height: v.clientHeight, scale: 1 / dpr } })
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, Buffer.from(data, "base64"))
  })
  console.log(out)
}

// Runs in the page: every visible element that acts (a control, a role) or has text of its own, with an
// id that stays with the element while the page lives, so a later click can name it
function walkPage(scope, needle, all) {
  const reg = (window.__drive ??= { ids: new WeakMap(), els: [], next: 1 })
  const root = scope ? document.querySelector(scope) : document.body
  if (!root) return `nothing matches ${scope}`
  const lines = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  for (let el = root; el; el = walker.nextNode()) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const style = getComputedStyle(el)
    if (style.visibility === "hidden" || style.opacity === "0") continue
    const acts = el.matches('a,button,input,textarea,select,summary,[role],[contenteditable="true"],[tabindex]')
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .filter(Boolean)
      .join(" ")
    if (!acts && !own) continue
    let id = reg.ids.get(el)
    if (!id) {
      id = reg.next++
      reg.ids.set(el, id)
      reg.els[id] = el
    }
    const name = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || ""
    const role = el.getAttribute("role") || el.tagName.toLowerCase()
    const value = el.matches("input,textarea") ? el.value : ""
    const text = (own || (acts ? el.innerText : "") || value).replace(/\s+/g, " ").trim().slice(0, 80)
    const x = Math.round(r.x + r.width / 2)
    const y = Math.round(r.y + r.height / 2)
    const marks = [el.disabled && "disabled", el === document.activeElement && "focused", el.getAttribute("aria-expanded") === "true" && "expanded", el.getAttribute("aria-selected") === "true" && "selected", (x < 0 || y < 0 || x > innerWidth || y > innerHeight) && "offscreen"].filter(Boolean)
    if (marks.includes("offscreen") && !all) continue
    const line = `#${id} ${role}${name ? ` [${name}]` : ""} ${JSON.stringify(text)} @${x},${y} ${Math.round(r.width)}x${Math.round(r.height)}${marks.length ? " " + marks.join(" ") : ""}`
    if (!needle || line.toLowerCase().includes(needle.toLowerCase())) lines.push(line)
  }
  return lines.join("\n") || (needle ? `nothing contains ${JSON.stringify(needle)}` : "nothing visible")
}

// Elements scrolled out of view are left out unless --all: a long page lists hundreds of them
const look = (scope, needle) => withPage((page) => evaluate(page, `(${walkPage.toString()})(${JSON.stringify(scope ?? null)}, ${JSON.stringify(needle ?? null)}, ${Boolean(flags.all)})`))

// A target: "#12" from look, or "x,y" in CSS px. An element is scrolled into view first, without the
// page's smooth scrolling, which would leave its rectangle mid-way when it is read.
async function centre(page, target) {
  if (/^-?\d+,-?\d+$/.test(target)) {
    const [x, y] = target.split(",").map(Number)
    return { x, y }
  }
  const id = Number(target.replace(/^#/, ""))
  if (!id) throw new Error(`click what? "#12" from look, or "x,y"`)
  const point = await evaluate(
    page,
    `(() => { const el = window.__drive?.els[${id}]; if (!el || !el.isConnected) return null; el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" }); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()`,
  )
  if (!point) throw new Error(`#${id} is gone (look again)`)
  return point
}

async function pointer(kind, target) {
  await withPage(async (page) => {
    const { x, y } = await centre(page, target)
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
    if (kind === "hover") return
    const button = flags.right ? "right" : "left"
    const clicks = flags.double ? 2 : 1
    for (let n = 1; n <= clicks; n++) {
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: n })
      await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: n })
    }
  })
}

async function scroll(target, dy) {
  await withPage(async (page) => {
    const { x, y } = await centre(page, target)
    await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy || 300 })
  })
}

const MODIFIERS = { alt: 1, option: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, shift: 8 }
const NAMED_KEYS = { enter: ["Enter", 13, "\r"], escape: ["Escape", 27], esc: ["Escape", 27], tab: ["Tab", 9], backspace: ["Backspace", 8], delete: ["Delete", 46], space: [" ", 32, " "], arrowup: ["ArrowUp", 38], arrowdown: ["ArrowDown", 40], arrowleft: ["ArrowLeft", 37], arrowright: ["ArrowRight", 39], home: ["Home", 36], end: ["End", 35], pageup: ["PageUp", 33], pagedown: ["PageDown", 34] }
const PUNCTUATION = { ",": ["Comma", 188], ".": ["Period", 190], "/": ["Slash", 191], ";": ["Semicolon", 186], "'": ["Quote", 222], "[": ["BracketLeft", 219], "]": ["BracketRight", 221], "\\": ["Backslash", 220], "-": ["Minus", 189], "=": ["Equal", 187], "`": ["Backquote", 192] }

// A key with modifiers, as the page sees a person press it: Meta+j fires the page's ⌘J, Enter sends
async function key(combo) {
  if (!combo) throw new Error("key what?")
  const parts = combo.split("+")
  const last = parts.pop()
  let modifiers = 0
  for (const part of parts) {
    if (!(part.toLowerCase() in MODIFIERS)) throw new Error(`unknown modifier ${part}`)
    modifiers |= MODIFIERS[part.toLowerCase()]
  }
  let keyName, code, vk, text
  const named = NAMED_KEYS[last.toLowerCase()]
  if (named) {
    ;[keyName, vk, text] = named
    code = keyName === " " ? "Space" : keyName
  } else if (last.length === 1 && /[a-z]/i.test(last)) {
    const upper = last.toUpperCase()
    keyName = modifiers & 8 ? upper : last.toLowerCase()
    code = `Key${upper}`
    vk = upper.charCodeAt(0)
    text = keyName
  } else if (last.length === 1 && /[0-9]/.test(last)) {
    keyName = last
    code = `Digit${last}`
    vk = last.charCodeAt(0)
    text = last
  } else if (last.length === 1 && PUNCTUATION[last]) {
    keyName = last
    ;[code, vk] = PUNCTUATION[last]
    text = last
  } else throw new Error(`unknown key ${last}`)
  // Text rides along only for a plain press: with ⌘ or ⌃ held, a key is a shortcut, not typing
  const typing = text && !(modifiers & 6)
  await withPage(async (page) => {
    const base = { key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
    await page.send("Input.dispatchKeyEvent", { type: typing ? "keyDown" : "rawKeyDown", ...base, ...(typing ? { text, unmodifiedText: text } : {}) })
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...base })
  })
}

// Pastes a workspace file as the clipboard would carry it: the composer takes files from a paste event's
// clipboardData (chat/components/composer/Composer.tsx). The file is read over the app's own scheme.
async function paste(file) {
  if (!file) throw new Error("paste <workspace path>")
  const result = await withPage((page) =>
    evaluate(
      page,
      `(async () => {
        const response = await fetch("owlit-file://workspace/" + ${JSON.stringify(file)}.split("/").map(encodeURIComponent).join("/"))
        if (!response.ok) return "no file at " + ${JSON.stringify(file)}
        const blob = await response.blob()
        const types = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf", md: "text/markdown", txt: "text/plain" }
        const name = ${JSON.stringify(file)}.split("/").pop()
        const transfer = new DataTransfer()
        transfer.items.add(new File([blob], name, { type: types[name.split(".").pop().toLowerCase()] ?? blob.type }))
        const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.querySelector('[role=textbox], textarea, [contenteditable=true]')
        if (!target) return "nothing has focus"
        target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }))
        return "pasted " + name + " (" + blob.size + " bytes)"
      })()`,
    ),
  )
  console.log(result)
}

const text = (target) =>
  withPage((page) =>
    evaluate(
      page,
      `(() => { const t = ${JSON.stringify(target ?? "")}; const el = !t ? document.body : t.startsWith("#") && /^#\\d+$/.test(t) ? window.__drive?.els[Number(t.slice(1))] : document.querySelector(t); if (!el) return "nothing at " + t; return el.innerText.trim().slice(0, 20000) })()`,
    ),
  )

async function wait([what, ...more]) {
  const timeout = Number(flags.timeout) || 20_000
  if (/^\d+$/.test(what)) return sleep(Number(what))
  const needle = more.join(" ")
  const check = {
    text: (page) => evaluate(page, `document.body.innerText.includes(${JSON.stringify(needle)})`),
    gone: (page) => evaluate(page, `!document.body.innerText.includes(${JSON.stringify(needle)})`),
    js: (page) => evaluate(page, `!!(${needle})`),
  }[what]
  if (!check) throw new Error("wait <ms>, wait text <t>, wait gone <t> or wait js <expr>")
  await withPage((page) => until(() => check(page), timeout, `${what} ${JSON.stringify(needle)}`))
}

// ---- The wire: Chrome DevTools Protocol over the window's debugging socket ----

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  return response.json()
}

async function connectPage(state) {
  const targets = await fetchJson(`http://127.0.0.1:${state.cdpPort}/json`)
  const target = targets.find((t) => t.type === "page" && t.url.startsWith(`http://localhost:${state.devPort}`))
  if (!target) throw new Error("the window hasn't loaded the renderer yet")
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error("couldn't open the debugging socket"))
  })
  let next = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(message.error.message))
    else waiter.resolve(message.result)
  }
  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++next
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      }),
    close: () => ws.close(),
  }
}

async function withPage(fn) {
  const state = readState()
  if (!state?.launcherPid || !running(state.launcherPid)) throw new Error("Owlit Dev isn't running: pnpm drive start")
  const page = await connectPage(state)
  try {
    return await fn(page)
  } finally {
    page.close()
  }
}

async function evaluate(page, expression) {
  // Inside an async function, so an expression may await (eval "await window.owlit.rpc(…)") and a promise
  // it returns is waited for
  const { result, exceptionDetails } = await page.send("Runtime.evaluate", { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return result.value
}

// core, as the window calls it; an error answer is thrown with core's sentence
async function rpc(page, method, params) {
  if (!method) throw new Error("rpc <method> [json]")
  const response = await evaluate(page, `await window.owlit.rpc(${JSON.stringify(method)}, ${params === undefined ? "undefined" : JSON.stringify(params)})`)
  if (response?.error) throw new Error(`${method}: ${response.error.message}`)
  return response?.result
}

async function until(check, timeout, what) {
  const end = Date.now() + timeout
  for (;;) {
    const value = await check()
    if (value instanceof Error) throw value
    if (value) return value
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await sleep(250)
  }
}

// A port nothing listens on, by lsof as well as a listen(): a port a dying process still holds can be
// bound again and still refuse Chromium a moment later
async function freePort() {
  for (let tries = 0; tries < 20; tries++) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer()
      server.unref()
      server.on("error", reject)
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address()
        server.close(() => resolve(port))
      })
    })
    let held = ""
    try {
      held = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    } catch {
      // lsof exits 1 when nothing holds the port
    }
    if (!held.trim()) return port
  }
  throw new Error("no free port")
}

main().catch((error) => {
  console.error(`[drive] ${error.message}`)
  process.exit(1)
})
