import {
	type Endpoint,
	type ObjectEntry,
	objectName,
	returnedObject,
} from "./spec";

const SITE = "https://www.secondlayer.tools";

export function markdownUrl(anchor: string): string {
	return `${SITE}/docs/api-reference/${anchor}.md`;
}

export function endpointPrompt(endpoint: Endpoint): string {
	const token = endpoint.selfHostOnly
		? "$INSTANCE_TOKEN"
		: "$SECONDLAYER_API_KEY";
	const returned = returnedObject(endpoint.op);
	const lines = [
		`Read ${markdownUrl(endpoint.anchor)} first.`,
		`Call ${endpoint.method} ${endpoint.path} on the Secondlayer API (SECONDLAYER_API_URL, Authorization: Bearer ${token}).`,
	];
	if (returned?.list) {
		lines.push(
			"Page with next_cursor until it is null; undo rows named in reorgs[].",
			`Rows are ${objectName(returned.name)} objects.`,
		);
	} else if (returned) {
		lines.push(`Returns one ${objectName(returned.name)} object.`);
	}
	return lines.join("\n");
}

export function objectPrompt(entry: ObjectEntry): string {
	return [
		`Read ${markdownUrl(entry.anchor)} first.`,
		`It describes the ${objectName(entry.name)} object, returned by ${entry.returnedBy.map((e) => `${e.method} ${e.path}`).join(", ")}.`,
	].join("\n");
}

export type PromptPart = { text: string; href?: string; strong?: boolean };

const PROMPT_TOKENS =
	/(https:\/\/www\.secondlayer\.tools\/docs\/api-reference\/[\w.-]+\.md|\$?SECONDLAYER_API_(?:KEY|URL)|\$INSTANCE_TOKEN)/;

export function promptParts(text: string): PromptPart[] {
	return text
		.split(PROMPT_TOKENS)
		.filter((part) => part !== "")
		.map((part) => {
			if (part.startsWith("https://"))
				return { text: part.slice(part.lastIndexOf("/") + 1), href: part };
			if (part.includes("SECONDLAYER_API_") || part === "$INSTANCE_TOKEN")
				return { text: part, strong: true };
			return { text: part };
		});
}
