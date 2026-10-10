import type { Connector } from "../types"

// An agent that signs in inside owlit (the Owlit engine) and isn't signed in yet: it needs the user, but
// isn't broken
export const needsSignIn = (c: Connector) => !!c.signInMethods?.length && c.authenticated === false
