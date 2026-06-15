"use client";

import {
	type StatusSnapshot,
	determinePublicStatusHealth,
	snapshotFromSystemStatus,
} from "@/lib/status-page";
import type { SystemStatus } from "@/lib/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusMinimalView } from "./status-minimal-view";

const STATUS_API_URL =
	process.env.NEXT_PUBLIC_STREAMS_API_URL ?? "https://api.secondlayer.tools";
const REFRESH_MS = 30_000;

const checkingSnapshot: StatusSnapshot = {
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
	lastChecked: null,
	error: null,
};

export function StatusClient({
	initialSnapshot,
}: {
	/** Server-rendered first paint — avoids a "Checking…" flash in the header.
	 *  Null when the server probe failed; the client poll fills it in. */
	initialSnapshot?: StatusSnapshot | null;
}) {
	const statusUrl = useMemo(() => `${STATUS_API_URL}/public/status`, []);
	const [snapshot, setSnapshot] = useState<StatusSnapshot>(
		initialSnapshot ?? checkingSnapshot,
	);
	const [isRefreshing, setIsRefreshing] = useState(false);

	const refresh = useCallback(async () => {
		const checkedAt = new Date();
		setIsRefreshing(true);
		try {
			const response = await fetch(statusUrl, { cache: "no-store" });
			if (!response.ok) {
				throw new Error(`Status request failed with HTTP ${response.status}.`);
			}

			const status = (await response.json()) as SystemStatus;
			setSnapshot(snapshotFromSystemStatus(status, checkedAt));
		} catch (error) {
			setSnapshot({
				health: determinePublicStatusHealth(null),
				tip: null,
				index: null,
				api: null,
				node: null,
				services: [],
				lastChecked: checkedAt,
				error:
					error instanceof Error ? error.message : "Status request failed.",
			});
		} finally {
			setIsRefreshing(false);
		}
	}, [statusUrl]);

	useEffect(() => {
		void refresh();
		const timer = window.setInterval(() => void refresh(), REFRESH_MS);
		return () => window.clearInterval(timer);
	}, [refresh]);

	return <StatusMinimalView snapshot={snapshot} isRefreshing={isRefreshing} />;
}
