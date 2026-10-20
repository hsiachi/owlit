import { goThrough } from "./go-through.ts"
import { reply } from "./reply.ts"
import { threadSkill } from "./threads.ts"

// The recipes: how Owlit does a piece of work, read whole through owlit_help (topic its name) before doing
// it in a chat. A chat owlit starts for the person (chats.ts startFor) may be given one as its first
// message, so work asked for in words is done the way owlit's own does it. Recipes are text for agents:
// English, never translated.

export interface Recipe<I> {
  // One line on what it does and what it needs, for owlit_help's list
  description: string
  text: (input: I) => string
}

export const RECIPES = { threads: threadSkill, "go-through": goThrough, reply }

export type RecipeName = keyof typeof RECIPES

export const isRecipe = (name: string): name is RecipeName => Object.hasOwn(RECIPES, name)

// The recipes as owlit_help lists them
export function recipeList() {
  return Object.entries(RECIPES)
    .map(([name, r]) => `- ${name}: ${r.description}`)
    .join("\n")
}
