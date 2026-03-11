"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Per-filter field definitions
const FILTER_FIELDS: Record<
  string,
  { label: string; key: string; placeholder: string; hint?: string }[]
> = {
  stx_transfer: [
    { label: "Sender", key: "sender", placeholder: "SP2D5B..." },
    { label: "Recipient", key: "recipient", placeholder: "SP3K8..." },
    { label: "Min amount (µSTX)", key: "minAmount", placeholder: "0" },
    { label: "Max amount (µSTX)", key: "maxAmount", placeholder: "no limit" },
  ],
  stx_mint: [
    { label: "Recipient", key: "recipient", placeholder: "SP3K8..." },
    { label: "Min amount (µSTX)", key: "minAmount", placeholder: "0" },
  ],
  stx_burn: [
    { label: "Sender", key: "sender", placeholder: "SP2D5B..." },
    { label: "Min amount (µSTX)", key: "minAmount", placeholder: "0" },
  ],
  stx_lock: [
    { label: "Locked address", key: "lockedAddress", placeholder: "SP2D5B..." },
    { label: "Min amount (µSTX)", key: "minAmount", placeholder: "0" },
  ],
  ft_transfer: [
    { label: "Sender", key: "sender", placeholder: "SP2D5B..." },
    { label: "Recipient", key: "recipient", placeholder: "SP3K8..." },
    { label: "Asset identifier", key: "assetIdentifier", placeholder: "SP3K8...token-wstx" },
    { label: "Min amount", key: "minAmount", placeholder: "0" },
  ],
  ft_mint: [
    { label: "Recipient", key: "recipient", placeholder: "SP3K8..." },
    { label: "Asset identifier", key: "assetIdentifier", placeholder: "SP3K8...token-wstx" },
    { label: "Min amount", key: "minAmount", placeholder: "0" },
  ],
  ft_burn: [
    { label: "Sender", key: "sender", placeholder: "SP2D5B..." },
    { label: "Asset identifier", key: "assetIdentifier", placeholder: "SP3K8...token-wstx" },
    { label: "Min amount", key: "minAmount", placeholder: "0" },
  ],
  nft_transfer: [
    { label: "Sender", key: "sender", placeholder: "SP2D5B..." },
    { label: "Recipient", key: "recipient", placeholder: "SP3K8..." },
    { label: "Asset identifier", key: "assetIdentifier", placeholder: "SP3K8...nft-collection" },
    { label: "Token ID", key: "tokenId", placeholder: "e.g. 42" },
  ],
  nft_mint: [
    { label: "Recipient", key: "recipient", placeholder: "SP3K8..." },
    { label: "Asset identifier", key: "assetIdentifier", placeholder: "SP3K8...nft-collection" },
    { label: "Token ID", key: "tokenId", placeholder: "e.g. 42" },
  ],
  nft_burn: [
    { label: "Sender", key: "sender", placeholder: "SP2D5B..." },
    { label: "Asset identifier", key: "assetIdentifier", placeholder: "SP3K8...nft-collection" },
    { label: "Token ID", key: "tokenId", placeholder: "e.g. 42" },
  ],
  contract_call: [
    { label: "Contract ID", key: "contractId", placeholder: "SP2D5B...dungeon-master" },
    {
      label: "Function name",
      key: "functionName",
      placeholder: "transfer*",
      hint: "Supports * wildcards — e.g. transfer*, *-item",
    },
    { label: "Caller (tx sender)", key: "caller", placeholder: "SP3K8..." },
  ],
  contract_deploy: [
    { label: "Deployer", key: "deployer", placeholder: "SP2D5B..." },
    {
      label: "Contract name",
      key: "contractName",
      placeholder: "my-contract*",
      hint: "Supports * wildcards",
    },
  ],
  print_event: [
    { label: "Contract ID", key: "contractId", placeholder: "SP2D5B...contract" },
    { label: "Topic", key: "topic", placeholder: "exact topic name" },
    { label: "Contains (substring)", key: "contains", placeholder: "search in event data" },
  ],
};

function hasConditions(conditions: Record<string, string>): boolean {
  return Object.values(conditions).some((v) => v.trim() !== "");
}

function conditionsSummary(
  filterType: string,
  conditions: Record<string, string>,
): string {
  const parts = Object.entries(conditions)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => {
      if (k === "minAmount") return `min: ${v}`;
      if (k === "maxAmount") return `max: ${v}`;
      // Truncate long values
      const display = v.length > 20 ? v.slice(0, 18) + "..." : v;
      return display;
    });
  return parts.length > 0 ? parts.join(" · ") : "no conditions";
}

