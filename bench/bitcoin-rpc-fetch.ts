#!/usr/bin/env bun
// ───────────────────────────────────────────────────────────────────
// Bitcoin RPC fetch benchmark (plan 036, Bitcoin Phase 0).
//
// Measures the cost of pulling blocks from a remote bitcoind over
// getblockhash + getblock, at verbosity 0 (raw hex) vs 2 (full JSON),
// across concurrency levels. This is the D6 measurement: fetch raw and
// parse in TS, or let bitcoind do verbosity 2/3 JSON — decided from
// whichever wins blocks/s once parse cost is included.
//
// For verbosity 0, also times a TS parse of the raw block hex (tx count +
// output count) so fetch cost and parse cost are reported separately.
//
// Env:
//   BTC_RPC_URL   e.g. http://37.27.171.220:8332
//   BTC_RPC_USER
//   BTC_RPC_PASS
//   FROM          start height (default 900000)
//   COUNT         block count (default 500)
//   VERBOSITY     0 | 1 | 2 (default 0)
//   CONCURRENCY   in-flight requests (default 1)
//
// Usage:
//   BTC_RPC_URL=http://host:8332 BTC_RPC_USER=u BTC_RPC_PASS=p \
//     FROM=900000 COUNT=500 VERBOSITY=0 CONCURRENCY=4 \
//     bun run bench/bitcoin-rpc-fetch.ts
// ───────────────────────────────────────────────────────────────────
import { Buffer } from "node:buffer";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`missing required env var ${name}`);
	return value;
}

const RPC_URL = requireEnv("BTC_RPC_URL");
const RPC_USER = requireEnv("BTC_RPC_USER");
const RPC_PASS = requireEnv("BTC_RPC_PASS");
const FROM = Number.parseInt(process.env.FROM ?? "900000", 10);
const COUNT = Number.parseInt(process.env.COUNT ?? "500", 10);
const VERBOSITY = Number.parseInt(process.env.VERBOSITY ?? "0", 10);
const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY ?? "1", 10);

const AUTH_HEADER = `Basic ${Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString("base64")}`;

interface RpcResponse {
	result: unknown;
	error: unknown;
}

async function rpcCall(
	method: string,
	params: unknown[],
): Promise<{ result: unknown; text: string }> {
	const res = await fetch(RPC_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: AUTH_HEADER,
		},
		body: JSON.stringify({ jsonrpc: "1.0", id: 0, method, params }),
	});
	const text = await res.text();
	const json = JSON.parse(text) as RpcResponse;
	if (json.error) {
		throw new Error(
			`${method}(${JSON.stringify(params)}) failed: ${JSON.stringify(json.error)}`,
		);
	}
	return { result: json.result, text };
}

// --- minimal raw-block parser: tx count + total output count ---
// Skips scriptSig/scriptPubkey/witness bytes without interpreting them.
class Cursor {
	pos = 0;
	constructor(private buf: Buffer) {}

	readUInt8(): number {
		const v = this.buf.readUInt8(this.pos);
		this.pos += 1;
		return v;
	}

	skip(n: number): void {
		this.pos += n;
	}

	readVarInt(): number {
		const first = this.readUInt8();
		if (first < 0xfd) return first;
		if (first === 0xfd) {
			const v = this.buf.readUInt16LE(this.pos);
			this.pos += 2;
			return v;
		}
		if (first === 0xfe) {
			const v = this.buf.readUInt32LE(this.pos);
			this.pos += 4;
			return v;
		}
		const v = this.buf.readBigUInt64LE(this.pos);
		this.pos += 8;
		return Number(v);
	}
}

