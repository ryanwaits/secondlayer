export type OutputTone = "err" | "ok" | "head" | "out";

/**
 * What a line of terminal output says decides its color, never its token
 * type: warnings and errors alarm, checks are ok, ALL-CAPS table headers fade,
 * everything else is quiet.
 */
export function outputTone(line: string): OutputTone {
	if (/^\s*(⚠|✗|error\b)/i.test(line)) return "err";
	if (/^\s*✓/.test(line)) return "ok";
	if (/^[A-Z][A-Z _]{3,}$/.test(line.trim())) return "head";
	return "out";
}
