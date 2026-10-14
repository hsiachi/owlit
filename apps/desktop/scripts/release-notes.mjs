// What goes beside the dmg when it is sent to someone: how to install it, and what changed in this
// version (its section of CHANGELOG.md), in one text file to paste into the message or send along.

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { desktopDir } from "./shared.mjs"

const INSTALL = (version) => `Owlit ${version} (Macs with Apple silicon)

1. Open the dmg and drag Owlit into Applications.
2. The first time, macOS says it can't check Owlit. Open System Settings › Privacy & Security, scroll down,
   click Open Anyway, and confirm. Each new version asks once more.
3. Owlit works through Claude Code or Codex. If one is on your Mac, Owlit offers to set it up (about 300 MB).
   Not signed in? Run \`claude\` (or \`codex\`) in Terminal once.
4. After an update, macOS may ask once for your password so Owlit can read its saved keys: choose Always Allow.

If something breaks: Help › Copy Diagnostics, and paste it into an issue at https://github.com/hsiachi/owlit/issues.

——

Owlit ${version}（适用于 Apple 芯片的 Mac）

1. 打开 dmg，把 Owlit 拖进「应用程序」。
2. 第一次打开时 macOS 会说无法检查它：打开 系统设置 › 隐私与安全性，往下找到「仍要打开」，点它并确认。之后每个新版本都会再问一次。
3. Owlit 通过 Claude Code 或 Codex 工作。Mac 上装了其中一个，Owlit 会提出帮你设置（约 300 MB）。没登录的话，在终端里运行一次 \`claude\`（或 \`codex\`）。
4. 更新后 macOS 可能会问一次密码，让 Owlit 读取保存的 key：选「始终允许」。

出了问题：帮助 › 复制诊断信息，粘贴到 https://github.com/hsiachi/owlit/issues 的新 issue 里。
`

// The section of CHANGELOG.md under "## <version>"
function changes(version) {
  const log = readFileSync(path.join(desktopDir, "CHANGELOG.md"), "utf8")
  const start = log.indexOf(`## ${version}`)
  if (start < 0) throw new Error(`CHANGELOG.md has no section for ${version}.`)
  const rest = log.slice(start)
  const next = rest.indexOf("\n## ", 1)
  return (next < 0 ? rest : rest.slice(0, next)).trim()
}

export function writeRelease(version) {
  const file = path.join(desktopDir, "release", `Owlit ${version} - read me first.txt`)
  writeFileSync(file, `${INSTALL(version)}\n——\n\n${changes(version)}\n`)
  console.log(`  • ${path.relative(desktopDir, file)}`)
}
