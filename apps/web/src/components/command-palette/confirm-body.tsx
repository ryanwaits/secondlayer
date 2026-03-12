"use client";

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CommandConfirmResponse, ApiCall, ConfirmResource } from "@/lib/command/types";
import { queryKeys } from "@/lib/queries/keys";

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
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const invalidateCaches = useCallback((apiCall: ApiCall) => {
    if (apiCall.path.includes("/streams")) {
      qc.invalidateQueries({ queryKey: queryKeys.streams.all });
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

  const executeAll = useCallback(async () => {
    setLoading(true);

    const promises = response.apiCalls.map(async (apiCall) => {
      const res = await fetch(apiCall.path, {
        method: apiCall.method,
        headers: apiCall.body ? { "Content-Type": "application/json" } : undefined,
        credentials: "same-origin",
        body: apiCall.body ? JSON.stringify(apiCall.body) : undefined,
      });
      if (!res.ok) throw new Error("Failed");
      invalidateCaches(apiCall);
    });

    await Promise.allSettled(promises);
    setLoading(false);
    setDone(true);
  }, [response.apiCalls, invalidateCaches]);

  const doneColor = getDoneColor(response.title);

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
            done={done}
            doneColor={doneColor}
          />
        ))}
      </div>
      {!done && (
        <div className="palette-confirm-actions">
          <button className="palette-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`palette-btn ${response.destructive ? "palette-btn-danger" : ""}`}
            onClick={executeAll}
            disabled={loading}
          >
            {loading ? "Executing..." : response.title}
          </button>
        </div>
      )}
    </div>
  );
}

function ResourceRow({
  resource,
  done,
  doneColor,
}: {
  resource: ConfirmResource;
  done: boolean;
  doneColor: "green" | "yellow" | "red";
}) {
  const statusForDot = done ? doneColor : resource.status;

  return (
    <div className={`palette-confirm-item ${done ? "palette-confirm-item-done" : ""}`}>
      {statusForDot && <span className={`palette-dot palette-dot-${statusForDot}`} />}
      <span className="palette-confirm-name">{resource.name}</span>
      {resource.meta && !done && <span className="palette-confirm-meta">{resource.meta}</span>}
      {done && (
        <svg className="palette-confirm-check" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 8.5l3 3 5-5.5" />
        </svg>
      )}
    </div>
  );
}

/** Infer the dot color after action completes based on the title verb */
function getDoneColor(title: string): "green" | "yellow" | "red" {
  const lower = title.toLowerCase();
  if (lower.includes("pause") || lower.includes("disable")) return "yellow";
  if (lower.includes("delete") || lower.includes("remove")) return "red";
  return "green";
}
