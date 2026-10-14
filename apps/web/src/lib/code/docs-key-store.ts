/** Where a signed-in reader's docs key lives for the tab (sessionStorage, never a cookie or a URL). */
export const DOCS_KEY_STORE = "sl-docs-key";

/** Fired on sign-out so a loaded key module drops the key it holds in memory. */
export const DOCS_KEY_FORGET = "sl-docs-key-forget";
