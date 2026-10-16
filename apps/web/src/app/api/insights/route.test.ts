import { afterEach, describe, expect, test } from "bun:test";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const [losing, willFail, costs] = FIXTURE_INSIGHTS.filter(
	(i) => i.severity !== "recovered",
);

function req(query = "", cookie = "sl_session=tok"): Request {
	return new Request(`http://localhost/api/insights${query}`, {
		headers: cookie ? { cookie } : {},
	});
}

function stubFetch(
	handler: (url: string) => Response | Promise<Response>,
): string[] {
	const urls: string[] = [];
	globalThis.fetch = (async (url: string) => {
		urls.push(String(url));
		return handler(String(url));
	}) as typeof fetch;
	return urls;
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status });

describe("insights merge route", () => {
	test("no session cookie is 401 and calls nothing", async () => {
		const urls = stubFetch(() => json({ data: [] }));
		const { GET } = await import("./route");
		const res = await GET(req("", ""));
		expect(res.status).toBe(401);
		expect(urls).toEqual([]);
	});

	test("merges both sides, prefixes ids, ranks worst first", async () => {
		stubFetch((url) =>
			url.includes("/api/accounts/insights")
				? json({ data: [costs] })
				: json({ data: [willFail, losing] }),
		);
		const { GET } = await import("./route");
		const body = (await (await GET(req())).json()) as {
			data: { id: string }[];
			sources: unknown;
		};
		expect(body.data.map((i) => i.id)).toEqual([
			`t:${losing.id}`,
			`t:${willFail.id}`,
			`a:${costs.id}`,
		]);
		expect(body.sources).toEqual({ stack: "ok", account: "ok" });
	});

	test("a stack outage leaves the account insights", async () => {
		stubFetch((url) =>
			url.includes("/api/accounts/insights")
				? json({ data: [costs] })
				: json({ error: "starting" }, 503),
		);
		const { GET } = await import("./route");
		const body = (await (await GET(req())).json()) as {
			data: { id: string }[];
			sources: unknown;
		};
		expect(body.data.map((i) => i.id)).toEqual([`a:${costs.id}`]);
		expect(body.sources).toEqual({ stack: "unavailable", account: "ok" });
	});

	test("an api without account routes (404) leaves the stack insights", async () => {
		stubFetch((url) =>
			url.includes("/api/accounts/insights")
				? json({ error: "Not found" }, 404)
				: json({ data: [losing] }),
		);
		const { GET } = await import("./route");
		const body = (await (await GET(req())).json()) as {
			data: { id: string }[];
			sources: unknown;
		};
		expect(body.data.map((i) => i.id)).toEqual([`t:${losing.id}`]);
		expect(body.sources).toEqual({ stack: "ok", account: "unavailable" });
	});

	test("the resource filter goes to the stack call only", async () => {
		const urls = stubFetch(() => json({ data: [] }));
		const { GET } = await import("./route");
		await GET(req("?resource=webhook:wh-deposits"));
		const stack = urls.find((u) => !u.includes("/api/accounts"));
		const account = urls.find((u) => u.includes("/api/accounts"));
		expect(stack).toContain("/api/insights?resource=webhook%3Awh-deposits");
		expect(account).not.toContain("resource");
	});
});
