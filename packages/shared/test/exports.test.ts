import { describe, expect, test } from "bun:test";

describe("package exports", () => {
	test("main export", async () => {
		const mod = await import("@secondlayer/shared");
		expect(mod).toBeDefined();
	});

	test("db export", async () => {
		const mod = await import("@secondlayer/shared/db");
		expect(mod).toBeDefined();
		expect(mod.getDb).toBeDefined();
	});

	test("db/queries/integrity export", async () => {
		const mod = await import("@secondlayer/shared/db/queries/integrity");
		expect(mod).toBeDefined();
	});

	test("db/queries/chain-reorgs export", async () => {
		const mod = await import("@secondlayer/shared/db/queries/chain-reorgs");
		expect(mod).toBeDefined();
		expect(mod.readChainReorgsForRange).toBeDefined();
	});

	test("db/queries/subgraphs export", async () => {
		const mod = await import("@secondlayer/shared/db/queries/subgraphs");
		expect(mod).toBeDefined();
	});

	test("db/queries/subscriptions export", async () => {
		const mod = await import("@secondlayer/shared/db/queries/subscriptions");
		expect(mod).toBeDefined();
	});

	test("db/schema export", async () => {
		const mod = await import("@secondlayer/shared/db/schema");
		expect(mod).toBeDefined();
	});

	test("queue/listener export", async () => {
		const mod = await import("@secondlayer/shared/queue/listener");
		expect(mod).toBeDefined();
	});

	test("schemas export", async () => {
		const mod = await import("@secondlayer/shared/schemas");
		expect(mod).toBeDefined();
	});

	test("schemas/subgraphs export", async () => {
		const mod = await import("@secondlayer/shared/schemas/subgraphs");
		expect(mod).toBeDefined();
	});

	test("schemas/subscriptions export", async () => {
		const mod = await import("@secondlayer/shared/schemas/subscriptions");
		expect(mod).toBeDefined();
		expect(mod.CreateSubscriptionRequestSchema).toBeDefined();
	});

	test("logger export", async () => {
		const mod = await import("@secondlayer/shared/logger");
		expect(mod).toBeDefined();
		expect(mod.logger).toBeDefined();
	});

	test("errors export", async () => {
		const mod = await import("@secondlayer/shared/errors");
		expect(mod).toBeDefined();
	});

	test("coverage export", async () => {
		const mod = await import("@secondlayer/shared/coverage");
		expect(mod.evaluateCoverage).toBeDefined();
		expect(mod.applyRunnerEvent).toBeDefined();
		expect(mod.planDecoderReceipts).toBeDefined();
		expect(mod.commitDecoderAdapter).toBeDefined();
		expect(mod.mergeRanges).toBeDefined();
		expect(mod.sealFinalizedRange).toBeDefined();
		expect(mod.hashEffectManifest).toBeDefined();
		expect(mod.commitSubgraphAdapter).toBeDefined();
		expect(mod.parseVerifyTarget).toBeDefined();
		expect(mod.planRepair).toBeDefined();
	});

	test("node export", async () => {
		const mod = await import("@secondlayer/shared/node");
		expect(mod).toBeDefined();
		expect(mod.StacksNodeClient).toBeDefined();
	});

	test("node/hiro-client export", async () => {
		const mod = await import("@secondlayer/shared/node/hiro-client");
		expect(mod).toBeDefined();
	});
});
