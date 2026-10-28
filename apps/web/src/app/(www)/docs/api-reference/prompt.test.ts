import { describe, expect, test } from "bun:test";
import { endpointPrompt, objectPrompt, promptParts } from "./prompt";
import {
	allEndpoints,
	findEndpoint,
	objectsByTag,
	returnedObject,
} from "./spec";

function endpoint(anchor: string) {
	const found = findEndpoint(anchor);
	if (!found) throw new Error(`no endpoint ${anchor}`);
	return found;
}

describe("agent prompt", () => {
	test("a list endpoint reads its markdown, pages by cursor, names its rows and ends there", () => {
		const prompt = endpointPrompt(endpoint("list-ft-transfers"));
		expect(prompt).toContain(
			"Read https://www.secondlayer.tools/docs/api-reference/list-ft-transfers.md first.",
		);
		expect(prompt).toContain("Call GET /v1/index/ft-transfers");
		expect(prompt).toContain("Bearer $SECONDLAYER_API_KEY");
		expect(prompt).toContain("next_cursor");
		expect(prompt).toContain("reorgs[]");
		expect(prompt).not.toContain("Task:");
	});

	test("a self-hosted endpoint authenticates with the instance token", () => {
		const prompt = endpointPrompt(endpoint("list-webhooks"));
		expect(prompt).toContain("Bearer $INSTANCE_TOKEN");
		expect(prompt).not.toContain("$SECONDLAYER_API_KEY");
	});

	test("a single read does not ask for paging", () => {
		const single = allEndpoints().find((e) => {
			const returned = returnedObject(e.op);
			return returned && !returned.list;
		});
		expect(single).toBeDefined();
		const prompt = endpointPrompt(single as NonNullable<typeof single>);
		expect(prompt).not.toContain("next_cursor");
		expect(prompt).toContain("Returns one");
	});

	test("an object prompt names the endpoints that return it", () => {
		const [first] = [...objectsByTag().values()].flat();
		const prompt = objectPrompt(first);
		expect(prompt).toContain(`${first.anchor}.md`);
		expect(prompt).toContain(first.returnedBy[0].path);
	});

	test("prompt parts shorten the markdown URL to its file name and keep the link", () => {
		const parts = promptParts(endpointPrompt(endpoint("list-ft-transfers")));
		const link = parts.find((p) => p.text === "list-ft-transfers.md");
		expect(link).toBeDefined();
		expect(link?.href?.endsWith("/list-ft-transfers.md")).toBe(true);
	});

	test("prompt parts join back to the copied text", () => {
		const prompt = endpointPrompt(endpoint("list-ft-transfers"));
		const joined = promptParts(prompt)
			.map((p) => p.href ?? p.text)
			.join("");
		expect(joined).toBe(prompt);
	});
});
