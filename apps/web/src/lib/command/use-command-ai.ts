import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PaletteMode,
  CommandResponse,
  ApiCall,
} from "./types";

export function useCommandAI(
  query: string,
  hasFuzzyResults: boolean,
  pathname: string,
) {
  const [mode, setMode] = useState<PaletteMode>("actions");
  const [response, setResponse] = useState<CommandResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    if (timerRef.current) clearTimeout(timerRef.current);
    setMode("actions");
    setResponse(null);
    setError(null);
  }, []);

  // Debounced AI call when no fuzzy results
  useEffect(() => {
    // If fuzzy has results or query too short, reset to actions
    if (hasFuzzyResults || query.length < 3) {
      if (mode === "thinking") reset();
      else if (mode === "actions") {
        // Already in actions, just cancel any pending
        abortRef.current?.abort();
        if (timerRef.current) clearTimeout(timerRef.current);
      }
      return;
    }

    // Debounce 300ms
    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current?.abort();

    timerRef.current = setTimeout(() => {
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
            const data = await res.json().catch(() => ({ error: "Request failed" }));
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
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, hasFuzzyResults, pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const execute = useCallback(async (apiCalls: ApiCall[]): Promise<string> => {
    setMode("thinking");
    try {
      const results: string[] = [];
      for (const call of apiCalls) {
        const res = await fetch(call.path, {
          method: call.method,
          headers: call.body ? { "Content-Type": "application/json" } : undefined,
          credentials: "same-origin",
          body: call.body ? JSON.stringify(call.body) : undefined,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Failed" }));
          throw new Error(data.error || `${call.method} ${call.path} failed`);
        }
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
  }, []);

  return { mode, response, error, reset, execute };
}
