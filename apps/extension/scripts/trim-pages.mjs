// node apps/extension/scripts/trim-pages.mjs <recorded folder>: recorded publisher pages, cut down to what
// the verdict reads, into src/lib/fixtures/real/ for verdict.real.test.ts. The folder holds the pages as
// saved (already stripped of tokens, ray ids and addresses) and an index.json with one entry per page:
// file, finalUrl, status, headers, title, from ("worker" or "tab"), proxy, really, expected (one ending
// or the endings that would do). What stays of a page: its title, meta and link tags, links and buttons
// with their words, forms and inputs, headings, script addresses, JSON-LD, IEEE Xplore's metadata,
// short inline scripts (the checks' own), and the first words of each run of text. Every page is judged
// before and after trimming, and the script stops if anything the extension reads from it differs.
// Expectations already in the fixtures' index are kept; a new page takes the recorder's, and the ending
// and isThrough the code gives it are printed beside them for a person to check.
// What says who and where the recorder was is scrubbed (scrub): addresses, account and user ids in a
// page's data, session ids in links. node apps/extension/scripts/trim-pages.mjs --fixtures scrubs the
// fixtures already in place, and stops if any then reads differently.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const LIB = path.resolve(import.meta.dirname, "../src/lib")
const OUT = path.join(LIB, "fixtures/real")
const { verdict, isThrough, refreshOf, titleOf } = await import(pathToFileURL(path.join(LIB, "verdict.ts")).href)
const { paperOfPage, pdfLinkIn } = await import(pathToFileURL(path.join(LIB, "page.ts")).href)

const from = process.argv[2]
if (!from) throw new Error("usage: trim-pages.mjs <recorded folder> | --fixtures")

const KEEP_ATTRS = new Set(["href", "src", "content", "name", "property", "http-equiv", "type", "rel", "id", "class", "action", "method", "scheme", "data-translate"])
// An id or class is kept only when it names a check or a block (challenge-form, g-recaptcha, cf-error-details)
const MARKING = /challenge|captcha|cf-|verification/i
// Wrappers whose tags say nothing the verdict reads; their words stay
const WRAPPERS = /^(div|span|p|li|ul|ol|dl|dt|dd|section|article|aside|nav|header|footer|main|strong|em|b|i|u|small|sup|sub|font|label|figure|figcaption|table|thead|tbody|tr|td|th|picture|source|img|br|hr|use|path|math|semantics|annotation|mi|mo|mn|ms|mtext|mrow|msub|msup|msubsup|mfrac|msqrt|mroot|mstyle|mspace|mover|munder|munderover|mtable|mtr|mtd|mpadded|mphantom|menclose)$/i
// Markers of the checks verdict.ts reads in inline scripts; change with its CHECK_MARKUP
const CHECK_SCRIPT = /cf_chl_opt|challenge-platform|awswaf|AwsWafIntegration|_sec\/verify|bm-verify|_fs-ch-/
// A reference's links (to Scholar, PubMed, a publisher's linkout), hundreds on an article: the
// verdict reads only a page's links to its own PDF and its offers
const REFERENCE_LINK = /<a\b[^>]*\bhref\s*=\s*["']?(?:https?:\/\/(?:scholar\.google\.[a-z.]+|pubmed\.ncbi\.nlm\.nih\.gov|www\.ncbi\.nlm\.nih\.gov|europepmc\.org|www\.scopus\.com|[^"'\s>]*webofscience|[^"'\s>]*crossref\.org)|\/servlet\/linkout|\/action\/getFTRLinkout|mailto:)[^>]*>([\s\S]*?)<\/a>/gi
const IEEE_KEYS = ["title", "formulaStrippedArticleTitle", "authors", "doi", "publicationYear", "publicationTitle"]

