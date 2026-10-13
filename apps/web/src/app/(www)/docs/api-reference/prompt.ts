import {
	type Endpoint,
	type ObjectEntry,
	objectName,
	returnedObject,
} from "./spec";

const SITE = "https://secondlayer.tools";

/** The endpoint's markdown twin: what an agent should read before calling it. */
export function markdownUrl(anchor: string): string {
	return `${SITE}/docs/api-reference/${anchor}.md`;
}

/**
 * A prompt to hand a coding agent for one endpoint: read the markdown, call
 * it with the right base and credential, and what to expect back. Plain text,
 * pasted as-is.
 */
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
	lines.push("Task: <what you want built with this data>");
	return lines.join("\n");
}

/** The same for an object: what it is and which endpoints return it. */
export function objectPrompt(entry: ObjectEntry): string {
	return [
		`Read ${markdownUrl(entry.anchor)} first.`,
		`It describes the ${objectName(entry.name)} object, returned by ${entry.returnedBy.map((e) => `${e.method} ${e.path}`).join(", ")}.`,
		"Task: <what you want built with this data>",
	].join("\n");
}
