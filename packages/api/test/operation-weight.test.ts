import { afterAll, describe, expect, test } from "bun:test";
import { getSourceDb } from "@secondlayer/shared/db";
import {
	LIGHT_MAX_EVENTS,
	classifyOperationWeight,
} from "../src/subgraphs/operation-weight.ts";

const SKIP = !process.env.DATABASE_URL;
const CONTRACT = "SP000WEIGHTTEST.token-a";

describe.skipIf(SKIP)("classifyOperationWeight", () => {
	afterAll(async () => {
		await getSourceDb()
			.deleteFrom("decoded_events")
			.where("contract_id", "=", CONTRACT)
			.execute();
	});

	test("null/empty targets and missing contract scope are heavy", async () => {
		expect(await classifyOperationWeight(null, 1, 100)).toEqual({
			weight: "heavy",
			estimatedEvents: null,
		});
		expect(await classifyOperationWeight([], 1, 100)).toEqual({
			weight: "heavy",
			estimatedEvents: null,
		});
		expect(
			await classifyOperationWeight([{ eventType: "print" }], 1, 100),
		).toEqual({ weight: "heavy", estimatedEvents: null });
	});

	test("contract-scoped with bounded count is light with honest estimate", async () => {
		const db = getSourceDb();
		await db
			.insertInto("decoded_events")
			.values(
				Array.from({ length: 5 }, (_, i) => ({
					block_height: 1000 + i,
					tx_id: `0xweight${i}`,
					tx_index: 0,
					event_index: i,
					event_type: "ft_transfer",
					contract_id: CONTRACT,
					canonical: true,
					cursor: `${1000 + i}:${i}`,
					source_cursor: `${1000 + i}:${i}`,
					payload: JSON.stringify({}),
				})),
			)
			.execute();

		const res = await classifyOperationWeight(
			[{ eventType: "ft_transfer", contractId: CONTRACT }],
			1,
			10_000,
		);
		expect(res.weight).toBe("light");
		expect(res.estimatedEvents).toBe(5);

		// range excludes the rows → still light, estimate 0
		const out = await classifyOperationWeight(
			[{ eventType: "ft_transfer", contractId: CONTRACT }],
			1,
			999,
		);
		expect(out).toEqual({ weight: "light", estimatedEvents: 0 });
	});

	test("threshold constant is wired", () => {
		expect(LIGHT_MAX_EVENTS).toBe(500_000);
	});
});
