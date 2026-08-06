"use client";

import {
	OperationResult,
	type OperationTone,
	formatBlockRange,
} from "@/components/console/operation-result";
import posthog from "posthog-js";
import { type ReactNode, useState } from "react";
import { rememberOperationStartedHere } from "./operation-memory";
import { blockCountForRange } from "./operation-status";

interface SubgraphReindexFormProps {
	subgraphName: string;
	sessionToken: string;
}

/**
 * The queued operation's id, which both start endpoints return. It is what
 * ties a `_started` event to the `_completed`/`_failed` the status pill emits
 * later, so a missing one degrades to an unjoinable event rather than a throw.
 */
export function parseOperationId(body: unknown): string | null {
	if (typeof body !== "object" || body === null) return null;
	const id = (body as { operationId?: unknown }).operationId;
	return typeof id === "string" && id.length > 0 ? id : null;
}

// Accepts only digit strings so "12,000" (Number() -> NaN) and "-5" (not
// \d+) are rejected before they ever reach JSON.stringify, which would
// otherwise silently turn NaN into `null` in the request body.
export function parseBlockInput(raw: string): number | null {
	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const n = Number(trimmed);
	return Number.isSafeInteger(n) ? n : null;
}

export type BackfillRangeValidation =
	| { valid: true; fromBlock: number; toBlock: number }
	| { valid: false; error: string };

export function validateBackfillRange(
	fromRaw: string,
	toRaw: string,
): BackfillRangeValidation {
	const fromBlock = parseBlockInput(fromRaw);
	const toBlock = parseBlockInput(toRaw);
	if (fromBlock === null || toBlock === null) {
		return {
			valid: false,
			error: "From/to block must be whole numbers (e.g. 185000).",
		};
	}
	if (fromBlock > toBlock) {
		return { valid: false, error: "From block must not be after to block." };
	}
	return { valid: true, fromBlock, toBlock };
}

