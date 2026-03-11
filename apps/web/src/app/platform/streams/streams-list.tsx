"use client";

import Link from "next/link";
import type { Stream } from "@/lib/types";

export function StreamsList({ initialStreams }: { initialStreams: Stream[] }) {
  const streams = initialStreams;

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
      <div className="dash-page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="dash-page-title">Streams</h1>
          <p className="dash-page-desc">
            {streams.length === 0
              ? "No streams yet."
              : `${streams.length} stream${streams.length !== 1 ? "s" : ""} — ${parts.join(", ")}`}
          </p>
        </div>
        <Link href="/streams/create" className="create-btn">
          + Create stream
        </Link>
      </div>

      {streams.length === 0 ? (
        <div className="dash-empty">
          <p>Create your first stream to start receiving blockchain events.</p>
          <div className="dash-empty-action">
            <Link href="/streams/create">Create a stream</Link>
          </div>
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.label}>
            <div className="dash-section-wrap">
              <hr />
              <h2 className="dash-section-title">{group.label}</h2>
            </div>
            <div className="dash-index-group">
              {group.items.map((stream) => (
                <div className="dash-index-item" key={stream.id}>
                  <Link href={`/streams/${stream.id}`} className="dash-index-link">
                    <span className="dash-index-label">
                      {stream.name}
                    </span>
                    <span className="dash-index-meta">
                      <span className={`dash-badge ${stream.status}`}>
                        {stream.status}
                      </span>
                      {stream.status === "failed"
                        ? `${stream.failedDeliveries.toLocaleString()} drops`
                        : `${stream.totalDeliveries.toLocaleString()} deliveries`}
                    </span>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}
