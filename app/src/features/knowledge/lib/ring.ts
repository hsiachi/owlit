// Scrolls a line or question into view and rings it once, the way a mention landing on it does
export function ringBlock(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ block: "center", behavior: "smooth" })
  el.classList.remove("animate-highlight-flash")
  void el.offsetWidth
  el.classList.add("animate-highlight-flash")
  el.addEventListener("animationend", () => el.classList.remove("animate-highlight-flash"), { once: true })
}
