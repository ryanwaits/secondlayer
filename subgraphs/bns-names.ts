// ───────────────────────────────────────────────────────────────────
// Canonical source for the HOSTED PUBLIC `bns-names` subgraph.
//
// Recovered into git 2026-06-20 from the deployed source-capture
// (GET /api/subgraphs/bns-names/source) — deployed from an uncommitted local
// file. This file is now the source of truth; edit here and redeploy.
//
// KNOWN DRIFT (reconcile via redeploy in a later sprint): the deployment's
// DB `start_block` is 5_143_314 (a `--start-block` override at deploy); the
// source below declares none (defaults to genesis). The committed code is
// semantically identical to the deployed source; whitespace normalized to
// repo lint style.
//
// Schema parity verified against live meta (GET /v1/subgraphs/bns-names):
// table `names`.
// ───────────────────────────────────────────────────────────────────

import { defineSubgraph } from "@secondlayer/subgraphs";

/**
 * Track BNS-V2 name lifecycle events — registrations, transfers,
 * renewals, burns, airdrops.
 *
 * Source: BNS-V2 print events (topic-discriminated payloads).
 *
 * Query examples once deployed:
 *   GET /v1/subgraphs/bns-names/names?owner=SP1...
 *   GET /v1/subgraphs/bns-names/names?_search=alice
 */
export default defineSubgraph({
	name: "bns-names",
	version: "1.0.0",
	description: "BNS-V2 name ownership and lifecycle",

	sources: {
		bns: {
			type: "print_event",
			contractId: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2",
		},
	},

	schema: {
		names: {
			columns: {
				topic: { type: "text", indexed: true },
				namespace: { type: "text", indexed: true, search: true },
				name: { type: "text", indexed: true, search: true },
				fqn: { type: "text", indexed: true, search: true },
				owner: {
					type: "principal",
					nullable: true,
					indexed: true,
					search: true,
				},
			},
		},
	},

	handlers: {
		bns: (event, ctx) => {
			if (!event.topic) return;
			const data = event.data as {
				namespace?: unknown;
				name?: unknown;
				owner?: string;
			};
			const namespace = decodeBuffUtf8(data.namespace);
			const nameLabel = decodeBuffUtf8(data.name);
			if (!namespace || !nameLabel) return;
			ctx.insert("names", {
				topic: event.topic,
				namespace,
				name: nameLabel,
				fqn: `${nameLabel}.${namespace}`,
				owner: event.topic === "burn-name" ? null : (data.owner ?? null),
			});
		},
	},
});

function decodeBuffUtf8(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const hex = value.startsWith("0x") ? value.slice(2) : value;
	if (hex.length === 0) return null;
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	let end = bytes.length;
	while (end > 0 && bytes[end - 1] === 0) end -= 1;
	return new TextDecoder("utf-8").decode(bytes.subarray(0, end));
}
