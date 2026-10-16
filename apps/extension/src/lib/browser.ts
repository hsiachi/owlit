// The extension APIs, answering with promises in every browser. Chromium's chrome.* returns a promise when
// no callback is given; Firefox's chrome.* is a porting alias that takes callbacks, and only its browser.*
// returns promises. The two share Chrome's shapes for everything the extension uses, hence Chrome's types.
// Read off globalThis so that importing this outside a browser (the tests) finds neither and throws nothing.
const scope = globalThis as { browser?: typeof chrome; chrome?: typeof chrome }
export const ext = (scope.browser ?? scope.chrome) as typeof chrome
