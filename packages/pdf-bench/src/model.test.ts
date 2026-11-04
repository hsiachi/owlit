import { it } from "vitest"
import { modelTest } from "./model.ts"

// Two files for the two worlds, so they run side by side
it("every paper ends as the model says, through any sequence of what the user and the machine do", { timeout: 600_000 }, () => modelTest(false, 20261103))
