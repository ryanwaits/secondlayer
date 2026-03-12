"use client";

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CommandConfirmResponse, ApiCall, ConfirmResource } from "@/lib/command/types";
import { queryKeys } from "@/lib/queries/keys";

type ResourceState = "idle" | "loading" | "done" | "error";

export function ConfirmBody({
  response,
  onExecuteAll,
  onCancel,
}: {
  response: CommandConfirmResponse;
  onExecuteAll: (apiCalls: ApiCall[]) => Promise<void>;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [resourceStates, setResourceStates] = useState<Record<number, ResourceState>>(
    () => Object.fromEntries(response.resources.map((_, i) => [i, "idle"])),
  );
  const [bulkLoading, setBulkLoading] = useState(false);

  const allDone = Object.values(resourceStates).every((s) => s === "done");

  const invalidateCaches = useCallback((apiCall: ApiCall) => {
    // Invalidate relevant query caches based on the API path
    if (apiCall.path.includes("/streams")) {
      qc.invalidateQueries({ queryKey: queryKeys.streams.all });
      // Extract stream ID from path like /api/streams/:id/pause
      const match = apiCall.path.match(/\/api\/streams\/([^/]+)/);
      if (match) {
        qc.invalidateQueries({ queryKey: queryKeys.streams.detail(match[1]) });
      }
    }
    if (apiCall.path.includes("/keys")) {
      qc.invalidateQueries({ queryKey: queryKeys.keys.all });
    }
    if (apiCall.path.includes("/views")) {
      qc.invalidateQueries({ queryKey: queryKeys.views.all });
    }
  }, [qc]);

  const executeOne = useCallback(async (index: number, apiCall: ApiCall) => {
    setResourceStates((prev) => ({ ...prev, [index]: "loading" }));
    try {
      const res = await fetch(apiCall.path, {
        method: apiCall.method,
        headers: apiCall.body ? { "Content-Type": "application/json" } : undefined,
        credentials: "same-origin",
        body: apiCall.body ? JSON.stringify(apiCall.body) : undefined,
      });
      if (!res.ok) throw new Error("Failed");
      setResourceStates((prev) => ({ ...prev, [index]: "done" }));
      invalidateCaches(apiCall);
    } catch {
      setResourceStates((prev) => ({ ...prev, [index]: "error" }));
    }
  }, [invalidateCaches]);

  const executeAll = useCallback(async () => {
    setBulkLoading(true);
    // Mark all idle as loading
    setResourceStates((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (next[Number(key)] === "idle") next[Number(key)] = "loading";
      }
      return next;
    });

    // Execute each resource's individual apiCall
    const promises = response.resources.map(async (resource, i) => {
      if (resourceStates[i] === "done") return; // skip already done
      const apiCall = resource.apiCall || response.apiCalls[i];
      if (!apiCall) return;
      try {
        const res = await fetch(apiCall.path, {
          method: apiCall.method,
          headers: apiCall.body ? { "Content-Type": "application/json" } : undefined,
          credentials: "same-origin",
          body: apiCall.body ? JSON.stringify(apiCall.body) : undefined,
        });
        if (!res.ok) throw new Error("Failed");
        setResourceStates((prev) => ({ ...prev, [i]: "done" }));
        invalidateCaches(apiCall);
      } catch {
        setResourceStates((prev) => ({ ...prev, [i]: "error" }));
      }
    });

    await Promise.allSettled(promises);
    setBulkLoading(false);
  }, [response, resourceStates, invalidateCaches]);

  return (
    <div className="palette-confirm">
      <div className="palette-confirm-header">{response.title}</div>
      {response.description && (
        <div className="palette-confirm-desc">{response.description}</div>
      )}
      <div className="palette-confirm-list">
        {response.resources.map((r, i) => (
          <ResourceRow
            key={i}
            resource={r}
            state={resourceStates[i]}
            onExecute={r.apiCall ? () => executeOne(i, r.apiCall!) : undefined}
            actionLabel={getActionLabel(response.title)}
            doneColor={getDoneColor(response.title)}
          />
        ))}
      </div>
      {!allDone && (
        <div className="palette-confirm-actions">
          <button className="palette-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`palette-btn ${response.destructive ? "palette-btn-danger" : ""}`}
            onClick={executeAll}
            disabled={bulkLoading}
          >
            {bulkLoading ? "Executing..." : response.title}
          </button>
        </div>
      )}
    </div>
  );
}

function ResourceRow({
  resource,
  state,
  onExecute,
  actionLabel,
  doneColor,
}: {
  resource: ConfirmResource;
  state: ResourceState;
  onExecute?: () => void;
  actionLabel: string;
  doneColor: "green" | "yellow" | "red";
}) {
  const statusForDot = state === "done" ? doneColor : state === "error" ? "red" : resource.status;

  return (
    <div className={`palette-confirm-item ${state === "done" ? "palette-confirm-item-done" : ""}`}>
      {statusForDot && <span className={`palette-dot palette-dot-${statusForDot}`} />}
      <span className="palette-confirm-name">{resource.name}</span>
      {resource.meta && state !== "done" && <span className="palette-confirm-meta">{resource.meta}</span>}
      {onExecute && state === "idle" && (
        <button className="palette-btn palette-btn-inline" onClick={onExecute}>
          {actionLabel}
        </button>
      )}
      {state === "loading" && (
        <span className="palette-confirm-loading">
          <div className="dot-pulse dot-pulse-sm">
            <span /><span /><span />
          </div>
        </span>
      )}
      {state === "done" && (
        <svg className="palette-confirm-check" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 8.5l3 3 5-5.5" />
        </svg>
      )}
      {state === "error" && (
        <span className="palette-confirm-error-icon">!</span>
      )}
    </div>
  );
}

/** Extract a short verb from the title like "Pause All Streams" → "Pause" */
function getActionLabel(title: string): string {
  const first = title.split(" ")[0];
  return first || "Run";
}

/** Infer the dot color after action completes based on the title verb */
function getDoneColor(title: string): "green" | "yellow" | "red" {
  const lower = title.toLowerCase();
  if (lower.includes("pause") || lower.includes("disable")) return "yellow";
  if (lower.includes("delete") || lower.includes("remove")) return "red";
  return "green";
}
