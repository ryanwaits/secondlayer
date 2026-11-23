export type Tone = "ok" | "alarm" | "hi" | "idle";

export function flagClass(tone: Tone): "att" | "fail" | null {
	if (tone === "alarm") return "fail";
	if (tone === "hi") return "att";
	return null;
}
