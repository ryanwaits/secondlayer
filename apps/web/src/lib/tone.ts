/**
 * The one tone vocabulary for dashboard rows. Healthy and neutral states
 * (`ok`, `idle`) show nothing; `hi` is attention and `alarm` is failing.
 */
export type Tone = "ok" | "alarm" | "hi" | "idle";

/** The class a flagged row or value carries; null shows nothing. */
export function flagClass(tone: Tone): "att" | "fail" | null {
	if (tone === "alarm") return "fail";
	if (tone === "hi") return "att";
	return null;
}
