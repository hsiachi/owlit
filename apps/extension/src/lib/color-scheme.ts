// The browser's light or dark, as the app's .dark class draws it, for the extension's own pages
export function followColorScheme() {
  const dark = matchMedia("(prefers-color-scheme: dark)")
  const follow = () => document.documentElement.classList.toggle("dark", dark.matches)
  follow()
  dark.addEventListener("change", follow)
}
