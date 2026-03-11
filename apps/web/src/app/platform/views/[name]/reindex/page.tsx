"use client";

import { useParams } from "next/navigation";
import { useState } from "react";

export default function ViewReindexPage() {
  const { name } = useParams<{ name: string }>();
  const [fromBlock, setFromBlock] = useState("");
  const [toBlock, setToBlock] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleReindex() {
    setLoading(true);
    setMessage(null);

    const body: Record<string, number> = {};
    if (fromBlock) body.fromBlock = Number(fromBlock);
    if (toBlock) body.toBlock = Number(toBlock);

    try {
      const res = await fetch(`/api/views/${name}/reindex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Reindex failed" });
      } else {
        setMessage({ type: "success", text: data.message || "Reindex started" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="dash-callout-warn">
        Reindexing is destructive. All existing data for this view will be
        dropped and reprocessed from the specified block range.
      </div>

      <div className="dash-form-row">
        <label>From block</label>
        <input
          className="dash-input"
          type="number"
          placeholder="Optional"
          value={fromBlock}
          onChange={(e) => setFromBlock(e.target.value)}
        />
      </div>

      <div className="dash-form-row">
        <label>To block</label>
        <input
          className="dash-input"
          type="number"
          placeholder="Optional"
          value={toBlock}
          onChange={(e) => setToBlock(e.target.value)}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <button
          className="dash-btn danger"
          onClick={handleReindex}
          disabled={loading}
        >
          {loading ? "Reindexing..." : "Reindex"}
        </button>
      </div>

      {message && (
        <div className={`dash-inline-msg ${message.type}`}>
          {message.text}
        </div>
      )}
    </>
  );
}
