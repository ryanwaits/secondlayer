"use client";

import { createStreamsClient, type StreamsTip } from "@secondlayer/sdk/streams";
import { useCallback, useEffect, useMemo, useState } from "react";
import { determineApiHealth } from "@/lib/status-page";
import { StatusGridView, type StatusSnapshot } from "./status-grid-view";

const STREAMS_STATUS_API_KEY =
	process.env.NEXT_PUBLIC_STREAMS_STATUS_API_KEY ??
	"sk-sl_streams_status_public";
const STREAMS_API_URL =
	process.env.NEXT_PUBLIC_STREAMS_API_URL ?? "https://api.secondlayer.tools";
const REFRESH_MS = 30_000;

const initialSnapshot: StatusSnapshot = {
	health: {
		state: "checking",
		label: "Checking",
		description: "The first tip request has not completed.",
	},
	tip: null,
	lastChecked: null,
	error: null,
};

export function StatusClient({ incidentHeading }: { incidentHeading: string }) {
	const client = useMemo(
		() =>
			createStreamsClient({
				apiKey: STREAMS_STATUS_API_KEY,
				baseUrl: STREAMS_API_URL,
			}),
		[],
	);
	const [snapshot, setSnapshot] = useState<StatusSnapshot>(initialSnapshot);

	const refresh = useCallback(async () => {
		const checkedAt = new Date();
		try {
			const tip = await client.tip();
			setSnapshot({
				health: determineApiHealth({ ok: true, tip }),
				tip,
				lastChecked: checkedAt,
				error: null,
			});
		} catch (error) {
			setSnapshot({
				health: determineApiHealth({ ok: false, error }),
				tip: null,
				lastChecked: checkedAt,
				error: error instanceof Error ? error.message : "Tip request failed.",
			});
		}
	}, [client]);

	useEffect(() => {
		void refresh();
		const timer = window.setInterval(() => void refresh(), REFRESH_MS);
		return () => window.clearInterval(timer);
	}, [refresh]);

	return (
		<StatusGridView snapshot={snapshot} incidentHeading={incidentHeading} />
	);
}
