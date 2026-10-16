// The publishers' sites the extension may read without asking: every site owlit knows a publisher by
// (packages/core/src/library/publisher-table.ts), read from that file at build time so the two never
// drift. Core's file is TypeScript with Lingui macros in what it imports, so it is loaded through Vite's
// module runner with the Lingui plugin, as core's tests load it.
import path from "node:path"
import { lingui } from "@lingui/vite-plugin"
import { runnerImport } from "vite"

const repo = path.resolve(import.meta.dirname, "../../..")

export async function publisherHosts() {
  const { module } = await runnerImport(path.join(repo, "packages/core/src/library/publisher-table.ts"), {
    configFile: false,
    logLevel: "silent",
    plugins: [lingui({ macroTransform: true, configPath: path.join(repo, "lingui.config.ts") })],
  })
  const hosts = new Set()
  for (const publisher of module.PUBLISHERS) {
    for (const host of publisher.hosts ?? []) hosts.add(host)
    // A direct PDF address names its own host (Frontiers, PLOS), unless it is the article page's
    if (publisher.pdf && !publisher.pdf.startsWith("{")) hosts.add(new URL(publisher.pdf.replace(/\{\w+\}/g, "x")).hostname)
  }
  for (const host of module.OTHER_HOSTS) hosts.add(host)
  // A site's www. and bare names are one site; *. covers both, and its other hosts
  return [...new Set([...hosts].map((host) => `https://*.${host.replace(/^www\./, "")}/*`))].sort()
}
