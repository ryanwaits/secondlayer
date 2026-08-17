import { describe, expect, test } from "bun:test";
import {
	type PublicStatus,
	diagnoseInstanceStatus,
	explainContextNulls,
} from "./instance-diagnosis.ts";

/** A freshly self-hosted instance: up, reachable, zero blocks. */
const freshInstance: PublicStatus = {
	status: "degraded",
	chainTip: null,
	chainIntegrity: { ok: true, maxHeight: 0, reason: null },
	streams: { status: "unavailable", tip: null },
	index: {
		status: "unavailable",
		decoders: Array.from({ length: 8 }, (_, i) => ({
			decoder: `decode.d${i}.v1`,
			status: "unavailable",
		})),
	},
	services: [
		{ name: "api", status: "ok" },
		{ name: "database", status: "ok" },
		{ name: "indexer", status: "ok" },
		{ name: "decoder", status: "unavailable" },
	],
};

describe("diagnoseInstanceStatus", () => {
	test("an instance with no blocks gets its own named state, not a bare DEGRADED", () => {
		const diagnosis = diagnoseInstanceStatus(freshInstance);
		expect(diagnosis.state).toBe("empty-index");
		expect(diagnosis.issues).toHaveLength(1);
		const [issue] = diagnosis.issues;
		expect(issue?.title).toContain("No blocks indexed yet");
		expect(issue?.detail).toContain("8 decoders report unavailable");
		expect(issue?.detail).toContain("expected state for a fresh instance");
	});

	test("the empty-index remedy names the exact command to run", () => {
		const [issue] = diagnoseInstanceStatus(freshInstance).issues;
		expect(issue?.nextSteps[0]).toContain(
			"secondlayer bootstrap --against <manifest>",
		);
		expect(issue?.nextSteps.join("\n")).toContain("secondlayer observer");
	});

	test("a degraded API always yields at least one issue, so doctor cannot report all-clear while status reports DEGRADED", () => {
		const withoutServices: PublicStatus = {
			status: "degraded",
			chainTip: 8_000_000,
			chainIntegrity: { ok: true, maxHeight: 8_000_000, reason: null },
			services: [{ name: "api", status: "ok" }],
		};
		const diagnosis = diagnoseInstanceStatus(withoutServices);
		expect(diagnosis.state).toBe("degraded");
		expect(diagnosis.issues).not.toHaveLength(0);
	});

	test("an unexplained degradation says so instead of inventing a cause", () => {
		const [issue] = diagnoseInstanceStatus({
			status: "degraded",
			chainTip: 8_000_000,
			chainIntegrity: { ok: true, maxHeight: 8_000_000 },
			services: [{ name: "api", status: "ok" }],
		}).issues;
		expect(issue?.title).toContain("names no failing service");
		expect(issue?.nextSteps.join("\n")).toContain("secondlayer status --json");
	});

	test("each failing service becomes its own issue", () => {
		const diagnosis = diagnoseInstanceStatus({
			status: "degraded",
			chainTip: 8_000_000,
			chainIntegrity: { ok: true, maxHeight: 8_000_000 },
			services: [
				{ name: "api", status: "ok" },
				{ name: "indexer", status: "unavailable" },
				{ name: "decoder", status: "degraded" },
			],
		});
		expect(diagnosis.issues.map((i) => i.title)).toEqual([
			"Service indexer reports unavailable.",
			"Service decoder reports degraded.",
		]);
	});

	test("a failed integrity check is reported with the API's own reason", () => {
		const diagnosis = diagnoseInstanceStatus({
			status: "degraded",
			chainTip: 8_000_000,
			chainIntegrity: {
				ok: false,
				maxHeight: 8_000_000,
				reason: "tip is 8000000 but no canonical blocks near 7500000",
			},
			services: [{ name: "api", status: "ok" }],
		});
		expect(diagnosis.issues[0]?.detail).toContain("no canonical blocks near");
		expect(diagnosis.issues[0]?.nextSteps[0]).toContain(
			"secondlayer verify all",
		);
	});

	test("an integrity check that could not run is never read as an empty index", () => {
		// The API substitutes maxHeight 0 when the query itself failed; calling
		// that "no blocks indexed" would assert a fact nobody measured.
		const diagnosis = diagnoseInstanceStatus({
			status: "degraded",
			chainTip: null,
			chainIntegrity: { ok: true, maxHeight: 0, reason: "check_failed" },
			services: [{ name: "database", status: "unavailable" }],
		});
		expect(diagnosis.state).toBe("degraded");
		expect(diagnosis.issues[0]?.title).toContain("database");
	});

	test("a healthy instance produces no issues", () => {
		const diagnosis = diagnoseInstanceStatus({
			status: "healthy",
			chainTip: 8_000_000,
			chainIntegrity: { ok: true, maxHeight: 8_000_000 },
			services: [
				{ name: "api", status: "ok" },
				{ name: "database", status: "ok" },
			],
		});
		expect(diagnosis).toMatchObject({ state: "healthy", issues: [] });
	});
});

