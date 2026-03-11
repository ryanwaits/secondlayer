"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Stream, Delivery } from "@/lib/types";
import { useBreadcrumbOverrides } from "@/lib/breadcrumb";

function relativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function highlightJson(data: unknown): React.ReactNode[] {
  const raw = JSON.stringify(data, null, 2);
  const parts: React.ReactNode[] = [];
  let i = 0;
  const re = /"([^"\\]|\\.)*"/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    if (match.index > i) parts.push(raw.slice(i, match.index));
    parts.push(
      <span key={match.index} className="json-string">
        {match[0]}
      </span>,
    );
    i = match.index + match[0].length;
  }
  if (i < raw.length) parts.push(raw.slice(i));
  return parts;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return n.toLocaleString();
}

export function StreamDetailClient({
  stream: initialStream,
  deliveries,
}: {
  stream: Stream;
  deliveries: Delivery[];
}) {
  const router = useRouter();
  const { set: setBreadcrumb } = useBreadcrumbOverrides();
  const [stream, setStream] = useState(initialStream);
  useEffect(() => {
    setBreadcrumb(`/streams/${stream.id}`, stream.name);
  }, [stream.id, stream.name, setBreadcrumb]);
  const [secretRevealed, setSecretRevealed] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const [deleting, setDeleting] = useState<"idle" | "confirm" | "deleting">("idle");
  const [disabling, setDisabling] = useState(false);
  const [pausing, setPausing] = useState<"idle" | "confirm" | "loading">("idle");
  const [actionLoading, setActionLoading] = useState(false);

  const handleDelete = useCallback(async () => {
    setDeleting("deleting");
    try {
      const res = await fetch(`/api/streams/${stream.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      router.push("/streams");
    } catch {
      setDeleting("idle");
    }
  }, [stream.id, router]);

  const handlePause = useCallback(async () => {
    setPausing("loading");
    try {
      const res = await fetch(`/api/streams/${stream.id}/pause`, { method: "POST" });
      if (!res.ok) throw new Error();
      setStream((s) => ({ ...s, status: "paused", enabled: true }));
    } catch {}
    setPausing("idle");
  }, [stream.id]);

  const handleResume = useCallback(async () => {
    setActionLoading(true);
    try {
      const endpoint = stream.status === "failed" || stream.status === "inactive"
        ? "enable" : "resume";
      const res = await fetch(`/api/streams/${stream.id}/${endpoint}`, { method: "POST" });
      if (!res.ok) throw new Error();
      setStream((s) => ({ ...s, status: "active", enabled: true, errorMessage: null }));
    } catch {}
    setActionLoading(false);
  }, [stream.id, stream.status]);

  const handleToggleEnabled = useCallback(async () => {
    setDisabling(true);
    try {
      const action = stream.status === "inactive" ? "enable" : "disable";
      const res = await fetch(`/api/streams/${stream.id}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error();
      setStream((s) => ({
        ...s,
        status: action === "disable" ? "inactive" : "active",
        enabled: action === "enable",
      }));
    } catch {}
    setDisabling(false);
  }, [stream.id, stream.status]);

  const handleReplayFailed = useCallback(async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/streams/${stream.id}/replay-failed`, { method: "POST" });
      if (!res.ok) throw new Error();
    } catch {}
    setActionLoading(false);
  }, [stream.id]);

  const successRate =
    stream.totalDeliveries > 0
      ? (
          ((stream.totalDeliveries - stream.failedDeliveries) /
            stream.totalDeliveries) *
          100
        ).toFixed(1)
      : "—";

  const avgResponseTime =
    deliveries.length > 0
      ? Math.round(
          deliveries.reduce((sum, d) => sum + d.responseTimeMs, 0) /
            deliveries.length,
        )
      : 0;

  return (
    <>
      {/* Header */}
      <div className="dash-page-header">
        <div className="dash-page-header-row">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
              <h1 className="dash-page-title">{stream.name}</h1>
              <span className={`dash-badge ${stream.status}`}>
                {stream.status}
              </span>
            </div>
            <p className="dash-page-desc">Created {formatDate(stream.createdAt)}</p>
          </div>
          <div className="dash-actions">
            {stream.status === "active" && (
              <button
                className="dash-btn"
                disabled={pausing === "loading"}
                onClick={() => setPausing("confirm")}
              >
                <span className="btn-icon">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="3" height="10" rx="0.5"/><rect x="9" y="3" width="3" height="10" rx="0.5"/></svg>
                </span>
                Pause
              </button>
            )}
            {(stream.status === "paused" || stream.status === "inactive") && (
              <button
                className="dash-btn primary"
                disabled={actionLoading}
                onClick={handleResume}
              >
                <span className="btn-icon">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5a.5.5 0 01.8-.4l7 5a.5.5 0 010 .8l-7 5a.5.5 0 01-.8-.4v-10z"/></svg>
                </span>
                {actionLoading ? "Resuming..." : "Resume"}
              </button>
            )}
            {stream.status === "failed" && (
              <>
                <button
                  className="dash-btn primary"
                  disabled={actionLoading}
                  onClick={handleResume}
                >
                  <span className="btn-icon">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8a6 6 0 0110.5-4M14 8a6 6 0 01-10.5 4"/><path d="M12 1v4h-4M4 15v-4h4"/></svg>
                  </span>
                  {actionLoading ? "Restarting..." : "Restart"}
                </button>
                <button
                  className="dash-btn"
                  disabled={actionLoading}
                  onClick={handleReplayFailed}
                >
                  Replay failed
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Pause confirmation */}
      {pausing === "confirm" && (
        <div className="dash-confirm-inline">
          <span>Pause this stream? Events will be buffered until resumed.</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="dash-btn danger" style={{ fontSize: 12, padding: "4px 12px" }} onClick={handlePause}>
              Pause
            </button>
            <button className="dash-btn" style={{ fontSize: 12, padding: "4px 12px" }} onClick={() => setPausing("idle")}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="dash-stats">
        <div className="dash-stat">
          <span className="dash-stat-value">
            {formatNum(stream.totalDeliveries)}
          </span>
          <span className="dash-stat-label">deliveries</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">{successRate}%</span>
          <span className="dash-stat-label">success</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">{avgResponseTime}</span>
          <span className="dash-stat-label">avg ms</span>
        </div>
      </div>

      {/* Filters */}
      <div id="filters" className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Filters</h2>
      </div>
      <pre className="dash-code-block">
        {highlightJson(stream.filters)}
      </pre>

      {/* Webhook */}
      <div id="webhook" className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Webhook</h2>
      </div>
      <div className="dash-index-group">
        <div className="dash-index-item">
          <div className="dash-index-link">
            <span className="dash-index-label">URL</span>
            <span className="dash-index-meta">
              <code>{stream.webhookUrl}</code>
            </span>
          </div>
        </div>
        <div className="dash-index-item">
          <div className="dash-index-link">
            <span className="dash-index-label">Secret</span>
            <span className="dash-index-meta">
              <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <code
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    if (stream.webhookSecret) {
                      navigator.clipboard.writeText(stream.webhookSecret);
                      setSecretCopied(true);
                      setTimeout(() => setSecretCopied(false), 1500);
                    }
                  }}
                >
                  {secretRevealed
                    ? stream.webhookSecret ?? "—"
                    : `${(stream.webhookSecret ?? "whsec_").slice(0, 6)}••••••••••••`}
                </code>
                {secretCopied && (
                  <span className="dash-copy-tooltip">Copied</span>
                )}
              </span>
              <a
                style={{ cursor: "pointer", color: "var(--accent-purple)", fontSize: 12, marginLeft: 4 }}
                onClick={() => setSecretRevealed((v) => !v)}
              >
                {secretRevealed ? "hide" : "reveal"}
              </a>
            </span>
          </div>
        </div>
        <div className="dash-index-item">
          <div className="dash-index-link">
            <span className="dash-index-label">Signature header</span>
            <span className="dash-index-meta">
              <code>X-Secondlayer-Signature</code>
            </span>
          </div>
        </div>
      </div>

      {/* Recent deliveries */}
      <div id="deliveries" className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Recent deliveries</h2>
      </div>
      {deliveries.length === 0 ? (
        <div className="dash-empty">No deliveries yet</div>
      ) : (
        <div className="dash-activity-list">
          {deliveries.map((d) => (
            <div key={d.id} className="dash-activity-item">
              <span
                className={`dash-activity-dot ${d.statusCode >= 200 && d.statusCode < 300 ? "green" : "red"}`}
              />
              <span className="dash-activity-name">
                Block #{d.blockHeight.toLocaleString()}
              </span>
              <span className="dash-activity-time">
                {relativeTime(d.createdAt)}
              </span>
            </div>
          ))}
          {stream.totalDeliveries > 5 && (
            <Link
              href={`/streams/${stream.id}/deliveries`}
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                padding: "10px 0",
                display: "block",
              }}
            >
              View all {formatNum(stream.totalDeliveries)} deliveries →
            </Link>
          )}
        </div>
      )}

      {/* Danger zone */}
      <div className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Danger zone</h2>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {stream.status !== "failed" && (
          <button
            className="dash-btn danger"
            disabled={disabling}
            onClick={handleToggleEnabled}
          >
            {disabling
              ? (stream.status === "inactive" ? "Enabling..." : "Disabling...")
              : (stream.status === "inactive" ? "Enable stream" : "Disable stream")}
          </button>
        )}
        {deleting === "confirm" ? (
          <div className="dash-callout-warn">
            Are you sure? This will permanently delete this stream and all its delivery history.
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button className="dash-btn danger" onClick={handleDelete}>
                Delete permanently
              </button>
              <button className="dash-btn" onClick={() => setDeleting("idle")}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="dash-btn danger"
            disabled={deleting === "deleting"}
            onClick={() => setDeleting("confirm")}
          >
            {deleting === "deleting" ? "Deleting..." : "Delete stream"}
          </button>
        )}
      </div>
    </>
  );
}
