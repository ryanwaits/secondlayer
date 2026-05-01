import { queryKeys } from "@/lib/queries/keys";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiCall, CommandResponse, PaletteMode } from "./types";

export function useCommandAI(
	query: string,
	hasFuzzyResults: boolean,
	pathname: string,
) {
	const qc = useQueryClient();
	const [mode, setMode] = useState<PaletteMode>("actions");
	const [response, setResponse] = useState<CommandResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const reset = useCallback(() => {
		abortRef.current?.abort();
		setMode("actions");
		setResponse(null);
		setError(null);
	}, []);

	// Switch to agent-ready mode when no fuzzy results, back to actions when there are
	// biome-ignore lint/correctness/useExhaustiveDependencies: react only to query/result changes; mode is read-current to avoid loops
	useEffect(() => {
		if (!hasFuzzyResults && query.length > 0) {
			// Only switch to agent if we're in a passive state
			if (mode === "actions" || mode === "agent") {
				setMode("agent");
			}
		} else {
			if (mode === "agent") {
				setMode("actions");
			}
		}
	}, [query, hasFuzzyResults]);

	// Submit query to AI — called explicitly by palette on Enter
	const submit = useCallback(() => {
		if (!query.trim()) return;

		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;

		setMode("thinking");
		setError(null);

		fetch("/api/command", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "same-origin",
			signal: controller.signal,
			body: JSON.stringify({
				query,
				context: { path: pathname },
			}),
		})
			.then(async (res) => {
				if (!res.ok) {
					const data = await res
						.json()
						.catch(() => ({ error: "Request failed" }));
					throw new Error(data.error || "Request failed");
				}
				return res.json() as Promise<CommandResponse>;
			})
			.then((data) => {
				if (controller.signal.aborted) return;
				setResponse(data);
				setMode(data.type);
			})
			.catch((err) => {
				if (err instanceof DOMException && err.name === "AbortError") return;
				setError(err.message || "Something went wrong");
				setMode("error");
			});
	}, [query, pathname]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			abortRef.current?.abort();
		};
	}, []);

	const invalidateCaches = useCallback(
		(apiCall: ApiCall) => {
			if (apiCall.path.includes("/keys")) {
				qc.invalidateQueries({ queryKey: queryKeys.keys.all });
			}
			if (apiCall.path.includes("/subgraphs")) {
				qc.invalidateQueries({ queryKey: queryKeys.subgraphs.all });
			}
		},
		[qc],
	);

	const execute = useCallback(
		async (apiCalls: ApiCall[]): Promise<string> => {
			setMode("thinking");
			try {
				const results: string[] = [];
				for (const call of apiCalls) {
					const res = await fetch(call.path, {
						method: call.method,
						headers: call.body
							? { "Content-Type": "application/json" }
							: undefined,
						credentials: "same-origin",
						body: call.body ? JSON.stringify(call.body) : undefined,
					});
					if (!res.ok) {
						const data = await res.json().catch(() => ({ error: "Failed" }));
						throw new Error(data.error || `${call.method} ${call.path} failed`);
					}
					invalidateCaches(call);
					results.push(`${call.method} ${call.path}`);
				}
				setMode("success");
				return `Executed ${results.length} action${results.length !== 1 ? "s" : ""}`;
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Execution failed";
				setError(msg);
				setMode("error");
				throw err;
			}
		},
		[invalidateCaches],
	);

	return { mode, response, error, reset, submit, execute };
}
