"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import type { Stream } from "@/lib/types";
import { useQueryClient } from "@tanstack/react-query";
import { useStreams, usePauseStream, useResumeStream } from "@/lib/queries/streams";
import { queryKeys } from "@/lib/queries/keys";
import { AgentPromptBlock } from "@/components/console/agent-prompt";
import { ActionDropdown } from "@/components/console/action-dropdown";
import { STREAMS_EMPTY_PROMPT } from "@/lib/agent-prompts";

function StreamRow({ stream }: { stream: Stream }) {
  const [confirmPause, setConfirmPause] = useState(false);
  const pause = usePauseStream();
  const resume = useResumeStream();
  const loading = pause.isPending || resume.isPending;
  const qc = useQueryClient();

  const prefetch = useCallback(() => {
    qc.prefetchQuery({
      queryKey: queryKeys.streams.detail(stream.id),
      queryFn: () =>
        fetch(`/api/streams/${stream.id}`, { credentials: "same-origin" }).then((r) => r.json()),
      staleTime: 30_000,
    });
  }, [qc, stream.id]);

  const handlePause = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setConfirmPause(false);
      pause.mutate(stream.id);
    },
    [stream.id, pause],
  );

  const handleResume = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resume.mutate({ id: stream.id, status: stream.status });
    },
    [stream.id, stream.status, resume],
  );

  return (
    <div className="dash-index-item stream-row">
      <Link href={`/streams/${stream.id}`} className="dash-index-link" onMouseEnter={prefetch}>
        <span className="dash-index-label">{stream.name}</span>
        <span className="dash-index-meta">
          <span className={`dash-badge ${stream.status}`}>{stream.status}</span>
          {stream.status === "failed"
            ? `${stream.failedDeliveries.toLocaleString()} drops`
            : `${stream.totalDeliveries.toLocaleString()} deliveries`}
        </span>
      </Link>
      <div className="stream-row-actions" onClick={(e) => e.preventDefault()}>
        {confirmPause ? (
          <>
            <button
              className="icon-btn-text danger"
              onClick={(e) => handlePause(e)}
              disabled={loading}
            >
              Pause
            </button>
            <button
              className="icon-btn-text"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmPause(false); }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {stream.status === "active" && (
              <button
                className="icon-btn pause"
                title="Pause"
                disabled={loading}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmPause(true); }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="4" y="3" width="3" height="10" rx="0.5" />
                  <rect x="9" y="3" width="3" height="10" rx="0.5" />
                </svg>
              </button>
            )}
            {(stream.status === "paused" || stream.status === "failed" || stream.status === "inactive") && (
              <button
                className="icon-btn resume"
                title={stream.status === "failed" ? "Restart" : "Resume"}
                disabled={loading}
                onClick={(e) => handleResume(e)}
              >
                {stream.status === "failed" ? (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2 8a6 6 0 0110.5-4M14 8a6 6 0 01-10.5 4" />
                    <path d="M12 1v4h-4M4 15v-4h4" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M5 3.5a.5.5 0 01.8-.4l7 5a.5.5 0 010 .8l-7 5a.5.5 0 01-.8-.4v-10z" />
                  </svg>
                )}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function StreamsList({ initialStreams }: { initialStreams: Stream[] }) {
  const { data: streams = initialStreams } = useStreams(initialStreams);

  const active = streams.filter((s) => s.status === "active");
  const paused = streams.filter((s) => s.status === "paused");
  const failed = streams.filter((s) => s.status === "failed");
  const inactive = streams.filter((s) => s.status === "inactive");

  const parts: string[] = [];
  if (active.length) parts.push(`${active.length} active`);
  if (paused.length) parts.push(`${paused.length} paused`);
  if (failed.length) parts.push(`${failed.length} failed`);
  if (inactive.length) parts.push(`${inactive.length} inactive`);

  const groups: { label: string; items: Stream[] }[] = [];
  if (active.length) groups.push({ label: "Active", items: active });
  if (paused.length) groups.push({ label: "Paused", items: paused });
  if (failed.length) groups.push({ label: "Failed", items: failed });
  if (inactive.length) groups.push({ label: "Inactive", items: inactive });

  return (
    <>
      <div className="dash-page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1 className="dash-page-title">Streams</h1>
          {streams.length > 0 && (
            <p className="dash-page-desc">
              {streams.length} stream{streams.length !== 1 ? "s" : ""} — {parts.join(", ")}
            </p>
          )}
        </div>
        <ActionDropdown variant="streams" />
      </div>

      {streams.length === 0 ? (
        <>
          <div className="dash-section-wrap">
            <hr />
            <h2 className="dash-section-title">Get started</h2>
          </div>

          <AgentPromptBlock
            title="Paste this into your agent"
            code={STREAMS_EMPTY_PROMPT}
          />
        </>
      ) : (
        groups.map((group) => (
          <div key={group.label}>
            <div className="dash-section-wrap">
              <hr />
              <h2 className="dash-section-title">{group.label}</h2>
            </div>
            <div className="dash-index-group">
              {group.items.map((stream) => (
                <StreamRow key={stream.id} stream={stream} />
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}
