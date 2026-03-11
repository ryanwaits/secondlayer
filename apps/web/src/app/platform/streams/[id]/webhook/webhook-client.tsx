"use client";

import { useState, useEffect } from "react";
import type { Stream } from "@/lib/types";
import { useBreadcrumbOverrides } from "@/lib/breadcrumb";

const EXAMPLE_PAYLOAD = {
  streamId: "a1b2c3d4-...",
  streamName: "nft-transfers",
  block: {
    height: 187442,
    hash: "0x8f3a...",
    timestamp: 1741564800,
  },
  matches: {
    transactions: [{ "...": "" }],
    events: [{ "...": "" }],
  },
  deliveredAt: "2026-03-10T12:00:00Z",
};

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

function OptionRow({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  const display =
    value === true ? "true" : value === false ? "false" : String(value ?? "—");
  const isFalsy = value === false || value == null;

  return (
    <div className="dash-index-item">
      <div className="dash-index-link">
        <span className="dash-index-label">{label}</span>
        <span
          className="dash-index-meta"
          style={isFalsy ? { opacity: 0.4 } : undefined}
        >
          <code>{display}</code>
        </span>
      </div>
    </div>
  );
}

export function WebhookClient({ stream }: { stream: Stream }) {
  const { set: setBreadcrumb } = useBreadcrumbOverrides();
  useEffect(() => {
    setBreadcrumb(`/streams/${stream.id}`, stream.name);
  }, [stream.id, stream.name, setBreadcrumb]);

  const [secretRevealed, setSecretRevealed] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);

  return (
    <>
      <div className="dash-page-header">
        <h1 className="dash-page-title">Webhook</h1>
      </div>

      <div className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Endpoint</h2>
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
                    : `${(stream.webhookSecret ?? "whsec_").slice(0, 6)}${"•".repeat(12)}`}
                </code>
                {secretCopied && (
                  <span className="dash-copy-tooltip">Copied</span>
                )}
              </span>
              <a
                style={{
                  cursor: "pointer",
                  color: "var(--accent-purple)",
                  fontSize: 12,
                  marginLeft: 4,
                }}
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
              <code>x-secondlayer-signature</code>
            </span>
          </div>
        </div>
      </div>

      <div className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Options</h2>
      </div>
      <div className="dash-index-group">
        <OptionRow
          label="decodeClarityValues"
          value={stream.options.decodeClarityValues}
        />
        <OptionRow
          label="includeRawTx"
          value={stream.options.includeRawTx}
        />
        <OptionRow label="timeoutMs" value={stream.options.timeoutMs} />
        <OptionRow
          label="maxRetries"
          value={stream.options.maxRetries}
        />
      </div>

      <div className="dash-section-wrap">
        <hr />
        <h2 className="dash-section-title">Example payload</h2>
      </div>
      <pre className="dash-code-block">{highlightJson(EXAMPLE_PAYLOAD)}</pre>

    </>
  );
}
