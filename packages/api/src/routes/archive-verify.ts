/**
 * `POST /v1/archive/verify` — compare this instance against a signed archive.
 *
 * Read-only. Free. The caller sends a manifest URL, never chain bytes. Identity
 * digests only (`raw`); `--deep` / semantic replay is CLI. Signature failure is
 * HTTP 200 `unanchored`, never 500 and never `clean`.
 *
 * Raw tables live on SOURCE (`getSourceDb`). TARGET is the tenant/control plane
 * and is empty under the dual-DB split — digesting it would "verify" nothing.
 */

import {
	type RangeComparison,
	type RangeDigest,
	type RangeDigestDataset,
	compareRangeDigests,
	computeRangeDigest as defaultComputeRangeDigest,
} from "@secondlayer/shared/archive/range-digest";
import {
	type ArchiveManifest,
	type LoadReferenceOptions,
	checkSignature,
	loadReference,
	resolveArchivePublicKey,
} from "@secondlayer/shared/archive/reference";
import {
	type VerifyTarget,
	datasetMatchesTarget,
	parseVerifyTarget,
} from "@secondlayer/shared/coverage";
import { getSourceDb as defaultGetSourceDb } from "@secondlayer/shared/db";
import { ValidationError } from "@secondlayer/shared/errors";
import { isPlatformMode } from "@secondlayer/shared/mode";
import { Hono } from "hono";
import { InvalidJSONError } from "../middleware/error.ts";

/** Cap on ranges verified without a height window. ~2M heights at 50k/partition.
 *  CLI can still walk the full chain; HTTP must not hold a proxy open for 90s+. */
export const MAX_RANGES_WITHOUT_WINDOW = 40;

const RAW_DATASETS = new Set<string>(["blocks", "transactions", "events"]);

export type ArchiveVerifyRouterOptions = {
	/** Test/SDK seam; production uses global fetch via `loadReference`. */
	fetchImpl?: LoadReferenceOptions["fetchImpl"];
	computeRangeDigest?: typeof defaultComputeRangeDigest;
	getSourceDb?: typeof defaultGetSourceDb;
	resolvePublicKey?: typeof resolveArchivePublicKey;
};

type VerifyRangeStatus =
	| "match"
	| "digest-mismatch"
	| "count-mismatch"
	| "missing";

type VerifyResponse = {
	status: "clean" | "diverged" | "unanchored";
	target: string;
	against: string;
	signature: { verified: boolean; reason?: string };
	coverage?: { from_block: number; to_block: number };
	ranges: Array<{
		dataset: string;
		from_block: number;
		to_block: number;
		status: VerifyRangeStatus;
		expected_digest: string | null;
		actual_digest: string | null;
	}>;
	reason?: string;
};

function isHttpsUrl(value: string): boolean {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

function isRangeDigestDataset(value: string): value is RangeDigestDataset {
	return RAW_DATASETS.has(value);
}

function parseHeight(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new ValidationError(`${field} must be a non-negative integer`);
	}
	return value as number;
}

function rangeStatus(status: RangeComparison["status"]): VerifyRangeStatus {
	return status === "missing-locally" ? "missing" : status;
}

function coverageOf(
	ranges: Array<{ from_block: number; to_block: number }>,
): { from_block: number; to_block: number } | undefined {
	if (ranges.length === 0) return undefined;
	return {
		from_block: Math.min(...ranges.map((r) => r.from_block)),
		to_block: Math.max(...ranges.map((r) => r.to_block)),
	};
}

function unanchored(
	against: string,
	target: string,
	signature: { verified: boolean; reason?: string },
	reason: string,
): VerifyResponse {
	return {
		status: "unanchored",
		target,
		against,
		signature,
		ranges: [],
		reason,
	};
}

type ParsedBody = {
	against: string;
	target: string;
	fromBlock?: number;
	toBlock?: number;
	insecure: boolean;
	publicKeyPem?: string;
};

function parseBody(raw: unknown): ParsedBody {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new ValidationError("Body must be a JSON object");
	}
	const body = raw as Record<string, unknown>;
	if (typeof body.against !== "string" || body.against.length === 0) {
		throw new ValidationError("against is required");
	}
	if (!isHttpsUrl(body.against)) {
		throw new ValidationError(
			"against must be an https URL (local paths are not accepted)",
		);
	}
	if (body.target !== undefined && typeof body.target !== "string") {
		throw new ValidationError("target must be a string");
	}
	if (body.insecure !== undefined && typeof body.insecure !== "boolean") {
		throw new ValidationError("insecure must be a boolean");
	}
	if (
		body.public_key_pem !== undefined &&
		typeof body.public_key_pem !== "string"
	) {
		throw new ValidationError("public_key_pem must be a string");
	}
	const fromBlock =
		body.from_block === undefined
			? undefined
			: parseHeight(body.from_block, "from_block");
	const toBlock =
		body.to_block === undefined
			? undefined
			: parseHeight(body.to_block, "to_block");
	if (fromBlock !== undefined && toBlock !== undefined && toBlock < fromBlock) {
		throw new ValidationError("to_block must be >= from_block");
	}
	return {
		against: body.against,
		target: body.target ?? "raw",
		fromBlock,
		toBlock,
		insecure: body.insecure === true,
		publicKeyPem:
			typeof body.public_key_pem === "string" && body.public_key_pem.length > 0
				? body.public_key_pem
				: undefined,
	};
}

