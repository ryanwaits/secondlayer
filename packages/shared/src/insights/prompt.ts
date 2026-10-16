/**
 * Hand-off prompt helpers. A prompt tells the developer's coding agent what we
 * saw (names, times, counts, error text) and what to look at, in plain words.
 * It never contains code and never asks the agent to read the user's source.
 */

export function handoffPrompt(parts: {
	/** `My Secondlayer webhook "mint-alerts"` */
	subject: string;
	/** Plain facts with numbers and UTC times. The first one continues the
	 *  subject ("has been failing since 16:06 UTC"); the rest are sentences. */
	observed: string[];
	/** What to check, in words. */
	lookAt: string;
	/** Optional follow-up naming an `sl` command. */
	followUp?: string;
}): string {
	const sentence = (text: string) => {
		const trimmed = text.trim().replace(/[.\s]+$/, "");
		return trimmed.length > 0 ? `${trimmed}.` : "";
	};
	const [first = "", ...rest] = parts.observed;
	const sentences = [
		sentence(`${parts.subject} ${first}`),
		...rest.map(sentence),
		sentence(parts.lookAt),
		parts.followUp ? sentence(parts.followUp) : "",
	];
	return sentences.filter((s) => s.length > 0).join(" ");
}

/**
 * Receiver and handler text is untrusted and often JSON or HTML. Collapse it
 * to one plain line with no braces, backticks or arrows so it can sit inside
 * a prompt or a body sentence.
 */
export function plainSnippet(
	text: string | null | undefined,
	max = 80,
): string {
	if (!text) return "";
	const flat = text
		.replace(/<[^>]*>/g, " ")
		.replace(/=>/g, "->")
		.replace(/[`{}$\\]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}...` : flat;
}

/** "16:06 UTC" */
export function utcTime(date: Date): string {
	return `${date.toISOString().slice(11, 16)} UTC`;
}

/** "Oct 15 16:06 UTC" */
export function utcDateTime(date: Date): string {
	const month = date.toLocaleString("en-US", {
		month: "short",
		timeZone: "UTC",
	});
	return `${month} ${date.getUTCDate()} ${utcTime(date)}`;
}

/** "Oct 15" */
export function utcDay(date: Date): string {
	const month = date.toLocaleString("en-US", {
		month: "short",
		timeZone: "UTC",
	});
	return `${month} ${date.getUTCDate()}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
	return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** The host of a URL, or the input when it does not parse. */
export function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}
