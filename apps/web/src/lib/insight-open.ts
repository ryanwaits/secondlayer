export const OPEN_COOKIE = "sl_insight_open";
const MAX_ENTRIES = 40;
const MAX_AGE_S = 90 * 24 * 60 * 60;

export type OpenChoices = Readonly<Record<string, boolean>>;

export function serializeOpenChoices(choices: OpenChoices): string {
	const kept = Object.entries(choices).slice(-MAX_ENTRIES);
	return encodeURIComponent(
		kept.map(([id, open]) => `${id}:${open ? 1 : 0}`).join("~"),
	);
}

export function parseOpenChoices(raw: string | null | undefined): OpenChoices {
	if (!raw) return {};
	let text = raw;
	try {
		text = decodeURIComponent(raw);
	} catch {}
	const out: Record<string, boolean> = {};
	for (const part of text.split("~")) {
		const at = part.lastIndexOf(":");
		const flag = part.slice(at + 1);
		if (at < 1 || (flag !== "1" && flag !== "0")) continue;
		out[part.slice(0, at)] = flag === "1";
	}
	return out;
}

export function writeOpenChoices(choices: OpenChoices): void {
	try {
		const secure = window.location.protocol === "https:" ? "; Secure" : "";
		document.cookie = `${OPEN_COOKIE}=${serializeOpenChoices(choices)}; path=/account; max-age=${MAX_AGE_S}; SameSite=Lax${secure}`;
	} catch {}
}

type OpenInput = { id: string; severity: string };

const opensByDefault = (i: OpenInput): boolean =>
	i.severity === "losing" || i.severity === "will_fail";

export function lineOpen(
	insights: readonly OpenInput[],
	saved: OpenChoices,
): boolean {
	return insights.some((i) => saved[i.id] ?? opensByDefault(i));
}
