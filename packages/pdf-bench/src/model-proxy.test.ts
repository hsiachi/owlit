import { it } from "vitest"
import { modelTest } from "./model.ts"

it("through the library's proxy, every paper ends as the model says, through any sequence", { timeout: 600_000 }, () => modelTest(true, 20261104))
