"use client";

import {
	OperationResult,
	type OperationTone,
	formatBlockRange,
} from "@/components/console/operation-result";
import posthog from "posthog-js";
import { type ReactNode, useState } from "react";
import { validateBackfillRange } from "../../reindex-form";

/**
 * Replay form — prompts for a block range, POSTs to
 * `/api/subscriptions/:id/replay`. The emitter drains replay outbox rows at
 * 10% of batch capacity so the live stream is never starved (see `LIVE_SHARE`
 * in emitter.ts).
 *
 * The section heading lives on the page, not here — two components each
 * rendering their own heading is what produced the doubled "Replay / Replay
 * block range" stack.
 */

interface ReplayOutcome {
	tone: OperationTone;
	body: ReactNode;
	hint: ReactNode;
}

/**
 * Maps a replay response onto one of the four result states. Split out from
 * the component so the mapping is testable and so the zero-row case can't
 * silently regress back into "Enqueued 0 of 0 scanned rows."
 */
export function describeReplay(
	enqueuedCount: number,
	scannedCount: number,
	fromBlock: number,
	toBlock: number,
): ReplayOutcome {
	const range = formatBlockRange(fromBlock, toBlock);

	if (scannedCount === 0) {
		return {
			tone: "none",
			body: <>No rows in blocks {range} match this subscription's filter.</>,
			hint: "Nothing to replay. Widen the range, or check the filter on this subscription.",
		};
	}
	if (enqueuedCount === 0) {
		return {
			tone: "warn",
			body: (
				<>
					All <b>{scannedCount.toLocaleString()}</b> rows in blocks {range} are
					already queued.
				</>
			),
			hint: "An earlier replay covered this range. They'll deliver once.",
		};
	}
	if (enqueuedCount < scannedCount) {
		return {
			tone: "warn",
			body: (
				<>
					Queued <b>{enqueuedCount.toLocaleString()}</b> of{" "}
					<b>{scannedCount.toLocaleString()}</b> rows from blocks {range}.
				</>
			),
			hint: `The other ${(scannedCount - enqueuedCount).toLocaleString()} are already queued from an earlier replay — they'll deliver once.`,
		};
	}
	return {
		tone: "ok",
		body: (
			<>
				Queued <b>{enqueuedCount.toLocaleString()}</b> rows from blocks {range}.
			</>
		),
		hint: "Replays drain at 10% of batch capacity. Watch the delivery log below.",
	};
}

export function ReplayDialog({ subscriptionId }: { subscriptionId: string }) {
	const [open, setOpen] = useState(false);
	const [fromBlock, setFromBlock] = useState("");
	const [toBlock, setToBlock] = useState("");
	const [busy, setBusy] = useState(false);
	const [outcome, setOutcome] = useState<ReplayOutcome | null>(null);

	// Shared with the subgraph backfill form so a bad range is rejected with
	// the same words in both places.
	const range = validateBackfillRange(fromBlock, toBlock);
	const rangeTouched = fromBlock.trim() !== "" || toBlock.trim() !== "";

	async function onReplay() {
		if (!range.valid) return;
		setBusy(true);
		setOutcome(null);
		try {
			const res = await fetch(`/api/subscriptions/${subscriptionId}/replay`, {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					fromBlock: range.fromBlock,
					toBlock: range.toBlock,
				}),
			});
			const body = (await res.json().catch(() => ({}))) as {
				enqueuedCount?: number;
				scannedCount?: number;
				error?: string;
			};
			if (!res.ok) {
				setOutcome({
					tone: "err",
					body: (
						<>
							Couldn't start the replay —{" "}
							<b>{body.error ?? `HTTP ${res.status}`}</b>.
						</>
					),
					hint: "Nothing was queued. Try again in a moment.",
				});
				return;
			}
			const enqueuedCount = body.enqueuedCount ?? 0;
			const scannedCount = body.scannedCount ?? 0;
			setOutcome(
				describeReplay(
					enqueuedCount,
					scannedCount,
					range.fromBlock,
					range.toBlock,
				),
			);
			posthog.capture("subscription_replay_enqueued", {
				enqueued_count: enqueuedCount,
				scanned_count: scannedCount,
			});
		} catch (e) {
			setOutcome({
				tone: "err",
				body: (
					<>
						Couldn't reach the API —{" "}
						<b>{e instanceof Error ? e.message : "network error"}</b>.
					</>
				),
				hint: "Nothing was queued. Check your connection and try again.",
			});
		} finally {
			setBusy(false);
		}
	}

	if (!open) {
		return (
			<button type="button" className="dash-btn" onClick={() => setOpen(true)}>
				Replay range
			</button>
		);
	}

	return (
		<div className="sg-reindex-form">
			<div className="sg-reindex-fields">
				<div className="sg-reindex-field">
					<label className="sg-reindex-label" htmlFor="replay-from">
						From block
					</label>
					<input
						id="replay-from"
						className="sg-reindex-input"
						type="text"
						inputMode="numeric"
						placeholder="e.g. 8709410"
						value={fromBlock}
						onChange={(e) => setFromBlock(e.target.value)}
					/>
				</div>
				<div className="sg-reindex-field">
					<label className="sg-reindex-label" htmlFor="replay-to">
						To block
					</label>
					<input
						id="replay-to"
						className="sg-reindex-input"
						type="text"
						inputMode="numeric"
						placeholder="e.g. 8709415"
						value={toBlock}
						onChange={(e) => setToBlock(e.target.value)}
					/>
				</div>
			</div>
			<div style={{ display: "flex", gap: 8 }}>
				<button
					type="button"
					className="sg-reindex-btn"
					disabled={busy || !range.valid}
					onClick={onReplay}
				>
					{busy ? "Enqueuing…" : "Enqueue replay"}
				</button>
				<button
					type="button"
					className="dash-btn"
					onClick={() => {
						setOpen(false);
						setOutcome(null);
					}}
				>
					Close
				</button>
			</div>
			{rangeTouched && !range.valid && (
				<OperationResult tone="err">{range.error}</OperationResult>
			)}
			{outcome && (
				<OperationResult tone={outcome.tone} hint={outcome.hint}>
					{outcome.body}
				</OperationResult>
			)}
		</div>
	);
}
