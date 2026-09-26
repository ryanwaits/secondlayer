#!/usr/bin/env bun
// Plan 057 step 5 / Gate 2: "one reorg handled, injected on regtest."
// Plan 070: drives the real `runFollow` + `RpcWaitNotifier` (D12, amended
// 2026-09-26 — wakes on bitcoind's `waitfornewblock` RPC, not ZMQ) for the
// wake-up proof below.
//
// Spins up a real `bitcoin/bitcoin` regtest node in Docker, etches a rune,
// mints it, and transfers it — real, wire-format-valid transactions, not
// synthetic ones (`follow.test.ts`'s fake chain covers the orchestration
// logic in isolation; this proves the same code decodes a real node's bytes
// end to end). Then:
//   1. Runs `runFollow` with a real `RpcWaitNotifier` in the background,
//      mines one block, and asserts the checkpoint reaches it within 10s —
//      proving a mined block actually wakes the follower (not just its own
//      30s timeout fallback).
//   2. Stops that background follower, then injects a real reorg
//      (`invalidateblock` + a longer branch) the same deterministic way as
//      before this plan: a direct `syncOnce` call, so the reorg assertions
//      below aren't racing the background notifier against `invalidateblock`
//      temporarily shortening the live chain.
//   3. Asserts `syncOnce` detects the reorg, rewinds via `rewindTo`
//      (`../../src/rewind.ts`), re-applies the new branch, and that the
//      result is byte-identical (`state-hash`, the package's existing CLI
//      command) to a fresh backfill of the new branch from an empty DB.
//   4. A `btc_reorgs` row records the rewind.
//
// Requires Docker and a local Postgres at 127.0.0.1:5440
// (`docker/docker-compose.dev.yml`, `bun run db` from the repo root) —
// creates its own scratch databases there, never touches an existing one.
// Not part of the default `bun test` (this file doesn't end in `.test.ts`,
// and needs Docker + real wall-clock time for block generation); run with
// `bun run test:regtest`.

import { spawnSync } from "node:child_process";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Kysely } from "kysely";
import { migrateToLatest } from "../../src/db/migrate.ts";
import { openStore } from "../../src/db/store.ts";
import type { Database } from "../../src/db/types.ts";
import { runFollow, syncOnce } from "../../src/follow.ts";
import { RpcWaitNotifier } from "../../src/rpc-wait-notifier.ts";
import { bitcoinRpcClient } from "../../src/rpc.ts";
import { Network } from "../../src/runes/rune.ts";
import { encodeEtchingWithTerms, encodeMint } from "./runestone-encode.ts";

const CONTAINER = "sl-bitcoin-regtest-057";
// Reviewer note: node-server's compose (`docker/node-server/docker-compose.yml`)
// runs `kylemanna/bitcoind:latest` (unversioned) — pinned here to an official,
// explicit release instead. 29.4 was the newest 29.x release available on
// Docker Hub at the time this was written (checked via
// `docker.io/v2/repositories/bitcoin/bitcoin/tags`).
const IMAGE = "bitcoin/bitcoin:29.4";
const RPC_PORT = 18543;
const RPC_USER = "test";
const RPC_PASS = "test";
const WALLET = "test";

const PG_URL = "postgres://postgres:postgres@127.0.0.1:5440";
const DB_LIVE = "bitcoin_regtest057_live";
const DB_FRESH = "bitcoin_regtest057_fresh";

function sh(cmd: string, args: string[]): string {
	const res = spawnSync(cmd, args, { encoding: "utf8" });
	if (res.status !== 0) {
		throw new Error(`${cmd} ${args.join(" ")} failed:\n${res.stderr}`);
	}
	return res.stdout.trim();
}

function psql(sql: string): void {
	sh("docker", [
		"exec",
		"docker-postgres-1",
		"psql",
		"-U",
		"postgres",
		"-c",
		sql,
	]);
}

