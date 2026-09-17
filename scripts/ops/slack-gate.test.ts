import { describe, expect, it } from "bun:test";
import { PAGE_NOW_MIN, SEVERITY_MIN, decideGate } from "./slack-gate.ts";

describe("decideGate", () => {
	it("never posts without a webhook", () => {
		expect(
			decideGate({
				force: true,
				recovery: false,
				pageNow: 1,
				severity: 3,
				kind: "ingest_stall",
				hasWebhook: false,
			}).reason,
		).toBe("no_webhook");
	});

	it("force posts even when scores would drop", () => {
		const d = decideGate({
			force: true,
			recovery: false,
			pageNow: 0,
			severity: 0,
			kind: null,
			hasWebhook: true,
		});
		expect(d.post).toBe(true);
		expect(d.reason).toBe("force");
	});

	it("recovery posts without asking the model", () => {
		const d = decideGate({
			force: false,
			recovery: true,
			pageNow: null,
			severity: null,
			kind: null,
			hasWebhook: true,
		});
		expect(d.post).toBe(true);
		expect(d.reason).toBe("recovery");
	});

	it("fail-opens when classification is missing", () => {
		const d = decideGate({
			force: false,
			recovery: false,
			pageNow: null,
			severity: 3,
			kind: null,
			hasWebhook: true,
		});
		expect(d.post).toBe(true);
		expect(d.reason).toBe("fail_open");
	});

	it("posts at the documented threshold", () => {
		const d = decideGate({
			force: false,
			recovery: false,
			pageNow: PAGE_NOW_MIN,
			severity: SEVERITY_MIN,
			kind: "ingest_stall",
			hasWebhook: true,
		});
		expect(d.post).toBe(true);
		expect(d.reason).toBe("threshold");
	});

	it("drops a 502-shaped score", () => {
		const d = decideGate({
			force: false,
			recovery: false,
			pageNow: 0.49,
			severity: 2.28,
			kind: "deploy_window",
			hasWebhook: true,
		});
		expect(d.post).toBe(false);
		expect(d.reason).toBe("below_threshold");
	});

	it("drops decoder-unhealthy below the page line", () => {
		const d = decideGate({
			force: false,
			recovery: false,
			pageNow: 0.63,
			severity: 2.36,
			kind: "decoder_health",
			hasWebhook: true,
		});
		expect(d.post).toBe(false);
	});
});
