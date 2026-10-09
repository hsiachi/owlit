import { inflateRawSync } from "node:zlib"

// The files in a zip archive (stored or deflated, no zip64), as MinerU sends its results. Reads the
// central directory, so entries written with data descriptors are found too.
export function unzip(zip: Buffer): Map<string, Buffer> {
  const end = findEndOfCentralDirectory(zip)
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const files = new Map<string, Buffer>()
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("The zip's directory is damaged.")
    const method = zip.readUInt16LE(at + 10)
    const compressed = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const extraLength = zip.readUInt16LE(at + 30)
    const commentLength = zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8")
    at += 46 + nameLength + extraLength + commentLength
    if (name.endsWith("/")) continue
    const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = zip.subarray(dataAt, dataAt + compressed)
    if (method === 0) files.set(name, Buffer.from(data))
    else if (method === 8) files.set(name, inflateRawSync(data))
    else throw new Error(`The zip uses a compression owlit can't read (${method}).`)
  }
  return files
}

function findEndOfCentralDirectory(zip: Buffer) {
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 65_535); at--) {
    if (zip.readUInt32LE(at) === 0x06054b50) return at
  }
  throw new Error("That isn't a zip archive.")
}