export function createArchiveVerifyRouter(
	opts: ArchiveVerifyRouterOptions = {},
): Hono {
	const fetchImpl = opts.fetchImpl;
	const computeRangeDigest =
		opts.computeRangeDigest ?? defaultComputeRangeDigest;
	const getSourceDb = opts.getSourceDb ?? defaultGetSourceDb;
	const resolvePublicKey = opts.resolvePublicKey ?? resolveArchivePublicKey;

	const app = new Hono();

	app.post("/verify", async (c) => {
		const raw = await c.req.json().catch(() => {
			throw new InvalidJSONError();
		});
		const parsed = parseBody(raw);
		let target: VerifyTarget;
		try {
			target = parseVerifyTarget(parsed.target);
		} catch (err) {
			throw new ValidationError(
				err instanceof Error ? err.message : "invalid target",
			);
		}
		const targetLabel =
			target.kind === "decode"
				? `decode:${target.name}`
				: target.kind === "subgraph"
					? `subgraph:${target.name}`
					: target.kind;

		let publicKey: string | undefined;
		try {
			publicKey = await resolvePublicKey({
				explicitPem: parsed.publicKeyPem,
				envPem:
					process.env.ARCHIVE_SIGNING_PUBLIC_KEY ??
					process.env.STREAMS_SIGNING_PUBLIC_KEY,
				allowHostedApi: isPlatformMode(),
			});
		} catch {
			publicKey = parsed.publicKeyPem;
		}
		if (!publicKey) {
			return c.json(
				unanchored(
					parsed.against,
					targetLabel,
					{ verified: false, reason: "no public key" },
					"no public key",
				),
			);
		}

		let manifest: ArchiveManifest;
		try {
			({ manifest } = await loadReference(parsed.against, {
				publicKeyPem: publicKey,
				fetchImpl,
			}));
		} catch (err) {
			const reason = err instanceof Error ? err.message : "could not fetch";
			return c.json(
				unanchored(
					parsed.against,
					targetLabel,
					{ verified: false, reason },
					reason,
				),
			);
		}

		const signature = checkSignature(manifest, publicKey, parsed.insecure);
		if (!signature.verified && !parsed.insecure) {
			return c.json(
				unanchored(
					parsed.against,
					targetLabel,
					signature,
					signature.reason ?? "signature did not verify",
				),
			);
		}

		const reference = (manifest.range_digests ?? []).filter((d) => {
			if (!isRangeDigestDataset(d.dataset)) return false;
			if (!datasetMatchesTarget(d.dataset, target)) return false;
			if (parsed.fromBlock !== undefined && d.to_block < parsed.fromBlock)
				return false;
			if (parsed.toBlock !== undefined && d.from_block > parsed.toBlock)
				return false;
			return true;
		});
		if (reference.length === 0) {
			return c.json(
				unanchored(parsed.against, targetLabel, signature, "no digests"),
			);
		}

		const hasWindow =
			parsed.fromBlock !== undefined || parsed.toBlock !== undefined;
		if (!hasWindow && reference.length > MAX_RANGES_WITHOUT_WINDOW) {
			throw new ValidationError(
				`Too many ranges to verify without a height window (max ${MAX_RANGES_WITHOUT_WINDOW}). Pass from_block and to_block.`,
			);
		}

		const db = getSourceDb();
		const local: RangeDigest[] = [];
		for (const range of reference) {
			local.push(
				await computeRangeDigest(
					db,
					range.dataset,
					range.from_block,
					range.to_block,
				),
			);
		}
		const comparisons = compareRangeDigests(local, reference);
		const ranges = comparisons.map((row) => ({
			dataset: row.dataset,
			from_block: row.from_block,
			to_block: row.to_block,
			status: rangeStatus(row.status),
			expected_digest: row.expected_digest,
			actual_digest: row.actual_digest,
		}));
		const diverged = ranges.some((row) => row.status !== "match");
		const body: VerifyResponse = {
			status: diverged ? "diverged" : "clean",
			target: targetLabel,
			against: parsed.against,
			signature,
			coverage: coverageOf(ranges),
			ranges,
		};
		return c.json(body);
	});

	return app;
}

export default createArchiveVerifyRouter();