function parseRawBlock(hex: string): { txCount: number; outputCount: number } {
	const buf = Buffer.from(hex, "hex");
	const cursor = new Cursor(buf);
	cursor.skip(80); // block header
	const txCount = cursor.readVarInt();
	let outputCount = 0;

	for (let i = 0; i < txCount; i++) {
		cursor.skip(4); // version
		const markerPos = cursor.pos;
		const marker = cursor.readUInt8();
		const flag = cursor.readUInt8();
		const isSegwit = marker === 0x00 && flag !== 0x00;
		if (!isSegwit) cursor.pos = markerPos; // rewind, re-read as varint below

		const inCount = cursor.readVarInt();
		for (let j = 0; j < inCount; j++) {
			cursor.skip(32 + 4); // prevout txid + vout
			const scriptLen = cursor.readVarInt();
			cursor.skip(scriptLen);
			cursor.skip(4); // sequence
		}

		const outCount = cursor.readVarInt();
		outputCount += outCount;
		for (let j = 0; j < outCount; j++) {
			cursor.skip(8); // value
			const scriptLen = cursor.readVarInt();
			cursor.skip(scriptLen);
		}

		if (isSegwit) {
			for (let j = 0; j < inCount; j++) {
				const stackCount = cursor.readVarInt();
				for (let k = 0; k < stackCount; k++) {
					const itemLen = cursor.readVarInt();
					cursor.skip(itemLen);
				}
			}
		}

		cursor.skip(4); // locktime
	}

	return { txCount, outputCount };
}

interface BlockSample {
	height: number;
	fetchMs: number;
	bytes: number;
	parseMs?: number;
}

async function fetchOne(height: number): Promise<BlockSample> {
	const t0 = performance.now();
	const { result: hash } = await rpcCall("getblockhash", [height]);
	const { result: blockResult, text } = await rpcCall("getblock", [
		hash,
		VERBOSITY,
	]);
	const fetchMs = performance.now() - t0;

	if (VERBOSITY === 0) {
		const hex = blockResult as string;
		const bytes = hex.length / 2;
		const p0 = performance.now();
		parseRawBlock(hex);
		const parseMs = performance.now() - p0;
		return { height, fetchMs, bytes, parseMs };
	}

	return { height, fetchMs, bytes: Buffer.byteLength(text) };
}

async function runPool(
	heights: number[],
	concurrency: number,
): Promise<BlockSample[]> {
	const results: BlockSample[] = [];
	let next = 0;

	async function worker(): Promise<void> {
		while (next < heights.length) {
			const idx = next++;
			results.push(await fetchOne(heights[idx]));
		}
	}

	await Promise.all(Array.from({ length: concurrency }, () => worker()));
	return results;
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
	return sorted[idx];
}

async function main(): Promise<void> {
	const heights = Array.from({ length: COUNT }, (_, i) => FROM + i);

	const wallStart = performance.now();
	const samples = await runPool(heights, CONCURRENCY);
	const wallSec = (performance.now() - wallStart) / 1000;

	const fetchLatencies = samples.map((s) => s.fetchMs).sort((a, b) => a - b);
	const totalBytes = samples.reduce((sum, s) => sum + s.bytes, 0);
	const blocksPerSec = samples.length / wallSec;
	const mbPerSec = totalBytes / (1024 * 1024) / wallSec;
	const p50 = percentile(fetchLatencies, 0.5);
	const p95 = percentile(fetchLatencies, 0.95);

	let parseSummary = "";
	if (VERBOSITY === 0) {
		const parseLatencies = samples
			.map((s) => s.parseMs ?? 0)
			.sort((a, b) => a - b);
		const parseAvg =
			parseLatencies.reduce((a, b) => a + b, 0) / parseLatencies.length;
		parseSummary = ` parseMsAvg=${parseAvg.toFixed(2)} parseMsP95=${percentile(parseLatencies, 0.95).toFixed(2)}`;
	}

	console.log(
		`RESULT from=${FROM} count=${COUNT} verbosity=${VERBOSITY} concurrency=${CONCURRENCY} ` +
			`blocksPerSec=${blocksPerSec.toFixed(2)} MBps=${mbPerSec.toFixed(2)} ` +
			`p50ms=${p50.toFixed(1)} p95ms=${p95.toFixed(1)}${parseSummary}`,
	);
}

await main();
