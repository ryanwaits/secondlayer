import { describe, expect, it } from "bun:test";
import { decideIntegrityAlert } from "./integrity-alert.ts";

describe("decideIntegrityAlert", () => {
	it("pages gaps_unfillable", () => {
		const d = decideIntegrityAlert({
			status: "gaps_unfillable",
			hadIncident: false,
			fetchOk: true,
		});
		expect(d.action).toBe("page");
		expect(d.reason).toBe("force");
	});

	it("pages gaps_unfillable even when a prior incident exists", () => {
		const d = decideIntegrityAlert({
			status: "gaps_unfillable",
			hadIncident: true,
			fetchOk: true,
		});
		expect(d.action).toBe("page");
		expect(d.reason).toBe("force");
	});

	it("pages chain_unlinked", () => {
		const d = decideIntegrityAlert({
			status: "chain_unlinked",
			hadIncident: false,
			fetchOk: true,
		});
		expect(d.action).toBe("page");
		expect(d.reason).toBe("force");
	});

	it("pages chain_unlinked even when a prior incident exists", () => {
		const d = decideIntegrityAlert({
			status: "chain_unlinked",
			hadIncident: true,
			fetchOk: true,
		});
		expect(d.action).toBe("page");
		expect(d.reason).toBe("force");
	});

	it("recovers healthy after an incident", () => {
		const d = decideIntegrityAlert({
			status: "healthy",
			hadIncident: true,
			fetchOk: true,
		});
		expect(d.action).toBe("recovery");
		expect(d.reason).toBe("recovery");
	});

	it("stays quiet on healthy with no prior incident", () => {
		const d = decideIntegrityAlert({
			status: "healthy",
			hadIncident: false,
			fetchOk: true,
		});
		expect(d.action).toBe("quiet");
		expect(d.reason).toBe("healthy_clean");
	});

	it("stays quiet on gaps_detected", () => {
		const d = decideIntegrityAlert({
			status: "gaps_detected",
			hadIncident: false,
			fetchOk: true,
		});
		expect(d.action).toBe("quiet");
		expect(d.reason).toBe("in_progress");
	});

	it("stays quiet on degraded", () => {
		const d = decideIntegrityAlert({
			status: "degraded",
			hadIncident: true,
			fetchOk: true,
		});
		expect(d.action).toBe("quiet");
		expect(d.reason).toBe("in_progress");
	});

	it("stays quiet when fetch fails even if status looks unfillable", () => {
		const d = decideIntegrityAlert({
			status: "gaps_unfillable",
			hadIncident: false,
			fetchOk: false,
		});
		expect(d.action).toBe("quiet");
		expect(d.reason).toBe("fetch_failed");
	});

	it("stays quiet when status is missing", () => {
		const d = decideIntegrityAlert({
			status: undefined,
			hadIncident: false,
			fetchOk: true,
		});
		expect(d.action).toBe("quiet");
		expect(d.reason).toBe("unknown_status");
	});

	it("stays quiet on unknown status", () => {
		const d = decideIntegrityAlert({
			status: "mystery",
			hadIncident: false,
			fetchOk: true,
		});
		expect(d.action).toBe("quiet");
		expect(d.reason).toBe("unknown_status");
	});
});
