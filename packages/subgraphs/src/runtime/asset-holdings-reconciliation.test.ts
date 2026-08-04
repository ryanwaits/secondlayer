import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Database, Event, Transaction } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import { generateSubgraphSQL } from "../schema/generator.ts";
import type {
	SubgraphDefinition,
	SubgraphHandler,
	SubgraphSchema,
} from "../types.ts";
import type { PreloadedBlockData } from "./block-processor.ts";
import { processBlock } from "./block-processor.ts";
import type { SubgraphContext } from "./context.ts";

/**
 * Reconciliation harness for the `asset-holdings` shape: every stored
 * `holdings.amount` must equal the net of the canonical events that produced
 * it, computed independently of the handlers.
 *
 * Prod ground truth (2026-08-04): holder
 * `SP3K8BC…KBR9.alex-vault-v1-1` / asset `…age000-governance-token::alex` has
 * 159,722 canonical FT events netting to exactly 0 (credits and debits both
 * 99,966,829,445,662,330), yet stores -26,445,861,972,809.
 *
 * These cases model that shape — including a >1000-event mixed run whose
 * independently-computed net is 0 — and they all PASS. That is the finding, not
 * a formality: the accumulator write path (`ctx.increment` → the coalesced
 * UPDATE-then-guarded-INSERT flush in `context.ts`) reproduces the canonical net
 * exactly for a single sequential writer, across blocks, across transactions,
 * for self-transfers, and for both asset kinds. The prod divergence therefore
 * does NOT originate here; do not go looking for it in the flush again without
 * new evidence. Keep these as the regression guard for that guarantee.
 */

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const ALEX =
	"SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.age000-governance-token::alex";
const LONG = "SP265WBWD4NH7TVPYQTVD23X3607NNK4484DTXQZ3.longcoin::longcoin";
/** The holder under test — a contract principal, as prod's negative rows all are. */
const VAULT = "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.alex-vault-v1-1";
const POOL = "SP3XXMS38VTAWTVPE5682XSBFXPTH7XCPEBTX8AN2.pool";
const ROUTER = "SP1Z92MPDQEWZXW36VX71Q3S4H6X7GK1P6Q1P6Q1P.router";
/** Not a contract → deliberately unindexed by the handlers. */
const EOA = "SPKF5WM8Q5RZBZXCSBRZKW2X2YMA36CC1QHXRD0";

// --- Subgraph under test: byte-equivalent to subgraphs/asset-holdings.ts ---

const schema = {
	holdings: {
		columns: {
			kind: { type: "text", indexed: true },
			asset_identifier: { type: "text", indexed: true, search: true },
			holder: { type: "principal", indexed: true, search: true },
			amount: { type: "int" },
		},
		uniqueKeys: [["kind", "asset_identifier", "holder"]],
	},
} as unknown as SubgraphSchema;

const isContract = (holder: string): boolean => holder.includes(".");

function ftInc(
	ctx: SubgraphContext,
	assetId: string | undefined,
	holder: string,
	delta: bigint,
): void {
	if (!assetId || !isContract(holder)) return;
	ctx.increment(
		"holdings",
		{ kind: "ft", asset_identifier: assetId, holder },
		{ amount: delta },
	);
}

function stxInc(ctx: SubgraphContext, holder: string, delta: bigint): void {
	if (!isContract(holder)) return;
	ctx.increment(
		"holdings",
		{ kind: "stx", asset_identifier: "STX", holder },
		{ amount: delta },
	);
}

type FtXferEvent = {
	sender?: string;
	recipient?: string;
	amount?: bigint;
	assetIdentifier?: string;
};

