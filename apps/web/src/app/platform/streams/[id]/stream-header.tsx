"use client";

import { useState, useCallback } from "react";
import type { Stream } from "@/lib/types";
import { useStream, usePauseStream, useResumeStream, useReplayFailed } from "@/lib/queries/streams";
import { InsightsSection } from "@/components/console/intelligence/insights-section";

export function StreamHeader({ initialStream, sessionToken }: { initialStream: Stream; sessionToken: string }) {
  const { data: stream = initialStream } = useStream(initialStream.id, initialStream);
  const [pausing, setPausing] = useState<"idle" | "confirm" | "loading">("idle");

  const pauseMutation = usePauseStream();
  const resumeMutation = useResumeStream();
  const replayMutation = useReplayFailed();
  const actionLoading = resumeMutation.isPending || replayMutation.isPending;

  const handlePause = useCallback(() => {
    setPausing("loading");
    pauseMutation.mutate(stream.id, {
      onSettled: () => setPausing("idle"),
    });
  }, [stream.id, pauseMutation]);

  const handleResume = useCallback(() => {
    resumeMutation.mutate({ id: stream.id, status: stream.status });
  }, [stream.id, stream.status, resumeMutation]);

  const handleReplayFailed = useCallback(() => {
    replayMutation.mutate(stream.id);
  }, [stream.id, replayMutation]);

  return (
    <>
      <div className="dash-page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h1 className="dash-page-title">{stream.name}</h1>
          <span className={`dash-badge ${stream.status}`}>{stream.status}</span>
        </div>
        <div className="dash-actions" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {stream.status === "active" && (
            pausing !== "idle" ? (
              <>
                <button className="dash-btn danger" onClick={handlePause}>
                  {pausing === "loading" ? "Pausing..." : "Pause"}
                </button>
                <button className="dash-btn" onClick={() => setPausing("idle")}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="dash-btn" onClick={() => setPausing("confirm")}>
                <span className="btn-icon">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="3" height="10" rx="0.5"/><rect x="9" y="3" width="3" height="10" rx="0.5"/></svg>
                </span>
                Pause
              </button>
            )
          )}
          {(stream.status === "paused" || stream.status === "inactive") && (
            <button className="dash-btn primary" disabled={actionLoading} onClick={handleResume}>
              <span className="btn-icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5a.5.5 0 01.8-.4l7 5a.5.5 0 010 .8l-7 5a.5.5 0 01-.8-.4v-10z"/></svg>
              </span>
              {resumeMutation.isPending ? "Resuming..." : "Resume"}
            </button>
          )}
          {stream.status === "failed" && (
            <>
              <button className="dash-btn primary" disabled={actionLoading} onClick={handleResume}>
                <span className="btn-icon">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8a6 6 0 0110.5-4M14 8a6 6 0 01-10.5 4"/><path d="M12 1v4h-4M4 15v-4h4"/></svg>
                </span>
                {resumeMutation.isPending ? "Restarting..." : "Restart"}
              </button>
              <button className="dash-btn" disabled={actionLoading} onClick={handleReplayFailed}>
                {replayMutation.isPending ? "Replaying..." : "Replay failed"}
              </button>
            </>
          )}
        </div>
      </div>

      {stream.status === "paused" && (
        <div className="dash-status-bar paused">
          Stream paused — events are being buffered but not delivered.
        </div>
      )}
      {stream.status === "failed" && (
        <div className="dash-status-bar failed">
          {stream.errorMessage || "Stream failed due to consecutive delivery errors."}
        </div>
      )}

      <InsightsSection category="stream" resourceId={stream.id} sessionToken={sessionToken} />
    </>
  );
}
