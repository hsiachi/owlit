import { baseName } from "@owlit/protocol"

// Short names the interface gives things by where they are

// A file's name, from a path that may end in a slash
export const fileName = (p: string) => baseName(p.replace(/\/+$/, "")) || p

// A web address's site, without "www."; undefined for what isn't an address
export const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return undefined
  }
}
