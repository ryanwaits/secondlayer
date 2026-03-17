"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiKey, AccountInsight } from "@/lib/types";
import { useApiKeys, useCreateApiKey } from "@/lib/queries/api-keys";
import { detectStaleKeys } from "@/lib/intelligence/keys";
import { Insight } from "@/components/console/intelligence";
import { InsightCard } from "@/components/console/intelligence/insight-card";
import { CopyButton } from "@/components/copy-button";
import { highlight } from "@/lib/highlight";

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function sdkSnippet(prefix: string) {
  return `import { SecondLayer } from "@secondlayer/sdk";

const client = new SecondLayer({
  apiKey: "${prefix}",
});

// List streams
const streams = await client.streams.list();

// Query a view table
const rows = await client.views.query("my-view", "transfers", {
  limit: 10,
});`;
}

function KeyDetail({ apiKey }: { apiKey: ApiKey }) {
  const [html, setHtml] = useState<string | null>(null);
  const code = sdkSnippet(apiKey.prefix);

  useEffect(() => {
    let cancelled = false;
    highlight(code, "typescript").then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => { cancelled = true; };
  }, [code]);

  return (
    <div className="key-detail">
      <div className="key-detail-section-label">SDK</div>
      <div className="code-block-wrapper key-detail-code">
        <CopyButton code={code} />
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre><code>{code}</code></pre>
        )}
      </div>
      <div className="key-detail-hint">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#22c55e" strokeWidth="1.5">
          <circle cx="8" cy="8" r="7" />
          <path d="M8 5v3" />
          <circle cx="8" cy="11" r="0.5" fill="#22c55e" />
        </svg>
        Full API key included when copied
      </div>

      <div className="key-detail-meta">
        <div className="key-detail-meta-item">
          <span className="key-detail-meta-label">Status</span>
          <span className="key-detail-meta-value">
            {apiKey.status === "active" ? (
              <span className="dash-badge active">active</span>
            ) : (
              <span className="dash-badge inactive">revoked</span>
            )}
          </span>
        </div>
        <div className="key-detail-meta-item">
          <span className="key-detail-meta-label">Created</span>
          <span className="key-detail-meta-value">
            {new Date(apiKey.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
        <div className="key-detail-meta-item">
          <span className="key-detail-meta-label">Last used</span>
          <span className="key-detail-meta-value">
            {timeAgo(apiKey.lastUsedAt)}
          </span>
        </div>
      </div>

      {apiKey.status === "active" && (
        <button className="dash-btn danger">Revoke key</button>
      )}
    </div>
  );
}

export function KeysList({
  initialKeys,
  insights = [],
  sessionToken = "",
}: {
  initialKeys: ApiKey[];
  insights?: AccountInsight[];
  sessionToken?: string;
}) {
  const { data: keys = initialKeys } = useApiKeys(initialKeys);
  const createKey = useCreateApiKey();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const status = createKey.isPending ? "creating" : createKey.isError ? "error" : createKey.isSuccess && newRawKey ? "done" : "idle";

  const handleCreate = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      createKey.mutate(name || undefined, {
        onSuccess: (data) => {
          setNewRawKey(data.key);
        },
      });
    },
    [name, createKey],
  );

  const handleCopy = useCallback(async () => {
    if (!newRawKey) return;
    await navigator.clipboard.writeText(newRawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [newRawKey]);

  const dismissSuccess = useCallback(() => {
    setNewRawKey(null);
    setShowForm(false);
    setName("");
    createKey.reset();
  }, [createKey]);

  return (
    <>
      <div className="dash-page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="dash-page-title">API Keys</h1>
          {keys.length > 0 && (
            <p className="dash-page-desc">
              {keys.length} key{keys.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        {!showForm && status !== "done" && (
          <button
            className="create-btn"
            onClick={() => {
              setShowForm(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            + Create key
          </button>
        )}
      </div>

      {/* Inline create form */}
      {showForm && status !== "done" && (
        <div className="create-card">
          <form
            onSubmit={handleCreate}
            style={{ display: "flex", alignItems: "flex-end", gap: 10 }}
          >
            <div style={{ flex: 1 }}>
              <label className="create-label">Key name</label>
              <input
                ref={inputRef}
                className="create-input"
                type="text"
                placeholder="e.g. prod-key"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="create-submit"
              disabled={status === "creating"}
            >
              {status === "creating" ? "..." : "Create"}
            </button>
            <button
              type="button"
              className="create-cancel"
              onClick={() => {
                setShowForm(false);
                setName("");
              }}
            >
              Cancel
            </button>
          </form>
          {status === "error" && (
            <p style={{ fontSize: 12, color: "#ef4444", marginTop: 8 }}>
              Failed to create key. Try again.
            </p>
          )}
        </div>
      )}

      {/* Success banner with raw key */}
      {status === "done" && newRawKey && (
        <div className="create-success">
          <div className="create-success-header">
            <div className="create-success-icon">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 8l3 3 5-5" />
              </svg>
            </div>
            <span className="create-success-title">
              {name || "Key"} created
            </span>
            <span style={{ flex: 1 }} />
            <button className="create-cancel" onClick={dismissSuccess}>
              Dismiss
            </button>
          </div>
          <div className="key-row">
            <span className="key-value">{newRawKey}</span>
            <button className="key-copy" onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="create-success-warning">
            Copy this key now — it won&apos;t be shown again.
          </div>
        </div>
      )}

      {/* Keys list */}
      {keys.length === 0 && !showForm ? (
        <div className="dash-empty">
          <p>No API keys yet.</p>
          <div className="dash-empty-action">
            <a onClick={() => setShowForm(true)}>Create your first key</a>
          </div>
        </div>
      ) : (
        <div className="dash-index-group">
          {keys.map((key) => (
            <div key={key.id}>
              <div
                className={`dash-index-item${selectedKeyId === key.id ? " selected" : ""}`}
                onClick={() => setSelectedKeyId(selectedKeyId === key.id ? null : key.id)}
              >
                <div className="dash-index-link">
                  <span className="dash-index-label">
                    <span className="key-prefix">{key.prefix}</span>
                    {key.name && (
                      <span className="key-name">{key.name}</span>
                    )}
                  </span>
                  <span className="dash-index-meta">
                    {key.status === "active" ? (
                      <span className="dash-badge active">active</span>
                    ) : (
                      <s style={{ opacity: 0.5 }}>revoked</s>
                    )}
                    {key.status === "active" && (
                      <>last used {timeAgo(key.lastUsedAt)}</>
                    )}
                  </span>
                </div>
              </div>
              {selectedKeyId === key.id && <KeyDetail apiKey={key} />}
            </div>
          ))}
        </div>
      )}

      <StaleKeyInsight keys={keys} />

      {insights.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {insights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} sessionToken={sessionToken} />
          ))}
        </div>
      )}
    </>
  );
}

function StaleKeyInsight({ keys }: { keys: ApiKey[] }) {
  const stale = detectStaleKeys(keys);
  if (stale.length === 0) return null;

  const names = stale.map((k) => k.name || k.prefix);

  return (
    <div style={{ marginTop: 12 }}>
      <Insight variant="warning" id="stale-keys">
        <strong>{names.join(", ")}</strong>{" "}
        {stale.length === 1 ? "hasn't" : "haven't"} been used in over 30 days.
        Unused keys are a security risk — consider revoking them.
      </Insight>
    </div>
  );
}
