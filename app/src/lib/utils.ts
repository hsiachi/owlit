import { createCn } from "cn/config"

// The theme's own type steps (index.css) are font sizes, so merging keeps a colour given beside them
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["title", "body", "detail"] }] } },
})

// How a scroll the app makes travels: smoothly, unless the user asked for reduced motion
export const scrollMotion = (): ScrollBehavior => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth")
