"use client";

import { consoleFetch } from "@/lib/client-fetch";
import { timeAgo } from "@/lib/format";
import type { DeliveryRow } from "@/lib/types";
import { useEffect, useState } from "react";

function isOk(d: DeliveryRow): boolean {
	return d.statusCode !== null && d.statusCode >= 200 && d.statusCode < 400;
}

/**
 * The last 100 delivery attempts, polling every 5s. Owns its section chrome
 * so the head count tracks the live log rather than a stale server snapshot.
 */
export function DeliveryLog({ subscriptionId }: { subscriptionId: string }) {
	const [rows, setRows] = useState<DeliveryRow[] | null>(null);
	const [err, setErr] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		async function poll() {
			try {
				const res = await consoleFetch(
					`/api/subscriptions/${encodeURIComponent(subscriptionId)}/deliveries`,
				);
				const body = (await res.json()) as {
					data?: DeliveryRow[];
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

	let body: React.ReactNode;
	if (err) {
		body = <p style={{ color: "var(--error)" }}>{err}</p>;
	} else if (rows === null) {
		body = <p className="detail-desc">Loading…</p>;
	} else if (rows.length === 0) {
		body = (
			<p className="detail-desc">
				No deliveries yet. Fire an event matching this subscription's filter to
				see attempts here.
			</p>
		);
	} else {
		body = (
			<div className="table-scroll">
				<table className="sg">
					<thead>
						<tr>
							<th>#</th>
							<th>Status</th>
							<th>Block</th>
							<th>Duration</th>
							<th>Dispatched</th>
							<th>Error</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((d) => (
							<tr key={d.id}>
								<td className="mono">
									{d.seq != null ? d.seq.toLocaleString() : d.attempt}
								</td>
								<td>
									<span className={`code ${isOk(d) ? "ok" : "bad"}`}>
										{d.statusCode ?? "—"}
									</span>
								</td>
								<td className="mono">
									{d.blockHeight != null
										? `#${d.blockHeight.toLocaleString()}`
										: "—"}
								</td>
								<td className="mono">
									{d.durationMs != null
										? `${d.durationMs.toLocaleString()}ms`
										: "—"}
								</td>
								<td>{timeAgo(d.dispatchedAt)}</td>
								<td>{d.errorMessage ?? "—"}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}

	return (
		<section className="sg-sec">
			<div className="sg-sec-head">
				<span className="t">
					Delivery log
					{rows !== null && rows.length > 0 && (
						<span className="cnt">{rows.length}</span>
					)}
				</span>
				<span className="r">polling · 5s</span>
			</div>
			{body}
		</section>
	);
}
