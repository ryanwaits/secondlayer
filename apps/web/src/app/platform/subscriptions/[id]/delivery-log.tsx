"use client";

import { useEffect, useState } from "react";

interface Delivery {
	id: string;
	attempt: number;
	statusCode: number | null;
	errorMessage: string | null;
	durationMs: number | null;
	responseBody: string | null;
	dispatchedAt: string;
}

export function DeliveryLog({ subscriptionId }: { subscriptionId: string }) {
	const [rows, setRows] = useState<Delivery[] | null>(null);
	const [err, setErr] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		async function poll() {
			try {
				const res = await fetch(`/api/subscriptions/${subscriptionId}/deliveries`, {
					credentials: "same-origin",
				});
				const body = (await res.json()) as {
					data?: Delivery[];
					error?: string;
				};
				if (cancelled) return;
				if (!res.ok) {
					setErr(body.error ?? `HTTP ${res.status}`);
					return;
				}
				setRows(body.data ?? []);
				setErr(null);
			} catch (e) {
				if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
			}
		}
		void poll();
		const interval = setInterval(poll, 5_000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [subscriptionId]);

	if (err) {
		return <p style={{ color: "var(--error)" }}>{err}</p>;
	}
	if (rows === null) {
		return <p className="detail-desc">Loading…</p>;
	}
	if (rows.length === 0) {
		return (
			<p className="detail-desc">
				No deliveries yet. Fire an event matching this subscription's filter to
				see attempts here.
			</p>
		);
	}

	return (
		<table className="index-table">
			<thead>
				<tr>
					<th>Attempt</th>
					<th>Status</th>
					<th>Duration</th>
					<th>When</th>
					<th>Response</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((d) => (
					<tr key={d.id}>
						<td>{d.attempt}</td>
						<td>
							<code>{d.statusCode ?? d.errorMessage ?? "—"}</code>
						</td>
						<td>{d.durationMs != null ? `${d.durationMs}ms` : "—"}</td>
						<td>{new Date(d.dispatchedAt).toLocaleTimeString()}</td>
						<td>
							<code style={{ fontSize: 11 }}>
								{(d.responseBody ?? "").slice(0, 80) || "—"}
							</code>
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