const handlers: Record<string, SubgraphHandler> = {
	ftXfer: ((e: unknown, ctx: SubgraphContext) => {
		const ev = e as FtXferEvent;
		const a = BigInt(ev.amount ?? 0);
		if (ev.sender) ftInc(ctx, ev.assetIdentifier, ev.sender, -a);
		if (ev.recipient) ftInc(ctx, ev.assetIdentifier, ev.recipient, a);
	}) as unknown as SubgraphHandler,
	ftMint: ((e: unknown, ctx: SubgraphContext) => {
		const ev = e as FtXferEvent;
		if (ev.recipient)
			ftInc(ctx, ev.assetIdentifier, ev.recipient, BigInt(ev.amount ?? 0));
	}) as unknown as SubgraphHandler,
	ftBurn: ((e: unknown, ctx: SubgraphContext) => {
		const ev = e as FtXferEvent;
		if (ev.sender)
			ftInc(ctx, ev.assetIdentifier, ev.sender, -BigInt(ev.amount ?? 0));
	}) as unknown as SubgraphHandler,
	stxXfer: ((e: unknown, ctx: SubgraphContext) => {
		const ev = e as FtXferEvent;
		const a = BigInt(ev.amount ?? 0);
		if (ev.sender) stxInc(ctx, ev.sender, -a);
		if (ev.recipient) stxInc(ctx, ev.recipient, a);
	}) as unknown as SubgraphHandler,
	stxMint: ((e: unknown, ctx: SubgraphContext) => {
		const ev = e as FtXferEvent;
		if (ev.recipient) stxInc(ctx, ev.recipient, BigInt(ev.amount ?? 0));
	}) as unknown as SubgraphHandler,
	stxBurn: ((e: unknown, ctx: SubgraphContext) => {
		const ev = e as FtXferEvent;
		if (ev.sender) stxInc(ctx, ev.sender, -BigInt(ev.amount ?? 0));
	}) as unknown as SubgraphHandler,
};

function makeDef(name: string): SubgraphDefinition {
	return {
		name,
		startBlock: 1,
		sources: {
			ftXfer: { type: "ft_transfer" },
			ftMint: { type: "ft_mint" },
			ftBurn: { type: "ft_burn" },
			stxXfer: { type: "stx_transfer" },
			stxMint: { type: "stx_mint" },
			stxBurn: { type: "stx_burn" },
		},
		schema,
		handlers,
	} as unknown as SubgraphDefinition;
}

// --- Fixtures ---

/**
 * One canonical chain event. `asset` undefined ⇒ an STX event (the handlers
 * key those under the literal "STX").
 */
type Ev = {
	kind: "transfer" | "mint" | "burn";
	asset?: string;
	sender?: string;
	recipient?: string;
	amount: bigint;
};

let txCounter = 0;

function makeTx(blockHeight: number, txIndex: number): Transaction {
	txCounter++;
	return {
		tx_id: `0xtx${blockHeight}_${txIndex}_${txCounter}`,
		block_height: blockHeight,
		tx_index: txIndex,
		type: "contract_call",
		sender: POOL,
		status: "success",
		contract_id: POOL,
		function_name: "execute",
		function_args: null,
		raw_result: null,
		raw_tx: "0x00",
		created_at: new Date(0),
	} as Transaction;
}

/** Build a block whose events are split across `txCount` transactions. */
function makeBlock(height: number, evs: Ev[], txCount = 1): PreloadedBlockData {
	const txs: Transaction[] = [];
	for (let i = 0; i < Math.max(1, txCount); i++) txs.push(makeTx(height, i));
	const events: Event[] = [];
	const perTxCursor = new Map<string, number>();
	evs.forEach((e, i) => {
		const tx = txs[i % txs.length] as Transaction;
		const idx = perTxCursor.get(tx.tx_id) ?? 0;
		perTxCursor.set(tx.tx_id, idx + 1);
		const data: Record<string, unknown> = { amount: e.amount.toString() };
		if (e.asset) data.asset_identifier = e.asset;
		if (e.sender) data.sender = e.sender;
		if (e.recipient) data.recipient = e.recipient;
		events.push({
			id: randomUUID(),
			tx_id: tx.tx_id,
			block_height: height,
			event_index: idx,
			type: e.asset ? `ft_${e.kind}_event` : `stx_${e.kind}_event`,
			data,
			created_at: new Date(0),
		} as Event);
	});
	return {
		block: {
			height,
			hash: `0xblock${height}`,
			parent_hash: `0xblock${height - 1}`,
			burn_block_height: height,
			burn_block_hash: null,
			index_block_hash: null,
			timestamp: 1700000000 + height,
			canonical: true,
			created_at: new Date(0),
		},
		txs,
		events,
	};
}

