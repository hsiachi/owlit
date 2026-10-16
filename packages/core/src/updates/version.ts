// Whether version a comes after b: x.y.z, then a pre-release (1.0.0-beta.2) before its release. Build
// metadata (+…) is ignored. Not a full SemVer; owlit's own versions only.
export function newerVersion(a: string, b: string) {
  return compareVersions(a, b) > 0
}

export function compareVersions(a: string, b: string) {
  const [coreA, preA] = split(a)
  const [coreB, preB] = split(b)
  for (let i = 0; i < 3; i++) {
    const diff = (coreA[i] ?? 0) - (coreB[i] ?? 0)
    if (diff) return Math.sign(diff)
  }
  if (!preA.length || !preB.length) return preA.length ? -1 : preB.length ? 1 : 0
  for (let i = 0; i < Math.max(preA.length, preB.length); i++) {
    const x = preA[i]
    const y = preB[i]
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    if (x === y) continue
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y)
    return numeric ? Math.sign(Number(x) - Number(y)) : x < y ? -1 : 1
  }
  return 0
}

function split(version: string): [number[], string[]] {
  const [main = "", pre] = version.replace(/^v/, "").split("+")[0]!.split(/-(.*)/s)
  return [main.split(".").map((n) => Number.parseInt(n, 10) || 0), pre ? pre.split(".") : []]
}
