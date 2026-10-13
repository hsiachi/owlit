// A .po catalog, as the bundlers' Lingui plugins hand it over: its messages compiled
declare module "*.po" {
  export const messages: import("@lingui/core").Messages
}
