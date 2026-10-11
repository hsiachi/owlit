// Space between text on the page and a popover on it
const GAP = 8

// Where a popover on a box of text sits: centred on x, above the box's top or below its bottom
export function floatOn(x: number, top: number, bottom: number, above: boolean): React.CSSProperties {
  return { left: x, top: above ? top - GAP : bottom + GAP, transform: `translate(-50%, ${above ? "-100%" : "0"})` }
}