/**
 * Independent net for one (kind, asset, holder) key — the in-process twin of
 * the canonical prod SQL (credits where holder is recipient, minus debits
 * where holder is sender). Deliberately NOT expressed via the handlers.
 */
function canonicalNet(
	evs: Ev[],
	asset: string | "STX",
	holder: string,
): bigint {
	let net = 0n;
	for (const e of evs) {
		const evAsset = e.asset ?? "STX";
		if (evAsset !== asset) continue;
		if (e.recipient === holder) net += e.amount;
		if (e.sender === holder) net -= e.amount;
	}
	return net;
}

// --- DB setup ---

let db: Kysely<Database>;
const createdSchemas: string[] = [];
const createdSubgraphNames: string[] = [];
const accountId = randomUUID();

async function setup(
	tag: string,
): Promise<{ def: SubgraphDefinition; pgSchema: string }> {
	const suffix = randomUUID().slice(0, 8);
	const pgSchema = `sg_ah_${tag}_${suffix}`;
	const def = makeDef(`ah-${tag}-${suffix}`);
	createdSchemas.push(pgSchema);
	const { statements } = generateSubgraphSQL(def, pgSchema);
	for (const stmt of statements) await sql.raw(stmt).execute(db);
	createdSubgraphNames.push(def.name);
	await db
		.insertInto("subgraphs")
		.values({
			name: def.name,
			status: "active",
			definition: def as unknown as Record<string, unknown>,
			schema_hash: "test",
			handler_path: "test",
			schema_name: pgSchema,
			account_id: accountId,
		})
		.execute();
	return { def, pgSchema };
}

async function storedAmount(
	pgSchema: string,
	kind: string,
	asset: string,
	holder: string,
): Promise<bigint | null> {
	const { rows } = await sql
		.raw(
			`SELECT amount FROM "${pgSchema}"."holdings"
			 WHERE kind = '${kind}' AND asset_identifier = '${asset}' AND holder = '${holder}'`,
		)
		.execute(db);
	const list = rows as { amount: string }[];
	if (list.length === 0) return null;
	if (list.length > 1) {
		throw new Error(
			`duplicate holdings rows for (${kind}, ${asset}, ${holder}): ${list.length}`,
		);
	}
	return BigInt(list[0]?.amount ?? "0");
}

beforeAll(() => {
	db = getDb();
});

afterAll(async () => {
	for (const name of createdSubgraphNames) {
		await db.deleteFrom("subgraphs").where("name", "=", name).execute();
	}
	for (const s of createdSchemas) {
		await sql.raw(`DROP SCHEMA IF EXISTS "${s}" CASCADE`).execute(db);
	}
});

// ---------------------------------------------------------------------------

