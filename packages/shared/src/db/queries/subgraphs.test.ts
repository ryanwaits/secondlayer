import { describe, expect, it } from "bun:test";
import { getDb, getTargetDb } from "../index.ts";
import type { Subgraph } from "../types.ts";
import {
	encryptDatabaseUrl,
	isByoSubgraph,
	resolveSubgraphDb,
	subgraphDatabaseUrl,
} from "./subgraphs.ts";

// INSTANCE_MODE=oss so crypto/secrets bootstraps a key instead of throwing.
// Pure crypto round-trip — no Postgres required.
process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";

function subgraphWith(enc: Buffer | null): Subgraph {
	return { database_url_enc: enc } as unknown as Subgraph;
}

describe("BYO database_url envelope", () => {
	const url = "postgres://user:p%40ss@db.example.com:5432/app?sslmode=require";

	it("round-trips an encrypted connection string", () => {
		const enc = encryptDatabaseUrl(url);
		expect(enc).toBeInstanceOf(Buffer);
		expect(subgraphDatabaseUrl(subgraphWith(enc))).toBe(url);
	});

	it("never stores plaintext in the envelope", () => {
		const enc = encryptDatabaseUrl(url);
		expect(enc.toString("utf8")).not.toContain("p@ss");
		expect(enc.toString("utf8")).not.toContain("db.example.com");
	});

	it("returns null for a managed subgraph (no envelope)", () => {
		expect(subgraphDatabaseUrl(subgraphWith(null))).toBeNull();
	});

	it("rejects a tampered envelope (auth tag)", () => {
		const enc = encryptDatabaseUrl(url);
		enc[enc.length - 1] ^= 0xff; // corrupt last ciphertext byte
		expect(() => subgraphDatabaseUrl(subgraphWith(enc))).toThrow();
	});
});

describe("resolveSubgraphDb (pool routing)", () => {
	it("managed subgraph routes to the target DB", () => {
		expect(isByoSubgraph(subgraphWith(null))).toBe(false);
		expect(resolveSubgraphDb(subgraphWith(null))).toBe(getTargetDb());
	});

	it("BYO subgraph routes to its own per-URL pool", () => {
		const url = "postgres://u:p@byo-host.example:5432/app";
		const enc = encryptDatabaseUrl(url);
		expect(isByoSubgraph(subgraphWith(enc))).toBe(true);
		expect(resolveSubgraphDb(subgraphWith(enc))).toBe(getDb(url));
		expect(resolveSubgraphDb(subgraphWith(enc))).not.toBe(getTargetDb());
	});
});