async function rpc<T = unknown>(
	method: string,
	params: unknown[] = [],
	wallet?: string,
): Promise<T> {
	const url = `http://127.0.0.1:${RPC_PORT}/${wallet ? `wallet/${wallet}` : ""}`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Basic ${btoa(`${RPC_USER}:${RPC_PASS}`)}`,
		},
		body: JSON.stringify({ jsonrpc: "1.0", id: "regtest", method, params }),
	});
	const json = (await res.json()) as { result: T; error: unknown };
	if (json.error) {
		throw new Error(`RPC ${method} failed: ${JSON.stringify(json.error)}`);
	}
	return json.result;
}

function u32le(n: number): Uint8Array {
	const b = new Uint8Array(4);
	new DataView(b.buffer).setUint32(0, n, true);
	return b;
}
function u64le(n: bigint): Uint8Array {
	const b = new Uint8Array(8);
	new DataView(b.buffer).setBigUint64(0, n, true);
	return b;
}
function concatBytes(chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}

/** A minimal unsigned raw tx: zero inputs, one output (`script`, value 0) — `fundrawtransaction` adds the funding input(s) and a change output that (per Runes default allocation, no edicts needed) receives whatever the runestone creates. */
function buildRawTxNoInputs(script: Uint8Array): string {
	return bytesToHex(
		concatBytes([
			u32le(2),
			Uint8Array.of(0),
			Uint8Array.of(1),
			u64le(0n),
			Uint8Array.of(script.length),
			script,
			u32le(0),
		]),
	);
}

interface Broadcast {
	txid: string;
	height: number;
	txIndex: number;
}

/** Funds, signs, broadcasts, and mines a tx carrying `script` as its only OP_RETURN output. Returns where it landed. */
async function broadcastOpReturnTx(
	script: Uint8Array,
	minerAddress: string,
): Promise<Broadcast> {
	const raw = buildRawTxNoInputs(script);
	const funded = await rpc<{ hex: string }>(
		"fundrawtransaction",
		[raw, {}],
		WALLET,
	);
	const signed = await rpc<{ hex: string; complete: boolean }>(
		"signrawtransactionwithwallet",
		[funded.hex],
		WALLET,
	);
	if (!signed.complete)
		throw new Error("signrawtransactionwithwallet: incomplete");
	const txid = await rpc<string>("sendrawtransaction", [signed.hex], WALLET);
	const [blockHash] = await rpc<string[]>(
		"generatetoaddress",
		[1, minerAddress],
		WALLET,
	);
	const block = await rpc<{ height: number; tx: Array<{ txid: string }> }>(
		"getblock",
		[blockHash, 2],
	);
	const txIndex = block.tx.findIndex((t) => t.txid === txid);
	if (txIndex === -1) throw new Error(`${txid} not found in its own block`);
	return { txid, height: block.height, txIndex };
}

interface Vout {
	n: number;
	value: number;
	scriptPubKey: { type: string };
}

/** The one output of `txid` whose scriptPubKey isn't OP_RETURN — where a rune balance (mint/premine, no edicts) auto-allocates. */
async function nonOpReturnOutput(
	txid: string,
): Promise<{ vout: number; value: number }> {
	const tx = await rpc<{ vout: Vout[] }>("getrawtransaction", [txid, true]);
	const out = tx.vout.find((v) => v.scriptPubKey.type !== "nulldata");
	if (!out) throw new Error(`${txid}: no non-OP_RETURN output`);
	return { vout: out.n, value: out.value };
}

async function transferOutpoint(
	txid: string,
	vout: number,
	value: number,
	destAddress: string,
	minerAddress: string,
): Promise<Broadcast> {
	const raw = await rpc<string>("createrawtransaction", [
		[{ txid, vout }],
		[{ [destAddress]: value }],
	]);
	const funded = await rpc<{ hex: string }>(
		"fundrawtransaction",
		[raw, {}],
		WALLET,
	);
	const signed = await rpc<{ hex: string; complete: boolean }>(
		"signrawtransactionwithwallet",
		[funded.hex],
		WALLET,
	);
	if (!signed.complete)
		throw new Error("signrawtransactionwithwallet: incomplete");
	const transferTxid = await rpc<string>(
		"sendrawtransaction",
		[signed.hex],
		WALLET,
	);
	const [blockHash] = await rpc<string[]>(
		"generatetoaddress",
		[1, minerAddress],
		WALLET,
	);
	const block = await rpc<{ height: number; tx: Array<{ txid: string }> }>(
		"getblock",
		[blockHash, 2],
	);
	const txIndex = block.tx.findIndex((t) => t.txid === transferTxid);
	return { txid: transferTxid, height: block.height, txIndex };
}

function cliStateHash(databaseUrl: string): string {
	const res = spawnSync("bun", ["run", "src/cli.ts", "state-hash"], {
		encoding: "utf8",
		env: { ...process.env, BITCOIN_DATABASE_URL: databaseUrl },
		cwd: new URL("../..", import.meta.url).pathname,
	});
	if (res.status !== 0) {
		throw new Error(`cli.ts state-hash failed:\n${res.stderr}`);
	}
	return res.stdout.trim();
}

/** Polls `runes_checkpoint.height` (the same table `loadState`/`syncOnce` maintain) until it reaches `targetHeight`, or throws after `timeoutMs`. */
async function waitForCheckpointHeight(
	db: Kysely<Database>,
	targetHeight: number,
	timeoutMs: number,
): Promise<number> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const row = await db
			.selectFrom("runes_checkpoint")
			.select("height")
			.executeTakeFirst();
		if (row && row.height >= targetHeight) return row.height;
		if (Date.now() >= deadline) {
			throw new Error(
				`checkpoint never reached height ${targetHeight} within ${timeoutMs}ms (last seen: ${row?.height})`,
			);
		}
		await Bun.sleep(200);
	}
}

let exitCode = 0;

async function main(): Promise<void> {
	console.log(`[setup] pulling ${IMAGE} (if not already local)…`);
	sh("docker", ["pull", IMAGE]);

	console.log("[setup] starting regtest bitcoind…");
	sh("docker", ["rm", "-f", CONTAINER]);
	sh("docker", [
		"run",
		"-d",
		"--name",
		CONTAINER,
		"-p",
		`${RPC_PORT}:18443`,
		IMAGE,
		"-regtest=1",
		"-txindex=1",
		"-server=1",
		`-rpcuser=${RPC_USER}`,
		`-rpcpassword=${RPC_PASS}`,
		"-rpcallowip=0.0.0.0/0",
		"-rpcbind=0.0.0.0",
		"-fallbackfee=0.0001",
		"-rpcport=18443",
	]);

	console.log("[setup] waiting for RPC…");
	let ready = false;
	for (let i = 0; i < 60; i++) {
		try {
			await rpc("getblockchaininfo");
			ready = true;
			break;
		} catch {
			await Bun.sleep(500);
		}
	}
	if (!ready) throw new Error("bitcoind RPC never became ready");

	console.log("[setup] creating wallet, maturing coinbase…");
	await rpc("createwallet", [WALLET]);
	const minerAddress = await rpc<string>("getnewaddress", [], WALLET);
	await rpc("generatetoaddress", [101, minerAddress], WALLET);

	console.log("[setup] two scratch Postgres databases (live + fresh-compare)…");
	psql(`DROP DATABASE IF EXISTS ${DB_LIVE};`);
	psql(`DROP DATABASE IF EXISTS ${DB_FRESH};`);
	psql(`CREATE DATABASE ${DB_LIVE};`);
	psql(`CREATE DATABASE ${DB_FRESH};`);
	const liveUrl = `${PG_URL}/${DB_LIVE}`;
	const freshUrl = `${PG_URL}/${DB_FRESH}`;

	process.env.BITCOIN_DATABASE_URL = liveUrl;
	await migrateToLatest();
	process.env.BITCOIN_DATABASE_URL = freshUrl;
	await migrateToLatest();

	console.log("[etch] premine 1000, terms amount=10 cap=3, turbo…");
	const etchScript = encodeEtchingWithTerms({
		divisibility: 0,
		premine: 1000n,
		termsAmount: 10n,
		termsCap: 3n,
		turbo: true,
	});
	const etch = await broadcastOpReturnTx(etchScript, minerAddress);
	console.log(
		`  height=${etch.height} txIndex=${etch.txIndex} txid=${etch.txid}`,
	);

	console.log("[mint] minting 10 units against the etch…");
	const mintScript = encodeMint(etch.height, etch.txIndex);
	const mint = await broadcastOpReturnTx(mintScript, minerAddress);
	const mintOut = await nonOpReturnOutput(mint.txid);
	console.log(`  height=${mint.height} outpoint=${mint.txid}:${mintOut.vout}`);

	console.log("[transfer] moving the minted balance to a new address…");
	const destAddress = await rpc<string>("getnewaddress", [], WALLET);
	const transfer = await transferOutpoint(
		mint.txid,
		mintOut.vout,
		mintOut.value,
		destAddress,
		minerAddress,
	);
	console.log(`  height=${transfer.height} txid=${transfer.txid}`);

	const liveDb = openStore(liveUrl);
	const rpcClient = bitcoinRpcClient({
		url: `http://127.0.0.1:${RPC_PORT}`,
		username: RPC_USER,
		password: RPC_PASS,
	});

	console.log(
		"[follow] runFollow + RpcWaitNotifier in the background — catching up…",
	);
	const notifier = new RpcWaitNotifier({ rpc: rpcClient });
	const followController = new AbortController();
	const followErrors: unknown[] = [];
	const followPromise = runFollow(
		{ db: liveDb, rpc: rpcClient, network: Network.Regtest, genesisHeight: 0 },
		notifier,
		followController.signal,
	).catch((error) => {
		followErrors.push(error);
	});

	const caughtUpHeight = await waitForCheckpointHeight(
		liveDb,
		transfer.height,
		10_000,
	);
	console.log(`  caught up to height=${caughtUpHeight}`);

	console.log(
		"[follow] mining a block to prove the wake-up path (waitfornewblock, not the timeout)…",
	);
	const [wakeHash] = await rpc<string[]>(
		"generatetoaddress",
		[1, minerAddress],
		WALLET,
	);
	const wakeBlock = await rpc<{ height: number }>("getblock", [wakeHash]);
	const wokeHeight = await waitForCheckpointHeight(
		liveDb,
		wakeBlock.height,
		10_000,
	);
	console.log(
		`  checkpoint reached height=${wokeHeight} within 10s of mining — wake-up path proven`,
	);

	followController.abort();
	notifier.close();
	assert(
		followErrors.length === 0,
		`runFollow threw: ${followErrors.map(String).join(", ")}`,
	);

	// Reorg injection: same direct-`syncOnce` technique as before this plan,
	// not the background follower above — `invalidateblock` briefly shortens
	// the live chain below the old checkpoint height, which would race the
	// background notifier waking mid-shorten; a direct call keeps this
	// deterministic.
	const forkHeight = etch.height; // orphan everything after the etch
	console.log(
		`[reorg] invalidateblock at height ${forkHeight + 1}, mining a longer branch…`,
	);
	const hashToInvalidate = await rpc<string>("getblockhash", [forkHeight + 1]);
	await rpc("invalidateblock", [hashToInvalidate]);
	const orphanedTip = wakeBlock.height;
	const newBranchLength = orphanedTip - forkHeight + 1; // strictly longer than the orphaned branch
	await rpc("generatetoaddress", [newBranchLength, minerAddress], WALLET);
	const newTipInfo = await rpc<{ blocks: number }>("getblockchaininfo");
	console.log(`  new tip height=${newTipInfo.blocks}`);

	console.log("[follow] syncOnce again — should detect, rewind, and re-apply…");
	let reorgSeen:
		| { forkHeight: number; oldCheckpointHeight: number }
		| undefined;
	const after = await syncOnce({
		db: liveDb,
		rpc: rpcClient,
		network: Network.Regtest,
		genesisHeight: 0,
		onReorg: (info) => {
			reorgSeen = info;
		},
	});
	console.log(`  height=${after.state.height} hash=${after.state.hash}`);

	assert(reorgSeen !== undefined, "onReorg never fired");
	assert(
		reorgSeen?.forkHeight === forkHeight,
		`fork height: expected ${forkHeight}, got ${reorgSeen?.forkHeight}`,
	);

	const reorgRows = await liveDb.selectFrom("btc_reorgs").selectAll().execute();
	assert(
		reorgRows.length === 1,
		`expected exactly 1 btc_reorgs row, got ${reorgRows.length}`,
	);
	console.log(
		`  btc_reorgs row: fork_point_height=${reorgRows[0]?.fork_point_height}`,
	);

	await liveDb.destroy();

	console.log("[verify] fresh backfill of the new branch, from an empty DB…");
	const freshDb = openStore(freshUrl);
	await syncOnce({
		db: freshDb,
		rpc: rpcClient,
		network: Network.Regtest,
		genesisHeight: 0,
	});
	await freshDb.destroy();

	const liveHash = cliStateHash(liveUrl);
	const freshHash = cliStateHash(freshUrl);
	console.log(`  live:  ${liveHash}`);
	console.log(`  fresh: ${freshHash}`);
	assert(
		liveHash === freshHash,
		"state-hash mismatch between the rewound state and a fresh backfill",
	);

	console.log("\n✅ regtest reorg test passed");
}

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(`assertion failed: ${message}`);
}

try {
	await main();
} catch (error) {
	console.error("❌ regtest reorg test failed:", error);
	exitCode = 1;
} finally {
	console.log("[cleanup] removing container and scratch databases…");
	spawnSync("docker", ["rm", "-f", CONTAINER]);
	try {
		psql(`DROP DATABASE IF EXISTS ${DB_LIVE};`);
		psql(`DROP DATABASE IF EXISTS ${DB_FRESH};`);
	} catch {
		// best-effort — a missing dev Postgres shouldn't mask the real failure above
	}
	process.exit(exitCode);
}
