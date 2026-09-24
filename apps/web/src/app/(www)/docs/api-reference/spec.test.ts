import { describe, expect, test } from "bun:test";
import nav from "@/generated/openapi-nav.json";
import {
	type Endpoint,
	allEndpoints,
	curlFor,
	endpointMarkdown,
	findEndpoint,
	kebab,
	objectTitle,
	objectsByTag,
	referenceMarkdown,
	responseExample,
} from "./spec";

function endpoint(anchor: string): Endpoint {
	const found = findEndpoint(anchor);
	if (!found) throw new Error(`no endpoint #${anchor}`);
	return found;
}

describe("anchors", () => {
	test("operationIds become kebab anchors", () => {
		expect(kebab("listPox5Events")).toBe("list-pox5-events");
		expect(kebab("getOpenApiSpec")).toBe("get-open-api-spec");
		expect(kebab("listSbtcEvents")).toBe("list-sbtc-events");
	});

	test("every endpoint and object anchor is unique on the page", () => {
		const anchors = [
			...allEndpoints().map((e) => e.anchor),
			...[...objectsByTag().values()].flat().map((o) => o.anchor),
		];
		expect(new Set(anchors).size).toBe(anchors.length);
	});

	test("the sidebar's generated tree lists the same anchors as the page", () => {
		const fromNav = nav.flatMap((g) => g.endpoints.map((e) => e.anchor)).sort();
		const fromPage = allEndpoints()
			.map((e) => e.anchor)
			.sort();
		expect(fromNav).toEqual(fromPage);
	});

	test("the sidebar's generated tree lists each tag's objects as the page does", () => {
		const objects = objectsByTag();
		for (const group of nav) {
			expect(group.objects).toEqual(
				(objects.get(group.tag) ?? []).map((o) => ({
					anchor: o.anchor,
					title: objectTitle(o.name),
				})),
			);
		}
	});
});

describe("examples", () => {
	test("every list endpoint's response assembles into an envelope with a row", () => {
		const body = responseExample(endpoint("list-pox5-events").op) as {
			events: unknown[];
		};
		expect(body.events).toHaveLength(1);
	});

	test("every object some endpoint returns has an example to show", () => {
		const missing = [...objectsByTag().values()]
			.flat()
			.filter((o) => o.schema.example === undefined)
			.map((o) => o.name);
		expect(missing).toEqual([]);
	});
});

describe("cURL", () => {
	const pox5 = () => endpoint("list-pox5-events");

	test("hosted reads send the account key", () => {
		const curl = curlFor(pox5(), "hosted");
		expect(curl).toContain(
			"https://api.secondlayer.tools/v1/index/pox5/events",
		);
		expect(curl).toContain("$SECONDLAYER_API_KEY");
	});

	test("a local read on the loopback bind needs no token", () => {
		const curl = curlFor(pox5(), "local");
		expect(curl).toContain("http://127.0.0.1:3800/v1/index/pox5/events");
		expect(curl).not.toContain("Authorization");
	});

	test("self-hosted-only endpoints ignore the hosted choice", () => {
		const create = endpoint("create-webhook");
		expect(create.selfHostOnly).toBe(true);
		const curl = curlFor(create, "hosted");
		expect(curl).toContain("http://127.0.0.1:3800/api/webhooks");
		expect(curl).toContain("$INSTANCE_TOKEN");
	});

	test("paging params never appear in a generated request", () => {
		for (const e of allEndpoints()) {
			expect(curlFor(e, "hosted")).not.toMatch(/-d (cursor|from_cursor)=/);
		}
	});
});

describe("markdown", () => {
	test("one endpoint's markdown carries its route, params, and example", () => {
		const md = endpointMarkdown(endpoint("list-pox5-events"));
		expect(md).toContain("`GET /v1/index/pox5/events`");
		expect(md).toContain("| `signer_manager` |");
		expect(md).toContain("```bash");
	});

	test("the full reference names every endpoint", () => {
		const md = referenceMarkdown();
		for (const e of allEndpoints()) {
			expect(md).toContain(`\`${e.method} ${e.path}\``);
		}
	});
});
