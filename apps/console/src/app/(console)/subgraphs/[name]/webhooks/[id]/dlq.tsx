"use client";

import { consoleFetch } from "@/lib/client-fetch";
import type { DeadRow } from "@/lib/types";
import { useEffect, useState } from "react";

/**
 * Dead letter queue: outbox rows that exhausted all retries. Owns its section
 * head so the count stays live through requeues; the page renders the Replay
 * panel directly beneath it inside the same section.
 */
export function Dlq({ subscriptionId }: { subscriptionId: string }) {
	const [rows, setRows] = useState<DeadRow[] | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);

	async function load() {
		try {
			const res = await consoleFetch(
				`/api/subscriptions/${encodeURIComponent(subscriptionId)}/dead`,
			);
			const body = (await res.json()) as { data?: DeadRow[]; error?: string };
			if (!res.ok) {
				setErr(body.error ?? `HTTP ${res.status}`);
				return;
			}
			setRows(body.data ?? []);
			setErr(null);
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: load is stable closure; only reload when subscription id changes
	useEffect(() => {
		void load();
	}, [subscriptionId]);

	async function requeue(outboxId: string) {
		setBusy(outboxId);
		try {
			const res = await consoleFetch(
				`/api/subscriptions/${encodeURIComponent(subscriptionId)}/dead/${encodeURIComponent(outboxId)}/requeue`,
				{ method: "POST" },
			);
			if (res.ok) {
				await load();
			} else setErr(`HTTP ${res.status}`);
		} finally {
			setBusy(null);
		}
	}

	let body: React.ReactNode;
	if (err) {
		body = <p style={{ color: "var(--error)" }}>{err}</p>;
	} else if (rows === null) {
		body = <p className="detail-desc">Loading…</p>;
	} else if (rows.length === 0) {
		body = (
			<p className="detail-desc">
				No dead rows. Delivery attempts that fail all 7 retries land here
				awaiting manual requeue.
			</p>
		);
	} else {
		body = (
			<div className="table-scroll">
				<table className="sg">
					<thead>
						<tr>
							<th>Event</th>
							<th>Block</th>
							<th>Failed</th>
							<th>Payload</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{rows.map((r) => (
							<tr key={r.id}>
								<td className="mono">{r.eventType}</td>
								<td className="mono">#{r.blockHeight.toLocaleString()}</td>
								<td>
									{r.failedAt ? new Date(r.failedAt).toLocaleString() : "—"}
								</td>
								<td className="mono">
									{JSON.stringify(r.payload).slice(0, 60)}…
								</td>
								<td>
									<button
										type="button"
										className="btn"
										disabled={busy === r.id}
										onClick={() => requeue(r.id)}
									>
										{busy === r.id ? "…" : "Requeue"}
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}

	return (
		<>
			<div className="sg-sec-head">
				<span className="t">
					Dead letter queue
					{rows !== null && rows.length > 0 && (
						<span className="cnt">{rows.length}</span>
					)}
				</span>
				<span className="r">Replay a block range</span>
			</div>
			<div style={{ marginBottom: 16 }}>{body}</div>
		</>
	);
}
