/** The two bases an example can target. The API reference's Base URL switch picks one for the whole page. */
export const HOSTED_BASE = "https://api.secondlayer.tools";
export const LOCAL_BASE = "http://127.0.0.1:3800";

export type Base = "hosted" | "local";

/**
 * What changes between the bases: the origin and the credential an example
 * names. Hosted first, self-hosted second; a fence with the `base` option
 * wraps every hosted value so the switch can rewrite it in place.
 */
export const BASE_SWAPS = [
	[HOSTED_BASE, LOCAL_BASE],
	["$SECONDLAYER_API_KEY", "$INSTANCE_TOKEN"],
] as const;