describe("asset-holdings stored balances reconcile with the canonical event net", () => {
	it("credits the recipient and debits the sender of an ft_transfer", async () => {
		const { def, pgSchema } = await setup("ftx");
		const evs: Ev[] = [
			{
				kind: "transfer",
				asset: ALEX,
				sender: POOL,
				recipient: VAULT,
				amount: 500n,
			},
			{
				kind: "transfer",
				asset: ALEX,
				sender: VAULT,
				recipient: ROUTER,
				amount: 120n,
			},
		];
		await processBlock(def, def.name, 1000, {
			preloaded: makeBlock(1000, evs),
		});

		expect(await storedAmount(pgSchema, "ft", ALEX, VAULT)).toBe(
			canonicalNet(evs, ALEX, VAULT),
		);
		expect(await storedAmount(pgSchema, "ft", ALEX, POOL)).toBe(
			canonicalNet(evs, ALEX, POOL),
		);
		expect(await storedAmount(pgSchema, "ft", ALEX, ROUTER)).toBe(
			canonicalNet(evs, ALEX, ROUTER),
		);
		// EOAs are deliberately not indexed.
		expect(await storedAmount(pgSchema, "ft", ALEX, EOA)).toBeNull();
	});

	it("nets an ft_transfer whose sender and recipient are the same holder to zero", async () => {
		const { def, pgSchema } = await setup("ftself");
		const evs: Ev[] = [
			{
				kind: "transfer",
				asset: ALEX,
				sender: POOL,
				recipient: VAULT,
				amount: 900n,
			},
			// Self-transfer: must contribute exactly 0, not -900 then +900 elsewhere.
			{
				kind: "transfer",
				asset: ALEX,
				sender: VAULT,
				recipient: VAULT,
				amount: 400n,
			},
			{
				kind: "transfer",
				asset: ALEX,
				sender: VAULT,
				recipient: VAULT,
				amount: 400n,
			},
		];
		await processBlock(def, def.name, 1000, {
			preloaded: makeBlock(1000, evs),
		});

		expect(canonicalNet(evs, ALEX, VAULT)).toBe(900n);
		expect(await storedAmount(pgSchema, "ft", ALEX, VAULT)).toBe(900n);
	});

	it("applies ft_mint credits and ft_burn debits", async () => {
		const { def, pgSchema } = await setup("ftmb");
		const evs: Ev[] = [
			{ kind: "mint", asset: ALEX, recipient: VAULT, amount: 1_000n },
			{ kind: "burn", asset: ALEX, sender: VAULT, amount: 250n },
			{ kind: "mint", asset: LONG, recipient: VAULT, amount: 7n },
		];
		await processBlock(def, def.name, 1000, {
			preloaded: makeBlock(1000, evs),
		});

		expect(await storedAmount(pgSchema, "ft", ALEX, VAULT)).toBe(
			canonicalNet(evs, ALEX, VAULT),
		);
		expect(await storedAmount(pgSchema, "ft", LONG, VAULT)).toBe(
			canonicalNet(evs, LONG, VAULT),
		);
	});

	it("keys stx transfers, mints and burns under the literal STX asset", async () => {
		const { def, pgSchema } = await setup("stx");
		const evs: Ev[] = [
			{ kind: "mint", recipient: VAULT, amount: 10_000n },
			{ kind: "transfer", sender: VAULT, recipient: ROUTER, amount: 2_500n },
			{ kind: "transfer", sender: VAULT, recipient: VAULT, amount: 999n },
			{ kind: "burn", sender: VAULT, amount: 500n },
		];
		await processBlock(def, def.name, 1000, {
			preloaded: makeBlock(1000, evs),
		});

		expect(await storedAmount(pgSchema, "stx", "STX", VAULT)).toBe(
			canonicalNet(evs, "STX", VAULT),
		);
		expect(await storedAmount(pgSchema, "stx", "STX", ROUTER)).toBe(
			canonicalNet(evs, "STX", ROUTER),
		);
		// STX events must not leak into the ft keyspace.
		expect(await storedAmount(pgSchema, "ft", "STX", VAULT)).toBeNull();
	});

	it("a run of >1000 mixed events whose canonical net is zero stores exactly zero", async () => {
		const { def, pgSchema } = await setup("netzero");

		// Deterministic xorshift32 (Math.imul keeps it in int32 — a plain LCG
		// silently loses its low bits past 2^53 and degenerates to a constant).
		let seed = 0x2b11f070;
		const rand = (n: number): number => {
			seed ^= seed << 13;
			seed |= 0;
			seed ^= seed >>> 17;
			seed ^= seed << 5;
			seed |= 0;
			return Math.abs(seed % n);
		};

		const evs: Ev[] = [];
		// Matched credit/debit pairs on ALEX: the vault is filled then emptied,
		// so its canonical net is exactly 0 by construction.
		const credits: Ev[] = [];
		const debits: Ev[] = [];
		for (let i = 0; i < 420; i++) {
			const amount = BigInt(1 + rand(1_000_000_000));
			credits.push({
				kind: rand(4) === 0 ? "mint" : "transfer",
				asset: ALEX,
				sender: rand(4) === 0 ? undefined : POOL,
				recipient: VAULT,
				amount,
			});
			debits.push({
				kind: rand(4) === 0 ? "burn" : "transfer",
				asset: ALEX,
				sender: VAULT,
				recipient: rand(3) === 0 ? EOA : ROUTER,
				amount,
			});
		}
		// A mint must have no sender and a burn no recipient, or the fixture
		// would not be a legal event stream.
		for (const c of credits) if (c.kind === "mint") c.sender = undefined;
		for (const d of debits) if (d.kind === "burn") d.recipient = undefined;

		// Interleave so debits can precede their funding credits (chain-legal for
		// a signed column) and so same-key deltas land in the same block.
		for (let i = 0; i < credits.length; i++) {
			evs.push(credits[i] as Ev);
			evs.push(debits[i] as Ev);
			// Self-transfers: individually net 0 for the vault.
			if (i % 7 === 0) {
				evs.push({
					kind: "transfer",
					asset: ALEX,
					sender: VAULT,
					recipient: VAULT,
					amount: BigInt(1 + rand(500_000)),
				});
			}
			// Unrelated traffic on another asset and on STX, to keep the vault key
			// from being the only thing in any given increment batch.
			if (i % 5 === 0) {
				evs.push({
					kind: "transfer",
					asset: LONG,
					sender: POOL,
					recipient: ROUTER,
					amount: BigInt(1 + rand(1_000)),
				});
				evs.push({
					kind: "transfer",
					sender: ROUTER,
					recipient: POOL,
					amount: BigInt(1 + rand(1_000)),
				});
			}
		}

		expect(evs.length).toBeGreaterThanOrEqual(1000);
		expect(canonicalNet(evs, ALEX, VAULT)).toBe(0n);
		// Guard the fixture itself: a degenerate generator (every amount equal,
		// one event kind) would make the net-zero assertion vacuously true.
		const vaultCredits = evs
			.filter((e) => e.recipient === VAULT && e.asset === ALEX)
			.reduce((s, e) => s + e.amount, 0n);
		expect(vaultCredits).toBeGreaterThan(10n ** 11n);
		expect(new Set(evs.map((e) => e.amount.toString())).size).toBeGreaterThan(
			500,
		);
		expect(new Set(evs.map((e) => e.kind)).size).toBe(3);

		// Spread across blocks and multiple txs per block — prod's 159,722 events
		// are neither one block nor one tx.
		const perBlock = 37;
		let height = 2000;
		for (let i = 0; i < evs.length; i += perBlock) {
			const slice = evs.slice(i, i + perBlock);
			await processBlock(def, def.name, height, {
				preloaded: makeBlock(height, slice, 1 + (height % 4)),
			});
			height++;
		}

		// The prod shape: true net 0 over a large mixed run.
		expect(await storedAmount(pgSchema, "ft", ALEX, VAULT)).toBe(0n);
		// And every other key must reconcile too.
		for (const holder of [POOL, ROUTER]) {
			expect(await storedAmount(pgSchema, "ft", ALEX, holder)).toBe(
				canonicalNet(evs, ALEX, holder),
			);
			expect(await storedAmount(pgSchema, "ft", LONG, holder)).toBe(
				canonicalNet(evs, LONG, holder),
			);
			expect(await storedAmount(pgSchema, "stx", "STX", holder)).toBe(
				canonicalNet(evs, "STX", holder),
			);
		}
	});
});
