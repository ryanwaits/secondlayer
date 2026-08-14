"use client";

import { consoleFetch } from "@/lib/client-fetch";
import type { DeadRow } from "@/lib/types";
import { useEffect, useState } from "react";

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

	if (err) return <p style={{ color: "var(--error)" }}>{err}</p>;
	if (rows === null) return <p className="detail-desc">Loading…</p>;
	if (rows.length === 0) {
		return (
			<p className="detail-desc">
				No dead rows. Delivery attempts that fail all 7 retries land here
				awaiting manual requeue.
			</p>
		);
	}

	return (
		<table className="index-table">
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
						<td>
							<code>{r.eventType}</code>
						</td>
						<td>{r.blockHeight}</td>
						<td>{r.failedAt ? new Date(r.failedAt).toLocaleString() : "—"}</td>
						<td>
							<code style={{ fontSize: 11 }}>
								{JSON.stringify(r.payload).slice(0, 60)}…
							</code>
						</td>
						<td>
							<button
								type="button"
								className="btn-secondary"
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
	);
}
