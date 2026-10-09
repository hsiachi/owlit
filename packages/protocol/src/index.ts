// Wire types shared by core and its clients. Types only, apart from small constant tables and pure
// rules both sides must agree on; nothing here may depend on Electron, React or the app.

export type * from "./chat.ts"
export type * from "./docs.ts"
export type * from "./library.ts"
export * from "./rpc.ts"
export * from "./workspace.ts"
export * from "./activity.ts"
export * from "./naming.ts"
export * from "./tasks.ts"