// Focus first empty input in a container, or first input if all filled
function focusFirstEmptyInput(container: HTMLElement) {
  const inputs = container.querySelectorAll<HTMLInputElement>(".wizard-field-input");
  for (const input of inputs) {
    if (!input.value.trim()) {
      input.focus();
      return;
    }
  }
  inputs[0]?.focus();
}

// ── Single filter view (States 31 / 31b) ──
function SingleFilterConfig({
  filterType,
  conditions,
  onChange,
  streamName,
  webhookUrl,
  onStreamNameChange,
  onWebhookUrlChange,
}: {
  filterType: string;
  conditions: Record<string, string>;
  onChange: (key: string, value: string) => void;
  streamName: string;
  webhookUrl: string;
  onStreamNameChange: (v: string) => void;
  onWebhookUrlChange: (v: string) => void;
}) {
  const fields = FILTER_FIELDS[filterType] ?? [];
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-focus first input on mount
  useEffect(() => {
    if (containerRef.current) {
      requestAnimationFrame(() => focusFirstEmptyInput(containerRef.current!));
    }
  }, []);

  return (
    <div ref={containerRef} className="wizard-step2-body">
      <div className="wizard-filter-context">
        <span className="wizard-filter-context-label">Filter</span>
        <span className="filter-pill active" style={{ pointerEvents: "none" }}>
          {filterType}
        </span>
      </div>

      {fields.length > 0 && (
        <div className="wizard-conditions-card">
          <div className="wizard-conditions-header">
            Filter conditions{" "}
            <span style={{ textTransform: "none", fontWeight: 400 }}>
              (all optional)
            </span>
          </div>
          <div className="wizard-conditions-grid">
            {fields.map((f) => (
              <div key={f.key} className="wizard-field">
                <label className="wizard-field-label">
                  {f.label}
                  {f.hint && (
                    <span className="wizard-field-hint"> — {f.hint}</span>
                  )}
                </label>
                <input
                  className="wizard-field-input"
                  type="text"
                  placeholder={f.placeholder}
                  value={conditions[f.key] ?? ""}
                  onChange={(e) => onChange(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="wizard-field" style={{ marginTop: 14 }}>
        <label className="wizard-field-label">Stream name</label>
        <input
          className="wizard-field-input"
          type="text"
          placeholder="e.g. stx-whales"
          value={streamName}
          onChange={(e) => onStreamNameChange(e.target.value)}
        />
      </div>

      <div className="wizard-field" style={{ marginTop: 14 }}>
        <label className="wizard-field-label">Webhook URL</label>
        <input
          className="wizard-field-input"
          type="text"
          placeholder="https://your-server.com/webhook"
          value={webhookUrl}
          onChange={(e) => onWebhookUrlChange(e.target.value)}
        />
      </div>
    </div>
  );
}

// ── Multi-filter accordion view (State 31c) ──
function MultiFilterConfig({
  filters,
  allConditions,
  onConditionChange,
  streamName,
  webhookUrl,
  onStreamNameChange,
  onWebhookUrlChange,
}: {
  filters: string[];
  allConditions: Record<string, Record<string, string>>;
  onConditionChange: (filterType: string, key: string, value: string) => void;
  streamName: string;
  webhookUrl: string;
  onStreamNameChange: (v: string) => void;
  onWebhookUrlChange: (v: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [expandedFilter, setExpandedFilter] = useState<string | null>(
    filters[0] ?? null,
  );
  const [focusedIdx, setFocusedIdx] = useState(0);
  const focusedIdxRef = useRef(0);

  // Keep ref in sync for use in native event listener
  useEffect(() => {
    focusedIdxRef.current = focusedIdx;
  }, [focusedIdx]);

  // Auto-focus first empty input when expanded filter changes (including mount)
  useEffect(() => {
    if (!expandedFilter || !containerRef.current) return;
    requestAnimationFrame(() => {
      const body = containerRef.current?.querySelector(".wizard-accordion-body");
      if (body) focusFirstEmptyInput(body as HTMLElement);
    });
  }, [expandedFilter]);

  // Use native capture-phase listener for Cmd+Arrow so it fires reliably
  // even when focus is inside an input field
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (!e.metaKey) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(focusedIdxRef.current + 1, filters.length - 1);
        focusedIdxRef.current = next;
        setFocusedIdx(next);
        setExpandedFilter(filters[next]);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = Math.max(focusedIdxRef.current - 1, 0);
        focusedIdxRef.current = next;
        setFocusedIdx(next);
        setExpandedFilter(filters[next]);
      }
    }

    el.addEventListener("keydown", handleKeyDown, true); // capture phase
    return () => el.removeEventListener("keydown", handleKeyDown, true);
  }, [filters]);

  return (
    <div ref={containerRef} style={{ outline: "none" }}>
      {/* Accordion per filter */}
      {filters.map((ft, idx) => {
        const fields = FILTER_FIELDS[ft] ?? [];
        const conditions = allConditions[ft] ?? {};
        const isExpanded = expandedFilter === ft;
        const hasCond = hasConditions(conditions);

        return (
          <div key={ft} className="wizard-accordion-item">
            <div
              className={`wizard-accordion-header ${isExpanded ? "expanded" : ""} ${idx === focusedIdx ? "focused" : ""}`}
              onClick={() => {
                setFocusedIdx(idx);
                setExpandedFilter(isExpanded ? null : ft);
              }}
            >
              <span
                className={`wizard-accordion-check ${hasCond ? "checked" : ""}`}
              >
                {hasCond && (
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M4 8l3 3 5-5" />
                  </svg>
                )}
              </span>
              <span className="wizard-accordion-name">{ft}</span>
              <span style={{ flex: 1 }} />
              <span className="wizard-accordion-summary">
                {conditionsSummary(ft, conditions)}
              </span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                style={{
                  color: "var(--text-muted)",
                  transform: isExpanded ? "rotate(180deg)" : "none",
                  transition: "transform 0.15s ease",
                }}
              >
                <path d="M4 6l4 4 4-4" />
              </svg>
            </div>
            {isExpanded && fields.length > 0 && (
              <div className="wizard-accordion-body">
                <div className="wizard-conditions-grid">
                  {fields.map((f) => (
                    <div key={f.key} className="wizard-field">
                      <label className="wizard-field-label">
                        {f.label}
                        {f.hint && (
                          <span className="wizard-field-hint">
                            {" "}
                            — {f.hint}
                          </span>
                        )}
                      </label>
                      <input
                        className="wizard-field-input"
                        type="text"
                        placeholder={f.placeholder}
                        value={conditions[f.key] ?? ""}
                        onChange={(e) =>
                          onConditionChange(ft, f.key, e.target.value)
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Stream name + webhook below accordion */}
      <div style={{ padding: "14px 18px" }}>
        <div className="wizard-field">
          <label className="wizard-field-label">Stream name</label>
          <input
            className="wizard-field-input"
            type="text"
            placeholder="e.g. multi-watcher"
            value={streamName}
            onChange={(e) => onStreamNameChange(e.target.value)}
          />
        </div>
        <div className="wizard-field" style={{ marginTop: 14 }}>
          <label className="wizard-field-label">Webhook URL</label>
          <input
            className="wizard-field-input"
            type="text"
            placeholder="https://your-server.com/webhook"
            value={webhookUrl}
            onChange={(e) => onWebhookUrlChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

// ── Exported wrapper ──
export function StreamWizardStep2({
  filters,
  data,
  onDataChange,
}: {
  filters: string[];
  data: Record<string, unknown>;
  onDataChange: (updates: Record<string, unknown>) => void;
}) {
  const streamName = (data.streamName as string) ?? "";
  const webhookUrl = (data.webhookUrl as string) ?? "";
  const allConditions =
    (data.filterConditions as Record<string, Record<string, string>>) ?? {};

  const setStreamName = (v: string) => onDataChange({ streamName: v });
  const setWebhookUrl = (v: string) => onDataChange({ webhookUrl: v });

  if (filters.length === 1) {
    const ft = filters[0];
    const conditions = allConditions[ft] ?? {};
    return (
      <SingleFilterConfig
        filterType={ft}
        conditions={conditions}
        onChange={(key, value) =>
          onDataChange({
            filterConditions: {
              ...allConditions,
              [ft]: { ...conditions, [key]: value },
            },
          })
        }
        streamName={streamName}
        webhookUrl={webhookUrl}
        onStreamNameChange={setStreamName}
        onWebhookUrlChange={setWebhookUrl}
      />
    );
  }

  return (
    <MultiFilterConfig
      filters={filters}
      allConditions={allConditions}
      onConditionChange={(ft, key, value) => {
        const current = allConditions[ft] ?? {};
        onDataChange({
          filterConditions: {
            ...allConditions,
            [ft]: { ...current, [key]: value },
          },
        });
      }}
      streamName={streamName}
      webhookUrl={webhookUrl}
      onStreamNameChange={setStreamName}
      onWebhookUrlChange={setWebhookUrl}
    />
  );
}
