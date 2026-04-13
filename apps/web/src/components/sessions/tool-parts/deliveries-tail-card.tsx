"use client";

import { useEffect, useState } from "react";

interface Delivery {
	id: string;
	blockHeight: number;
	status: string;
	statusCode: number | null;
	responseTimeMs: number | null;
	error: string | null;
	createdAt: string;
}

interface DeliveriesTailCardProps {
	id: string;
	name: string;
}

const POLL_MS = 3000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;

/**
 * Polls GET /api/streams/:id/deliveries?limit=20 every 3s and renders the
 * most recent delivery attempts. Streams don't have an SSE endpoint yet —
 * polling is fine for the 20-row window and the Sprint 3 backlog has an
 * SSE upgrade if this feels laggy in demo.
 */
export function DeliveriesTailCard({ id, name }: DeliveriesTailCardProps) {
	const [deliveries, setDeliveries] = useState<Delivery[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [stopped, setStopped] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const startedAt = Date.now();

		async function tick() {
			try {
				const res = await fetch(`/api/streams/${id}/deliveries?limit=20`, {
					credentials: "same-origin",
				});
				if (!res.ok) {
					setError(`HTTP ${res.status}`);
					return;
				}
				const data = (await res.json()) as { deliveries: Delivery[] };
				if (!cancelled) setDeliveries(data.deliveries ?? []);
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
				}
			}
		}

		void tick();
		const interval = setInterval(() => {
			if (cancelled || stopped) {
				clearInterval(interval);
				return;
			}
			if (Date.now() - startedAt > MAX_POLL_DURATION_MS) {
				clearInterval(interval);
				setStopped(true);
				return;
			}
			void tick();
		}, POLL_MS);

		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [id, stopped]);

	return (
		<div className="tool-card">
			<div className="tool-card-header">
				Deliveries · {name} {stopped ? "(stopped)" : ""}
			</div>
			{deliveries.length === 0 ? (
				<div className="tool-status-row">
					<div className="tool-action-detail">
						<span className="tool-action-reason">
							Waiting for the first delivery…
						</span>
					</div>
				</div>
			) : (
				<div className="tool-status-row">
					<div className="tool-action-detail">
						{deliveries.map((d) => (
							<span key={d.id} className="tool-action-reason">
								#{d.blockHeight} · {d.status}
								{d.statusCode ? ` (${d.statusCode})` : ""}
								{d.responseTimeMs !== null ? ` · ${d.responseTimeMs}ms` : ""}
								{d.error ? ` · ${d.error}` : ""}
							</span>
						))}
					</div>
				</div>
			)}
			{error && <div className="tool-error-body">{error}</div>}
		</div>
	);
}
