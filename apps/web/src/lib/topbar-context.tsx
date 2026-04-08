"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState } from "react";

export type RefreshInterval = number | null;

export const REFRESH_OPTIONS: { value: RefreshInterval; label: string }[] = [
	{ value: null, label: "Auto-refresh off" },
	{ value: 10_000, label: "Every 10s" },
	{ value: 30_000, label: "Every 30s" },
	{ value: 60_000, label: "Every 60s" },
];

interface TopbarState {
	autoRefresh: RefreshInterval;
	setAutoRefresh: (v: RefreshInterval) => void;
	autoRefreshLabel: string;
}

const TopbarCtx = createContext<TopbarState>({
	autoRefresh: null,
	setAutoRefresh: () => {},
	autoRefreshLabel: "Auto-refresh off",
});

export function useTopbar() {
	return useContext(TopbarCtx);
}

export function TopbarProvider({ children }: { children: React.ReactNode }) {
	const [autoRefresh, setAutoRefresh] = useState<RefreshInterval>(null);
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

	return (
		<TopbarCtx.Provider
			value={{
				autoRefresh,
				setAutoRefresh,
				autoRefreshLabel: refreshLabel,
			}}
		>
			{children}
		</TopbarCtx.Provider>
	);
}
