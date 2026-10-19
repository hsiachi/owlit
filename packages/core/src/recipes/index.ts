import { goThrough } from "./go-through.ts"
import { reply } from "./reply.ts"

// What Owlit is asked to do in a chat owlit starts for the person (core's startFor), by name. Each one
// is also served to any chat through owlit_help (agents/guide.ts), without an input: then it says how to
// find what core would otherwise give, so work asked for in a chat is done the same way.

export interface Recipe<I> {
  // One line: what the recipe does, as owlit_help lists it
  description: string
  text: (input?: I) => string
}

export const RECIPES: Record<string, Recipe<never>> = {
  "go-through": goThrough,
  reply,
}
