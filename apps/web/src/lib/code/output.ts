export type OutputTone = "err" | "ok" | "head" | "out";

export function outputTone(line: string): OutputTone {
	if (/^\s*(⚠|✗|error\b)/i.test(line)) return "err";
	if (/^\s*✓/.test(line)) return "ok";
	if (/^[A-Z][A-Z _]{3,}$/.test(line.trim())) return "head";
	return "out";
}
