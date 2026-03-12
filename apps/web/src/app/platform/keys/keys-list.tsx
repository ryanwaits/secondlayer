"use client";

import { useCallback, useRef, useState } from "react";
import type { ApiKey } from "@/lib/types";
import { useApiKeys, useCreateApiKey } from "@/lib/queries/api-keys";

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

export function KeysList({ initialKeys }: { initialKeys: ApiKey[] }) {
  const { data: keys = initialKeys } = useApiKeys(initialKeys);
  const createKey = useCreateApiKey();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
            <div key={key.id} className="dash-index-item">
              <div className="dash-index-link">
                <span className="dash-index-label">
                  <span className="key-prefix">{key.prefix}</span>
                  {key.name && (
                    <span className="dash-index-desc">{key.name}</span>
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
          ))}
        </div>
      )}
    </>
  );
}