const allNull = {
	account: null,
	streamsTip: null,
	indexTip: null,
	subgraphs: null,
	subscriptions: null,
	activeOperations: null,
};

describe("explainContextNulls", () => {
	test("a null account on a self-hosted instance is explained as normal", () => {
		const { nulls } = explainContextNulls(
			{ ...allNull, subgraphs: [], subscriptions: { count: 0, byStatus: {} } },
			{
				apiUrl: "http://127.0.0.1:3800",
				selfHosted: true,
				hasCredential: true,
				status: freshInstance,
			},
		);
		expect(nulls.account).toContain("no account system");
		expect(nulls.account).toContain("normal and not a failure");
	});

	test("a null account on the metered deployment points at login", () => {
		const { nulls } = explainContextNulls(allNull, {
			apiUrl: "https://api.secondlayer.tools",
			selfHosted: false,
			hasCredential: false,
			status: { status: "healthy", chainIntegrity: { ok: true, maxHeight: 9 } },
		});
		expect(nulls.account).toContain("secondlayer login");
	});

	test("null tips on an unindexed instance name the bootstrap command", () => {
		const { summary, nulls } = explainContextNulls(allNull, {
			apiUrl: "http://127.0.0.1:3800",
			selfHosted: true,
			hasCredential: true,
			status: freshInstance,
		});
		expect(nulls.streamsTip).toContain("No blocks indexed yet");
		expect(nulls.indexTip).toContain(
			"secondlayer bootstrap --against <manifest>",
		);
		expect(summary).toContain("holds 0 blocks");
	});

	test("an unreachable instance explains every null with the endpoint that did not answer", () => {
		const { summary, nulls } = explainContextNulls(allNull, {
			apiUrl: "http://127.0.0.1:3800",
			selfHosted: true,
			hasCredential: true,
			status: null,
			statusError: "connection refused",
		});
		expect(summary).toContain("docker compose up -d");
		for (const field of Object.keys(allNull)) {
			expect(nulls[field]).toContain("No instance answered at");
			expect(nulls[field]).toContain("connection refused");
		}
	});

	test("a reachable, indexed instance returning nothing points at the missing credential", () => {
		const { nulls } = explainContextNulls(
			{ ...allNull, account: {} },
			{
				apiUrl: "http://127.0.0.1:3800",
				selfHosted: true,
				hasCredential: false,
				status: {
					status: "healthy",
					chainTip: 8_000_000,
					chainIntegrity: { ok: true, maxHeight: 8_000_000 },
				},
			},
		);
		expect(nulls.subgraphs).toContain("indexed to block 8000000");
		expect(nulls.subgraphs).toContain("export INSTANCE_TOKEN");
	});

	test("unprobed operations are distinguished from a failed read", () => {
		const { nulls } = explainContextNulls(
			{ ...allNull, streamsTip: {}, indexTip: {} },
			{
				apiUrl: "http://127.0.0.1:3800",
				selfHosted: true,
				hasCredential: true,
				status: {
					status: "healthy",
					chainTip: 8_000_000,
					chainIntegrity: { ok: true, maxHeight: 8_000_000 },
				},
			},
		);
		expect(nulls.activeOperations).toContain(
			"the subgraph list did not resolve",
		);
	});

	test("a fully resolved snapshot needs no explanation", () => {
		const { summary, nulls } = explainContextNulls(
			{
				account: {},
				streamsTip: {},
				indexTip: {},
				subgraphs: [],
				subscriptions: {},
				activeOperations: [],
			},
			{
				apiUrl: "http://127.0.0.1:3800",
				selfHosted: true,
				hasCredential: true,
				status: null,
			},
		);
		expect(nulls).toEqual({});
		expect(summary).toBe("Every field resolved.");
	});
});
