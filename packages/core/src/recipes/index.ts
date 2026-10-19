import type { ChatAbout } from "@owlit/protocol"
import { goThrough } from "./go-through.ts"
import { reply } from "./reply.ts"
import { THREAD_RECIPES } from "./threads.ts"

// The recipes: what Owlit is told for each piece of work owlit offers as a button. A chat owlit starts for
// the person (chats.ts startFor) is given one as its first message; an agent in any chat reads the same
// one through owlit_help, so work asked for in words is done the way the button does it. Recipes are text
// for agents: English, never translated.

export interface Recipe<I> {
  // What the work is on; whoever owns that kind works out the recipe's input (Threads.recipeInput)
  about: ChatAbout["kind"]
  // One line on what it does and what it needs, for owlit_help's list
  description: string
  text: (input: I) => string
}

export const RECIPES = { ...THREAD_RECIPES, "go-through": goThrough, reply }

export type RecipeName = keyof typeof RECIPES

export const isRecipe = (name: string): name is RecipeName => Object.hasOwn(RECIPES, name)

// The recipes as owlit_help lists them
export function recipeList() {
  return Object.entries(RECIPES)
    .map(([name, r]) => `- ${name}: ${r.description}`)
    .join("\n")
}
