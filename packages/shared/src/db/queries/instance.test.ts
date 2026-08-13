import { afterEach, describe, expect, test } from "bun:test";
import { getDb } from "../index.ts";
import {
	InstanceNetworkMismatchError,
	InvalidInstanceNetworkError,
	ensureInstance,
	getInstance,
	instanceNetworkFromEnv,
	parseInstanceNetwork,
} from "./instance.ts";

describe("parseInstanceNetwork", () => {
	test("accepts mainnet, testnet, devnet", () => {
		expect(parseInstanceNetwork("mainnet")).toBe("mainnet");
		expect(parseInstanceNetwork("TESTNET")).toBe("testnet");
		expect(parseInstanceNetwork(" devnet ")).toBe("devnet");
	});

	test("rejects anything else", () => {
		expect(() => parseInstanceNetwork("regtest")).toThrow(
			InvalidInstanceNetworkError,
		);
	});
});

describe("instanceNetworkFromEnv", () => {
	test("STACKS_NETWORK wins, then NETWORK, then mainnet", () => {
		expect(
			instanceNetworkFromEnv({ STACKS_NETWORK: "testnet", NETWORK: "devnet" }),
		).toBe("testnet");
		expect(instanceNetworkFromEnv({ NETWORK: "devnet" })).toBe("devnet");
		expect(instanceNetworkFromEnv({})).toBe("mainnet");
	});
});

const SKIP = !process.env.DATABASE_URL;

describe.skipIf(SKIP)("instances table", () => {
	const db = getDb();

	afterEach(async () => {
		await db.deleteFrom("instances").execute();
	});

	test("ensureInstance creates a row with no account present", async () => {
		const before = await db
			.selectFrom("accounts")
			.select(db.fn.countAll().as("n"))
			.executeTakeFirstOrThrow();
		const instance = await ensureInstance(db, { network: "devnet" });
		expect(instance.network).toBe("devnet");
		expect(instance.id).toBeTruthy();
		const again = await getInstance(db);
		expect(again?.id).toBe(instance.id);
		const after = await db
			.selectFrom("accounts")
			.select(db.fn.countAll().as("n"))
			.executeTakeFirstOrThrow();
		expect(String(after.n)).toBe(String(before.n));
	});

	test("ensureInstance is idempotent for the same network", async () => {
		const a = await ensureInstance(db, { network: "mainnet" });
		const b = await ensureInstance(db, { network: "mainnet" });
		expect(b.id).toBe(a.id);
	});

	test("ensureInstance refuses to change network", async () => {
		await ensureInstance(db, { network: "mainnet" });
		expect(ensureInstance(db, { network: "testnet" })).rejects.toBeInstanceOf(
			InstanceNetworkMismatchError,
		);
	});
});
