import { afterEach, describe, expect, mock, test } from "bun:test";
import { Projects } from "./client.ts";

const BASE_URL = "http://localhost:3800";
const originalFetch = globalThis.fetch;

/** Mock fetch that records each (method, path) and returns a fixed JSON body. */
function recorder(body: unknown = {}) {
	const calls: Array<{ method: string; path: string; body: unknown }> = [];
	globalThis.fetch = mock(
		(input: string | URL | Request, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			calls.push({
				method: init?.method ?? "GET",
				path: url.slice(BASE_URL.length),
				body: init?.body ? JSON.parse(init.body as string) : undefined,
			});
			return Promise.resolve({
				ok: true,
				status: 200,
				headers: new Headers({ "content-type": "application/json" }),
				json: () => Promise.resolve(body),
				text: () => Promise.resolve(JSON.stringify(body)),
			} as Response);
		},
	) as unknown as typeof fetch;
	return calls;
}

describe("Projects client", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("list → GET /api/projects", async () => {
		const calls = recorder({ projects: [] });
		await new Projects({ baseUrl: BASE_URL }).list();
		expect(calls).toEqual([
			{ method: "GET", path: "/api/projects", body: undefined },
		]);
	});

	test("get → GET /api/projects/:slug", async () => {
		const calls = recorder();
		await new Projects({ baseUrl: BASE_URL }).get("my-app");
		expect(calls[0]).toMatchObject({
			method: "GET",
			path: "/api/projects/my-app",
		});
	});

	test("create → POST /api/projects with body", async () => {
		const calls = recorder();
		await new Projects({ baseUrl: BASE_URL }).create({
			name: "My App",
			slug: "my-app",
		});
		expect(calls[0]).toEqual({
			method: "POST",
			path: "/api/projects",
			body: { name: "My App", slug: "my-app" },
		});
	});

	test("update → PATCH /api/projects/:slug (slug in body renames)", async () => {
		const calls = recorder();
		await new Projects({ baseUrl: BASE_URL }).update("my-app", {
			slug: "renamed",
		});
		expect(calls[0]).toEqual({
			method: "PATCH",
			path: "/api/projects/my-app",
			body: { slug: "renamed" },
		});
	});

	test("delete → DELETE /api/projects/:slug", async () => {
		const calls = recorder({ ok: true });
		await new Projects({ baseUrl: BASE_URL }).delete("my-app");
		expect(calls[0]).toMatchObject({
			method: "DELETE",
			path: "/api/projects/my-app",
		});
	});

	test("team → GET /api/projects/:slug/team", async () => {
		const calls = recorder({ members: [], invitations: [] });
		await new Projects({ baseUrl: BASE_URL }).team("my-app");
		expect(calls[0]).toMatchObject({
			method: "GET",
			path: "/api/projects/my-app/team",
		});
	});
});