// A page's data naming the reader: their address, their account, user, department or session. The
// value goes, the key stays, so the page's shape is what the verdict reads either way.
const PERSONAL_KEY = /^(?:ip|ipaddress|remoteaddr|clientip|(?:user|account|accountname|department|customer|member|subscriber|session|visitor|institution|org|organization|eventgroup)[_-]?(?:id|key|name)?|e-?mail)$/i
// Session ids carried in a link's query
const SESSION_PARAM = /([?&](?:amp;)?(?:sid|sessionid|jsessionid|session|token|ticket|key)=)[A-Za-z0-9%_.-]{12,}/gi
// An IPv4 address standing alone (not a version, as in Chrome/149.0.0.0 or -1.2.1.1-), but for the
// documentation range 192.0.2.0/24 the recorder already writes
const IPV4 = /(?<![\w/.-])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.-])/g
// An IPv6 address, written out or shortened with ::
const IPV6 = /(?<![\w:.])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})(?![\w:])/gi

export function scrub(text) {
  return text
    .replace(/(["'])([A-Za-z_-]+)\1(\s*:\s*)("(?:[^"\\]|\\.)*"|'[^']*'|-?\d+)/g, (all, q, key, colon, value) => (PERSONAL_KEY.test(key) ? `${q}${key}${q}${colon}${/^["']/.test(value) ? `${value[0]}${value[0]}` : "0"}` : all))
    .replace(SESSION_PARAM, "$1x")
    .replace(IPV4, (ip) => (ip.startsWith("192.0.2.") ? ip : "192.0.2.1"))
    .replace(IPV6, (ip) => (/[a-f]/i.test(ip) || ip.includes("::") ? "2001:db8::1" : ip))
}

const cut = (text, max) => (text.length > max ? text.slice(0, max) : text)

function attrs(tag) {
  const head = /^<([a-zA-Z][\w:-]*)/.exec(tag)
  if (!head) return tag
  if (WRAPPERS.test(head[1])) return ""
  const kept = []
  for (const m of tag.slice(head[0].length).matchAll(/([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) {
    const name = m[1].toLowerCase()
    if (!KEEP_ATTRS.has(name)) continue
    if (m[2] === undefined) {
      kept.push(name)
      continue
    }
    const raw = /^["']/.test(m[2]) ? m[2].slice(1, -1) : m[2]
    if ((name === "id" || name === "class") && !MARKING.test(raw)) continue
    kept.push(`${name}="${cut(raw, 300).replace(/"/g, "&quot;")}"`)
  }
  return `<${head[1]}${kept.length ? " " + kept.join(" ") : ""}${/\/>$/.test(tag) ? " /" : ""}>`
}

// The JSON object starting at a brace, up to its matching one, strings skipped
function objectAt(text, start) {
  let depth = 0
  let quoted = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === "\\") i++
      else if (c === '"') quoted = false
    } else if (c === '"') quoted = true
    else if (c === "{") depth++
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1)
  }
  return undefined
}

function scriptBody(open, body) {
  if (/application\/ld\+json/i.test(open)) {
    try {
      return JSON.stringify(JSON.parse(body))
    } catch {
      return body
    }
  }
  const at = body.indexOf("xplGlobal.document.metadata")
  if (at >= 0) {
    const json = objectAt(body, body.indexOf("{", at))
    try {
      const data = JSON.parse(json)
      return `xplGlobal.document.metadata=${JSON.stringify(Object.fromEntries(IEEE_KEYS.filter((k) => k in data).map((k) => [k, data[k]])))};`
    } catch {
      return body
    }
  }
  if (body.length <= 2000) return body
  if (!CHECK_SCRIPT.test(body)) return ""
  return [...body.matchAll(new RegExp(CHECK_SCRIPT.source, "g"))].map((m) => body.slice(Math.max(0, m.index - 150), m.index + 150)).join("\n")
}

export function trim(html) {
  let s = html
  s = s.replace(/<!--[\s\S]*?-->/g, "")
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
  s = s.replace(/<svg\b[\s\S]*?<\/svg>/gi, "")
  s = s.replace(REFERENCE_LINK, " $1 ")
  s = s.replace(/<meta\b[^>]*\bname\s*=\s*["']?citation_reference\b[^>]*>/gi, "")
  s = s.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_, open, body) => `${attrs(open)}${scriptBody(open, body)}</script>`)
  // Every other tag with only the attributes the verdict reads, and every run of text cut short; scripts
  // are left as they are now
  const parts = s.split(/(<script\b[^>]*>[\s\S]*?<\/script>)/i)
  return parts
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/<[a-zA-Z][^>]*>/g, attrs)
            .replace(/<\/([a-zA-Z][\w:-]*)\s*>/g, (close, tag) => (WRAPPERS.test(tag) ? " " : close))
            .replace(/(<[^>]*>)([^<]+)(?=<)/g, (_, tag, text) => tag + (/^<title\b/i.test(tag) ? text : cut(text.replace(/\s+/g, " "), 60)))
            .replace(/\n\s*\n+/g, "\n"),
    )
    .join("")
    .replace(/[ \t]{2,}/g, " ")
}

