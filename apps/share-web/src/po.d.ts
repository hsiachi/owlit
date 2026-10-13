// A .po catalog, as Lingui's Vite plugin hands it over: its messages compiled
declare module "*.po" {
  export const messages: import("@lingui/core").Messages
}
