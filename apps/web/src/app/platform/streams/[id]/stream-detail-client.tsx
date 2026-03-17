"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Stream, Delivery } from "@/lib/types";
import { useBreadcrumbOverrides } from "@/lib/breadcrumb";
import {
  useStream,
  useDeliveries,
  useDisableStream,
  useDeleteStream,
} from "@/lib/queries/streams";
import { detectFailurePattern, detectDeliveryGap } from "@/lib/intelligence/streams";
import { Insight, Banner } from "@/components/console/intelligence";
import { InsightsSection } from "@/components/console/intelligence/insights-section";

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
  sessionToken,
}: {
  stream: Stream;
  sessionToken?: string;
}) {
  const router = useRouter();
  const { set: setBreadcrumb } = useBreadcrumbOverrides();
  const { data: stream = initialStream } = useStream(initialStream.id, initialStream);
  const { data: deliveries = [] } = useDeliveries(initialStream.id);

  useEffect(() => {
    setBreadcrumb(`/streams/${stream.id}`, stream.name);
  }, [stream.id, stream.name, setBreadcrumb]);

  const [secretRevealed, setSecretRevealed] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const [deleting, setDeleting] = useState<"idle" | "confirm" | "deleting">("idle");

  const disableMutation = useDisableStream();
  const deleteMutation = useDeleteStream();

  const handleDelete = useCallback(async () => {
    setDeleting("deleting");
    deleteMutation.mutate(stream.id, {
      onSuccess: () => router.push("/streams"),
      onError: () => setDeleting("idle"),
    });
  }, [stream.id, router, deleteMutation]);

  const handleToggleEnabled = useCallback(() => {
    const action = stream.status === "inactive" ? "enable" : "disable";
    disableMutation.mutate({ id: stream.id, action });
  }, [stream.id, stream.status, disableMutation]);

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
      {/* Status notices */}
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

      {/* Intelligence */}
      <StreamIntelligence stream={stream} deliveries={deliveries} />

      {/* AI Insights */}
      <InsightsSection category="stream" resourceId={stream.id} sessionToken={sessionToken ?? ""} />

      {/* Filters */}
      <div id="filters" className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Filters</h2>
      </div>
      <pre className="dash-code-block">
        {highlightJson(stream.filters)}
      </pre>

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

      {/* Danger zone */}
      <div className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Danger zone</h2>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {stream.status !== "failed" && (
          <button
            className="dash-btn danger"
            disabled={disableMutation.isPending}
            onClick={handleToggleEnabled}
          >
            {disableMutation.isPending
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

function StreamIntelligence({
  stream,
  deliveries,
}: {
  stream: Stream;
  deliveries: Delivery[];
}) {
  const gap = detectDeliveryGap(stream, deliveries);
  const failure = detectFailurePattern(deliveries);

  if (!gap && !failure) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
      {gap && (
        <Banner variant="info">
          This stream has a gap of <strong>{gap.missedBlocks.toLocaleString()} blocks</strong> (#{gap.gapStart.toLocaleString()} – #{gap.gapEnd.toLocaleString()}).
        </Banner>
      )}
      {failure && (
        <Insight variant="danger" id={`failure-${stream.id}`}>
          Last <strong>{failure.count}</strong> deliveries all returned{" "}
          <code>{failure.statusCode}</code> over the past{" "}
          <strong>{failure.sinceDuration}</strong>. Your webhook endpoint may be
          down or rejecting requests.
        </Insight>
      )}
    </div>
  );
}
