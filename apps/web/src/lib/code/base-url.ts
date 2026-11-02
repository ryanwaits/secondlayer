/** The two bases an example can target. The API reference's Base URL switch picks one for the whole page. */
export const HOSTED_BASE = "https://api.secondlayer.tools";
export const LOCAL_BASE = "http://127.0.0.1:3800";

export type Base = "hosted" | "local";

/** The credential placeholder shell samples carry; a signed-in reader's docs key replaces it. */
export const KEY_VAR = "$SECONDLAYER_API_KEY";

/** The same credential in an SDK sample; the docs key replaces it as a string literal. */
export const KEY_EXPR = "process.env.SECONDLAYER_API_KEY";

/** Every placeholder a docs key can fill. */
export const KEY_PLACEHOLDERS = [KEY_VAR, KEY_EXPR] as const;

/**
 * A sample that calls anything a docs key is refused on (Streams and Index are
 * all it reads): the `/api/*` management plane, subgraphs, feedback, and their
 * SDK namespaces. Filling the key in would hand the reader a failing command.
 */
const DOCS_KEY_REFUSED =
	/\/api\/|\/v1\/(?:subgraphs|feedback)\b|\.(?:webhooks|subgraphs|archive|feedback)\./;

/** Whether a sample can run with a docs key in place of its credential. */
export const docsKeyCanRun = (source: string) => !DOCS_KEY_REFUSED.test(source);

/**
 * What changes between the bases: the origin and the credential an example
 * names. Hosted first, self-hosted second; a fence with the `base` option
 * wraps every hosted value so the switch can rewrite it in place.
 */
export const BASE_SWAPS = [
	[HOSTED_BASE, LOCAL_BASE],
	[KEY_VAR, "$INSTANCE_TOKEN"],
] as const;

/** The `BASE_SWAPS` entry that holds the credential. */
export const KEY_SWAP = 1;