const headersOf = (record) => new Headers(record ?? {})
const pageOf = (entry, html) => ({
  url: entry.url,
  status: entry.from === "tab" ? 0 : entry.status,
  html,
  ...(entry.proxy ? { proxy: entry.proxy } : {}),
  ...(entry.from === "worker" ? { headers: headersOf(entry.headers) } : {}),
})
const reading = (page) =>
  JSON.stringify({
    verdict: verdict(page),
    isThrough: isThrough(page),
    title: titleOf(page.html),
    refresh: refreshOf(page) ?? null,
    pdfUrl: paperOfPage(page.html, page.url)?.pdfUrl ?? null,
    pdfLink: pdfLinkIn(page.html, page.url) ?? null,
  })

mkdirSync(OUT, { recursive: true })
const indexPath = path.join(OUT, "index.json")

// The fixtures in place, scrubbed: each must read as it did, but for what the scrub took out
if (from === "--fixtures") {
  let differ = 0
  const index = JSON.parse(readFileSync(indexPath, "utf8"))
  for (const entry of index) {
    const file = path.join(OUT, `${entry.name}.html`)
    const html = readFileSync(file, "utf8")
    const clean = scrub(html)
    if (scrub(reading(pageOf(entry, html))) !== reading(pageOf(entry, clean))) {
      differ++
      console.error(`${entry.name}: scrubbed reads differently`)
    }
    if (clean !== html) writeFileSync(file, clean)
  }
  const listed = readFileSync(indexPath, "utf8")
  if (scrub(listed) !== listed) writeFileSync(indexPath, scrub(listed))
  if (differ) {
    console.error(`${differ} fixtures read differently once scrubbed`)
    process.exit(1)
  }
  process.exit(0)
}

const before = new Map(existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")).map((e) => [e.name, e]) : [])
const recorded = JSON.parse(readFileSync(path.join(from, "index.json"), "utf8"))
// Pages recorded before and not again stay as they are
const index = [...before.values()].filter((e) => !recorded.some((r) => r.file === `${e.name}.html`))
let differ = 0
for (const e of recorded) {
  if (!e.file) continue
  const name = e.file.replace(/\.html$/, "")
  const full = readFileSync(path.join(from, e.file), "utf8")
  const entry = {
    name,
    from: e.from,
    url: e.finalUrl,
    status: e.status,
    headers: e.headers ?? {},
    ...(e.proxy ? { proxy: e.proxy } : {}),
    title: e.title ?? "",
    really: e.really,
  }
  const small = scrub(trim(full))
  const was = reading(pageOf(entry, full))
  const now = reading(pageOf(entry, small))
  // What the scrub took out may be in what the verdict reads (a refresh's address)
  if (scrub(was) !== now) {
    differ++
    console.error(`${name}: trimmed reads differently\n  full    ${was}\n  trimmed ${now}`)
  }
  const said = JSON.parse(was)
  const kept = before.get(name)
  const labels = Array.isArray(e.expected) ? e.expected : [e.expected]
  entry.verdict = kept?.verdict ?? (labels.includes(said.verdict) ? said.verdict : labels[0])
  entry.isThrough = kept?.isThrough ?? said.isThrough
  if (kept?.why) entry.why = kept.why
  if (!kept) console.log(`${name}: recorder says ${labels.join(" or ")}; the code says ${said.verdict}, isThrough ${said.isThrough}`)
  writeFileSync(path.join(OUT, `${name}.html`), small)
  index.push(entry)
}
writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n")
if (differ) {
  console.error(`${differ} pages read differently once trimmed`)
  process.exit(1)
}
