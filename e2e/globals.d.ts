// Inside page.evaluate() the tests reach into the running app (window.__app, window.__testing) and stash
// helpers on window. Those shapes are the app's own types; here they are left open on purpose.
interface Window {
  // biome-ignore lint/suspicious/noExplicitAny: test-only access to page globals
  [key: string]: any;
}
