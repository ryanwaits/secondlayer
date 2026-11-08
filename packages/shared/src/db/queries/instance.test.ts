import { afterEach, describe, expect, test } from "bun:test";
import { generateSecretsKey } from "../../crypto/secrets.ts";
import { getDb } from "../index.ts";
import {
	InstanceNetworkMismatchError,
	InvalidInstanceNetworkError,
	SecretsKeyMismatchError,
	checkInstanceNetwork,
	ensureInstance,
	ensureSecretsKeyCanary,
	getInstance,
	instanceNetworkFromEnv,
	parseInstanceNetwork,
	stacksNetworkFromEnv,
} from "./instance.ts";

describe("stacksNetworkFromEnv", () => {
	test("STACKS_NETWORK wins over the deprecated NETWORK", () => {
		expect(
			stacksNetworkFromEnv({ STACKS_NETWORK: "testnet", NETWORK: "devnet" }),
		).toBe("testnet");
	});

	test("a deployment that only sets NETWORK keeps its network", () => {
		expect(stacksNetworkFromEnv({ NETWORK: "testnet" })).toBe("testnet");
	});

	test("defaults to mainnet", () => {
		expect(stacksNetworkFromEnv({})).toBe("mainnet");
	});
});

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

	test("the first boot with a key seals a canary and the same key boots again", async () => {
		const keyHex = generateSecretsKey();
		await ensureSecretsKeyCanary(db, { keyHex, network: "mainnet" });
		const row = await db
			.selectFrom("instances")
			.select("secrets_key_canary")
			.executeTakeFirstOrThrow();
		expect(row.secrets_key_canary).toBeTruthy();
		await ensureSecretsKeyCanary(db, { keyHex, network: "mainnet" });
	});

	test("a boot with a different key is refused", async () => {
		await ensureSecretsKeyCanary(db, {
			keyHex: generateSecretsKey(),
			network: "mainnet",
		});
		expect(
			ensureSecretsKeyCanary(db, {
				keyHex: generateSecretsKey(),
				network: "mainnet",
			}),
		).rejects.toBeInstanceOf(SecretsKeyMismatchError);
	});

	test("an instance row that predates the canary adopts the first key it sees", async () => {
		await ensureInstance(db, { network: "mainnet" });
		const keyHex = generateSecretsKey();
		await ensureSecretsKeyCanary(db, { keyHex, network: "mainnet" });
		expect(
			ensureSecretsKeyCanary(db, {
				keyHex: generateSecretsKey(),
				network: "mainnet",
			}),
		).rejects.toBeInstanceOf(SecretsKeyMismatchError);
		await ensureSecretsKeyCanary(db, { keyHex, network: "mainnet" });
	});

	test("checkInstanceNetwork matches the pinned network and stays quiet", async () => {
		await ensureInstance(db, { network: "mainnet" });
		expect(await checkInstanceNetwork(db, { STACKS_NETWORK: "mainnet" })).toBe(
			"match",
		);
		// A deployment that only sets the deprecated NETWORK resolves the same way.
		expect(await checkInstanceNetwork(db, { NETWORK: "mainnet" })).toBe(
			"match",
		);
		expect(await checkInstanceNetwork(db, {})).toBe("match");
	});

	test("checkInstanceNetwork reports a mismatch without throwing", async () => {
		await ensureInstance(db, { network: "mainnet" });
		expect(await checkInstanceNetwork(db, { STACKS_NETWORK: "testnet" })).toBe(
			"mismatch",
		);
	});

	test("checkInstanceNetwork treats an unpinned database as fine", async () => {
		expect(await checkInstanceNetwork(db, { STACKS_NETWORK: "testnet" })).toBe(
			"unpinned",
		);
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
