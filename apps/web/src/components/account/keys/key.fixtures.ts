import type { ApiKey } from "@/lib/types";

/** The clock the Keys stories run on. */
export const KEYS_EXAMPLE_NOW = new Date("2026-10-15T12:00:00.000Z");

/** An example key shown whole in the reveal step. Not a real credential. */
export const EXAMPLE_NEW_KEY = "sk-sl_9f3a6c1e0b7d4825a1c9e3f60d2b8a47";

const day = 86_400_000;
const ago = (days: number) =>
	new Date(KEYS_EXAMPLE_NOW.getTime() - days * day).toISOString();

const series = (base: number, shape: (i: number) => number) =>
	Array.from({ length: 30 }, (_, i) => Math.round(base * shape(i)));

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function exampleKey(
	patch: Partial<ApiKey> & { id: string; name: string },
): ApiKey {
	const rowsDaily = patch.rowsDaily;
	return {
		prefix: `sk-sl_${patch.id.padEnd(8, "0").slice(0, 8)}`,
		status: "active",
		product: "account",
		tier: null,
		createdAt: ago(120),
		lastUsedAt: ago(0),
		...patch,
		rows30d: rowsDaily ? sum(rowsDaily) : undefined,
	};
}

const prodDaily = series(48_000, (i) => 0.7 + 0.3 * Math.sin(i / 3));
const ciDaily = series(900, (i) => (i % 7 < 5 ? 1 : 0.1));

/** Every key in use, plus the keys made for the account. */
export const EXAMPLE_KEYS: ApiKey[] = [
	exampleKey({
		id: "a1b2c3d4",
		name: "prod-indexer",
		lastUsedAt: ago(0),
		rowsDaily: prodDaily,
	}),
	exampleKey({
		id: "b2c3d4e5",
		name: "ci",
		createdAt: ago(60),
		lastUsedAt: ago(1),
		rowsDaily: ciDaily,
	}),
	exampleKey({
		id: "c3d4e5f6",
		name: "laptop",
		createdAt: ago(90),
		lastUsedAt: ago(0),
		rowsDaily: series(1_200, (i) => (i > 20 ? 1 : 0.2)),
	}),
	exampleKey({
		id: "d4e5f6a7",
		name: "Docs key",
		product: "docs",
		createdAt: ago(0),
		lastUsedAt: ago(0),
		expiresAt: new Date(
			KEYS_EXAMPLE_NOW.getTime() + 4 * 3_600_000,
		).toISOString(),
		rowsDaily: series(0, () => 0),
	}),
	exampleKey({
		id: "e5f6a7b8",
		name: "hosted stack",
		product: "tenant",
		lastUsedAt: ago(0),
		rowsDaily: series(300, () => 1),
	}),
	exampleKey({
		id: "f6a7b8c9",
		name: "sentinel",
		product: "sentinel",
		lastUsedAt: ago(3),
		rowsDaily: series(40, (i) => (i % 5 === 0 ? 1 : 0)),
	}),
];

/** One key went quiet 41 days ago. */
export const EXAMPLE_KEYS_STALE: ApiKey[] = [
	...EXAMPLE_KEYS,
	exampleKey({
		id: "a7b8c9d0",
		name: "old-indexer",
		createdAt: ago(200),
		lastUsedAt: ago(41),
		rowsDaily: series(0, () => 0),
	}),
];
