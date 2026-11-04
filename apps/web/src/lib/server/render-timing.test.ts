import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RequestTiming, redactPath } from "./render-timing";

function clock(values: number[]): () => number {
	let i = 0;
	return () => values[Math.min(i++, values.length - 1)];
}

describe("RequestTiming", () => {
	test("coldStart is true for the first request on an instance, then false", async () => {
		// A query string loads a second copy of the module: a fresh instance.
		const specifier = "./render-timing?fresh-instance";
		const mod = (await import(specifier)) as typeof import("./render-timing");
		expect(new mod.RequestTiming().coldStart).toBe(true);
		expect(new mod.RequestTiming().coldStart).toBe(false);
		expect(new mod.RequestTiming().coldStart).toBe(false);
	});

	test("steps record duration and start offset from the request", async () => {
		// origin, step start, step end, mark, report total
		const timing = new RequestTiming(clock([100, 110, 135.04, 140, 150]));
		timing.enableFrom({ timing: "1" });
		await timing.step("reads", async () => "ok", { blocks: 2 });
		timing.mark("render");
		const report = await timing.report();
		expect(report?.steps).toEqual([
			{ label: "reads", startMs: 10, ms: 25, detail: { blocks: 2 } },
			{ label: "render", startMs: 40, ms: 0 },
		]);
		expect(report?.totalMs).toBe(50);
	});

	test("a step rejects as its work does and still records", async () => {
		const timing = new RequestTiming(clock([0, 0, 5]));
		timing.enableFrom({ timing: "1" });
		await expect(
			timing.step("boom", async () => {
				throw new Error("nope");
			}),
		).rejects.toThrow("nope");
		expect((await timing.report())?.steps[0].ms).toBe(5);
	});

	test("emits nothing without the timing flag", async () => {
		for (const params of [{}, { timing: "0" }, { timing: "true" }]) {
			const timing = new RequestTiming();
			timing.enableFrom(params);
			await timing.step("reads", async () => 1);
			expect(await timing.report()).toBeNull();
			expect(await timing.script()).toBeNull();
		}
	});

	test("the script holds the report as JSON and cannot close its tag", async () => {
		const timing = new RequestTiming();
		timing.enableFrom({ timing: ["1"] });
		await timing.step("a</script>b", async () => 1);
		const script = await timing.script();
		expect(script).not.toBeNull();
		if (!script) return;
		const html = renderToStaticMarkup(script);
		expect(
			html.startsWith('<script type="application/json" id="sl-render-timing">'),
		).toBe(true);
		expect(html.match(/<\/script>/g)).toHaveLength(1);
		const json = html.slice(
			html.indexOf(">") + 1,
			html.lastIndexOf("</script>"),
		);
		expect(JSON.parse(json).steps[0].label).toBe("a</script>b");
	});

	test("the report waits for steps another component started", async () => {
		const timing = new RequestTiming();
		timing.enableFrom({ timing: "1" });
		const gate = Promise.withResolvers<void>();
		const layout = timing.step("layout:billing", () => gate.promise);
		const pending = timing.report();
		gate.resolve();
		await layout;
		expect((await pending)?.steps[0].ms).not.toBeNull();
	});
});

describe("redactPath", () => {
	test("ids, names, tables and queries become :id", () => {
		expect(redactPath("/api/webhooks/wh_123/deliveries")).toBe(
			"/api/webhooks/:id/deliveries",
		);
		expect(redactPath("/api/subgraphs/my-subgraph/health?hours=168")).toBe(
			"/api/subgraphs/:id/health",
		);
		expect(redactPath("/v1/subgraphs/my-subgraph/transfers?limit=5")).toBe(
			"/v1/subgraphs/:id/:id",
		);
	});

	test("fixed routes keep their shape", () => {
		expect(redactPath("/api/billing/usage?month=2026-11")).toBe(
			"/api/billing/usage",
		);
		expect(redactPath("/api/webhooks/activity")).toBe("/api/webhooks/activity");
		expect(redactPath("/api/accounts/insights")).toBe("/api/accounts/insights");
	});
});