export function SubgraphReindexForm({
	subgraphName,
	sessionToken,
}: SubgraphReindexFormProps) {
	const [tab, setTab] = useState<"backfill" | "reindex">("backfill");
	const [fromBlock, setFromBlock] = useState("");
	const [toBlock, setToBlock] = useState("");
	const [message, setMessage] = useState("");
	const [submitting, setSubmitting] = useState(false);

	const rangeValidation = validateBackfillRange(fromBlock, toBlock);
	const rangeTouched = fromBlock.trim() !== "" || toBlock.trim() !== "";

	async function post(path: string, body?: unknown) {
		return fetch(`/api/subgraphs/${subgraphName}/${path}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${sessionToken}`,
			},
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		});
	}

	async function handleBackfillSubmit() {
		if (!rangeValidation.valid) {
			setMessage(`Error: ${rangeValidation.error}`);
			return;
		}
		setMessage("");
		setSubmitting(true);
		try {
			const res = await post("backfill", {
				fromBlock: rangeValidation.fromBlock,
				toBlock: rangeValidation.toBlock,
			});
			if (!res.ok) throw new Error(await res.text());
			const operationId = parseOperationId(await res.json().catch(() => null));
			// Tag it as ours before the pill can observe it finishing, so the
			// terminal event is attributed to the console rather than the CLI.
			if (operationId) rememberOperationStartedHere(operationId);
			posthog.capture("subgraph_backfill_started", {
				from_block: rangeValidation.fromBlock,
				to_block: rangeValidation.toBlock,
				block_count: blockCountForRange(
					rangeValidation.fromBlock,
					rangeValidation.toBlock,
				),
				operation_id: operationId,
				source: "console",
			});
			setMessage("Backfill queued — track its progress in the status pill.");
		} catch (e) {
			setMessage(`Error: ${e instanceof Error ? e.message : "Unknown error"}`);
		} finally {
			setSubmitting(false);
		}
	}

	async function handleReindexSubmit() {
		setMessage("");
		setSubmitting(true);
		try {
			// Reindex rebuilds the whole subgraph and takes no body — sending no
			// JSON body at all keeps the request shape honest about that (rather
			// than an empty `{}` implying a body was considered and cleared).
			const res = await post("reindex");
			if (!res.ok) throw new Error(await res.text());
			const body = await res.json().catch(() => null);
			const operationId = parseOperationId(body);
			if (operationId) rememberOperationStartedHere(operationId);
			// No block_count: a reindex has no upper bound at submit time — it
			// always walks to whatever the chain tip is when it runs. The pill's
			// terminal event fills that in against the tip it actually reached.
			posthog.capture("subgraph_reindex_started", {
				from_block:
					typeof (body as { fromBlock?: unknown } | null)?.fromBlock ===
					"number"
						? (body as { fromBlock: number }).fromBlock
						: null,
				operation_id: operationId,
				source: "console",
			});
			setMessage("Reindex queued — track its progress in the status pill.");
		} catch (e) {
			setMessage(`Error: ${e instanceof Error ? e.message : "Unknown error"}`);
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<>
			<div className="sg-data-tabs">
				<button
					type="button"
					className={`sg-data-tab${tab === "backfill" ? " active" : ""}`}
					onClick={() => setTab("backfill")}
				>
					Backfill
				</button>
				<button
					type="button"
					className={`sg-data-tab${tab === "reindex" ? " active" : ""}`}
					onClick={() => setTab("reindex")}
				>
					Reindex
				</button>
			</div>

			{tab === "backfill" ? (
				<div className="sg-reindex-form">
					<p
						style={{
							fontSize: 13,
							color: "var(--text-muted)",
							lineHeight: 1.5,
							marginBottom: 16,
						}}
					>
						Fill in gaps where blocks were missed during syncing.
						Non-destructive &mdash; only processes blocks that have no data.
					</p>
					<div className="sg-reindex-fields">
						<div className="sg-reindex-field">
							<div className="sg-reindex-label">From block</div>
							<input
								className="sg-reindex-input"
								type="text"
								placeholder="e.g. 185000"
								value={fromBlock}
								onChange={(e) => setFromBlock(e.target.value)}
							/>
						</div>
						<div className="sg-reindex-field">
							<div className="sg-reindex-label">To block</div>
							<input
								className="sg-reindex-input"
								type="text"
								placeholder="e.g. 187421"
								value={toBlock}
								onChange={(e) => setToBlock(e.target.value)}
							/>
						</div>
					</div>
					{rangeTouched && !rangeValidation.valid && (
						<p
							style={{
								marginTop: 8,
								fontSize: 12,
								color: "var(--text-danger, #d92d20)",
							}}
						>
							{rangeValidation.error}
						</p>
					)}
					<button
						type="button"
						className="sg-reindex-btn"
						disabled={!rangeValidation.valid || submitting}
						onClick={handleBackfillSubmit}
					>
						Backfill gaps
					</button>
					{message && (
						<p
							style={{
								marginTop: 12,
								fontSize: 12,
								color: "var(--text-muted)",
							}}
						>
							{message}
						</p>
					)}
				</div>
			) : (
				<div className="sg-reindex-form">
					<div className="sg-reindex-warning">
						<svg
							aria-hidden="true"
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							style={{ flexShrink: 0, marginTop: 1 }}
						>
							<path d="M8 1.5L1.5 13h13L8 1.5z" />
							<path d="M8 6v3" />
							<circle cx="8" cy="11" r="0.5" fill="currentColor" />
						</svg>
						<span>
							Reindexing is destructive. It drops and rebuilds the entire
							subgraph from its start block &mdash; there is no way to scope it
							to a range.
						</span>
					</div>
					<button
						type="button"
						className="sg-reindex-btn"
						disabled={submitting}
						onClick={handleReindexSubmit}
					>
						Reindex
					</button>
					{message && (
						<p
							style={{
								marginTop: 12,
								fontSize: 12,
								color: "var(--text-muted)",
							}}
						>
							{message}
						</p>
					)}
				</div>
			)}
		</>
	);
}
