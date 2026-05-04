"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { determinePublicStatusHealth } from "@/lib/status-page";
import type { SystemStatus } from "@/lib/types";
import { StatusGridView, type StatusSnapshot } from "./status-grid-view";

const STATUS_API_URL =
	process.env.NEXT_PUBLIC_STREAMS_API_URL ?? "https://api.secondlayer.tools";
const REFRESH_MS = 30_000;

const initialSnapshot: StatusSnapshot = {
	health: {
		state: "checking",
		label: "Checking",
		description: "The first tip request has not completed.",
	},
	tip: null,
	index: null,
	api: null,
	node: null,
	services: [],
	reorgs: null,
	lastChecked: null,
	error: null,
};

export function StatusClient({ incidentHeading }: { incidentHeading: string }) {
	const statusUrl = useMemo(() => `${STATUS_API_URL}/public/status`, []);
	const [snapshot, setSnapshot] = useState<StatusSnapshot>(initialSnapshot);

	const refresh = useCallback(async () => {
		const checkedAt = new Date();
		try {
			const response = await fetch(statusUrl, { cache: "no-store" });
			if (!response.ok) {
				throw new Error(`Status request failed with HTTP ${response.status}.`);
			}

			const status = (await response.json()) as SystemStatus;
			const tip = status.streams?.tip ?? null;
			setSnapshot({
				health: determinePublicStatusHealth(status),
				tip,
				index: status.index ?? null,
				api: status.api ?? null,
				node: status.node ?? null,
				services: status.services ?? [],
				reorgs: status.reorgs ?? null,
				lastChecked: checkedAt,
				error: null,
			});
		} catch (error) {
			setSnapshot({
				health: determinePublicStatusHealth(null),
				tip: null,
				index: null,
				api: null,
				node: null,
				services: [],
				reorgs: null,
				lastChecked: checkedAt,
				error:
					error instanceof Error ? error.message : "Status request failed.",
			});
		}
	}, [statusUrl]);

	useEffect(() => {
		void refresh();
		const timer = window.setInterval(() => void refresh(), REFRESH_MS);
		return () => window.clearInterval(timer);
	}, [refresh]);

	return (
		<StatusGridView snapshot={snapshot} incidentHeading={incidentHeading} />
	);
}
