// How long an element's own transition takes, as the stylesheet has it now (0 under reduced motion, where
// no transitionend fires, so whoever waits for one sets a timer this long instead)
export function transitionMs(el: HTMLElement | null) {
  const d = el ? getComputedStyle(el).transitionDuration : ""
  return d.endsWith("ms") ? parseFloat(d) : (parseFloat(d) || 0) * 1000
}
