"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState } from "react";

export type TimeRange = "24h" | "7d" | "30d";
export type RefreshInterval = number | null;

export const REFRESH_OPTIONS: { value: RefreshInterval; label: string }[] = [
	{ value: null, label: "Auto-refresh off" },
	{ value: 10_000, label: "Every 10s" },
	{ value: 30_000, label: "Every 30s" },
	{ value: 60_000, label: "Every 60s" },
];

export const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
	{ value: "24h", label: "Past 24 hours" },
	{ value: "7d", label: "Past 7 days" },
	{ value: "30d", label: "Past 30 days" },
];

interface TopbarState {
	autoRefresh: RefreshInterval;
	timeRange: TimeRange;
	setAutoRefresh: (v: RefreshInterval) => void;
	setTimeRange: (v: TimeRange) => void;
	autoRefreshLabel: string;
	timeRangeLabel: string;
}

const TopbarCtx = createContext<TopbarState>({
	autoRefresh: null,
	timeRange: "7d",
	setAutoRefresh: () => {},
	setTimeRange: () => {},
	autoRefreshLabel: "Auto-refresh off",
	timeRangeLabel: "Past 7 days",
});

export function useTopbar() {
	return useContext(TopbarCtx);
}

export function TopbarProvider({ children }: { children: React.ReactNode }) {
	const [autoRefresh, setAutoRefresh] = useState<RefreshInterval>(null);
	const [timeRange, setTimeRange] = useState<TimeRange>("7d");
	const queryClient = useQueryClient();
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		if (intervalRef.current) clearInterval(intervalRef.current);
		if (autoRefresh) {
			intervalRef.current = setInterval(() => {
				queryClient.invalidateQueries();
			}, autoRefresh);
		}
		return () => {
			if (intervalRef.current) clearInterval(intervalRef.current);
		};
	}, [autoRefresh, queryClient]);

	const refreshLabel = REFRESH_OPTIONS.find((o) => o.value === autoRefresh)?.label ?? "Auto-refresh off";
	const rangeLabel = TIME_RANGE_OPTIONS.find((o) => o.value === timeRange)?.label ?? "Past 7 days";

	return (
		<TopbarCtx.Provider
			value={{
				autoRefresh,
				timeRange,
				setAutoRefresh,
				setTimeRange,
				autoRefreshLabel: refreshLabel,
				timeRangeLabel: rangeLabel,
			}}
		>
			{children}
		</TopbarCtx.Provider>
	);
}
