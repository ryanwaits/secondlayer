"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { actions } from "@/lib/actions/registry";
import { fuzzyMatch, highlightLabel, type MatchResult } from "@/lib/actions/fuzzy-match";
import { useCommandAI } from "@/lib/command/use-command-ai";
import { queryKeys } from "@/lib/queries/keys";
import { InfoPanel } from "./renders/info-panel";
import { ConfirmCard } from "./renders/confirm-card";
import { PaletteCodeBlock } from "./renders/code-block";

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const qc = useQueryClient();
  const results = fuzzyMatch(query, actions);
  const hasFuzzyResults = query.length === 0 || results.length > 0;

  const { mode, response, error, reset, submit, execute } = useCommandAI(
    open ? query : "",
    hasFuzzyResults,
    pathname,
  );

  const openPalette = useCallback(() => {
    setQuery("");
    setSelectedIdx(0);
    setLogoutConfirm(false);
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedIdx(0);
    setLogoutConfirm(false);
    reset();
  }, [reset]);

  const executeAction = useCallback(
    (result: MatchResult) => {
      const { action } = result;
      if (action.id === "logout") {
        setLogoutConfirm(true);
        return;
      }
      closePalette();
      if (action.href) {
        router.push(action.href);
      }
    },
    [closePalette, router],
  );

  const confirmLogout = useCallback(() => {
    closePalette();
    logout();
    router.push("/");
  }, [closePalette, logout, router]);

  // Auto-execute when AI maps to a known action
  useEffect(() => {
    if (mode !== "action" || !response || response.type !== "action") return;
    const match = results.find((r) => r.action.id === response.actionId)
      || { action: actions.find((a) => a.id === response.actionId)!, ranges: [] };
    if (match?.action) {
      executeAction(match as MatchResult);
    }
  }, [mode, response]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-close on success
  useEffect(() => {
    if (mode !== "success") return;
    const timer = setTimeout(() => closePalette(), 1500);
    return () => clearTimeout(timer);
  }, [mode, closePalette]);

  // Auto-clear error
  useEffect(() => {
    if (mode !== "error") return;
    const timer = setTimeout(() => reset(), 3000);
    return () => clearTimeout(timer);
  }, [mode, reset]);

  // Global keyboard shortcuts — only ⌘K
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && e.metaKey) {
        e.preventDefault();
        if (open) closePalette();
        else openPalette();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, openPalette, closePalette]);

  // Focus input when palette opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (logoutConfirm) {
        if (e.key === "Enter") {
          e.preventDefault();
          confirmLogout();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setLogoutConfirm(false);
          setTimeout(() => inputRef.current?.focus(), 0);
        }
        return;
      }

      if (e.key === "Escape") {
        if (mode !== "actions" && mode !== "agent") {
          reset();
          setQuery("");
        } else if (mode === "agent") {
          reset();
          setQuery("");
        } else {
          closePalette();
        }
      } else if (mode === "agent") {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      } else if (mode === "actions") {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIdx((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (results[selectedIdx]) {
            executeAction(results[selectedIdx]);
          }
        }
      }
    },
    [closePalette, results, selectedIdx, executeAction, mode, reset, submit, logoutConfirm, confirmLogout],
  );

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  // Prefetch data for highlighted action — queryFn must match the hook's unwrap
  const prefetchTargets: Record<string, { queryKey: readonly string[]; apiPath: string; unwrap?: (data: unknown) => unknown }[]> = {
    "/": [
      { queryKey: queryKeys.streams.all, apiPath: "/api/streams?limit=100&offset=0", unwrap: (d: any) => d.streams },
      { queryKey: queryKeys.views.all, apiPath: "/api/views", unwrap: (d: any) => d.data },
    ],
    "/streams": [
      { queryKey: queryKeys.streams.all, apiPath: "/api/streams?limit=100&offset=0", unwrap: (d: any) => d.streams },
    ],
    "/views": [
      { queryKey: queryKeys.views.all, apiPath: "/api/views", unwrap: (d: any) => d.data },
    ],
    "/keys": [
      { queryKey: queryKeys.keys.all, apiPath: "/api/keys", unwrap: (d: any) => d.keys },
    ],
    "/usage": [
      { queryKey: ["account", "usage"], apiPath: "/api/accounts/usage" },
    ],
    "/billing": [
      { queryKey: ["account", "usage"], apiPath: "/api/accounts/usage" },
    ],
    "/settings": [
      { queryKey: ["account", "me"], apiPath: "/api/accounts/me" },
    ],
  };

  useEffect(() => {
    if (mode !== "actions") return;
    const selected = results[selectedIdx];
    if (!selected?.action.href) return;
    const targets = prefetchTargets[selected.action.href];
    if (!targets) return;
    for (const { queryKey, apiPath, unwrap } of targets) {
      qc.prefetchQuery({
        queryKey,
        queryFn: () =>
          fetch(apiPath, { credentials: "same-origin" })
            .then((r) => r.json())
            .then((d) => (unwrap ? unwrap(d) : d)),
        staleTime: 30_000,
      });
    }
  }, [selectedIdx, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wire ⌘K bar in topbar
  useEffect(() => {
    function onClick(e: Event) {
      if ((e.target as HTMLElement).closest(".dash-cmdk")) {
        openPalette();
      }
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [openPalette]);

  if (!open) return null;

  // Logout confirmation overlay
  if (logoutConfirm) {
    return (
      <div className="palette-overlay" onClick={closePalette}>
        <div
          className="palette"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
        >
          <div className="palette-body" style={{ padding: "24px 20px" }}>
            <p style={{ fontSize: 14, color: "var(--text-primary)", margin: "0 0 16px", textAlign: "center" }}>
              Are you sure you want to log out?
            </p>
            <div className="palette-confirm-actions" style={{ justifyContent: "center" }}>
              <button
                className="palette-btn"
                onClick={() => { setLogoutConfirm(false); setTimeout(() => inputRef.current?.focus(), 0); }}
                autoFocus
              >
                Cancel
              </button>
              <button
                className="palette-btn palette-btn-danger"
                onClick={confirmLogout}
              >
                Log Out
              </button>
            </div>
          </div>
          <div className="palette-footer">
            <div className="palette-footer-left">
              <span className="palette-footer-hint">
                <kbd>&#9166;</kbd> confirm
              </span>
              <span className="palette-footer-hint">
                <kbd>esc</kbd> cancel
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Determine which body to render
  const renderBody = () => {
    switch (mode) {
      case "agent":
        return (
          <div className="palette-agent-ready">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.5 }}>
              <circle cx="8" cy="8" r="6" />
              <path d="M6 6.5c0-1.1.9-2 2-2s2 .9 2 2c0 .74-.4 1.38-1 1.73V9.5" />
              <circle cx="8" cy="11.5" r=".5" fill="currentColor" />
            </svg>
            <span>Ask anything&hellip;</span>
          </div>
        );

      case "thinking":
        return (
          <div className="palette-thinking">
            <div className="dot-pulse">
              <span />
              <span />
              <span />
            </div>
            Interpreting&hellip;
          </div>
        );

      case "confirm":
        if (response?.type === "confirm") {
          return (
            <ConfirmCard
              title={response.title}
              description={response.description}
              destructive={response.destructive}
              resources={response.resources}
              onExecute={() => execute(response.apiCalls)}
              onCancel={reset}
            />
          );
        }
        return null;

      case "info":
        if (response?.type === "info") {
          return (
            <InfoPanel
              title={response.title}
              markdown={response.markdown}
              docUrl={response.docUrl}
            />
          );
        }
        return null;

      case "code":
        if (response?.type === "code") {
          return (
            <PaletteCodeBlock
              code={response.code}
              lang={response.lang}
              title={response.title}
            />
          );
        }
        return null;

      case "success":
        return (
          <div className="palette-success">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="6" />
              <path d="M5.5 8l2 2 3.5-3.5" />
            </svg>
            Done
          </div>
        );

      case "error":
        return (
          <div className="palette-error">
            {error || "Something went wrong"}
          </div>
        );

      default:
        return (
          <ActionsBody
            query={query}
            results={results}
            selectedIdx={selectedIdx}
            onSelect={executeAction}
            onHover={setSelectedIdx}
          />
        );
    }
  };

  // Footer hints per mode
  const renderFooter = () => {
    switch (mode) {
      case "thinking":
        return null;
      case "confirm":
        return (
          <div className="palette-footer-left">
            <span className="palette-footer-hint">
              <kbd>&#9166;</kbd> confirm
            </span>
            <span className="palette-footer-hint">
              <kbd>esc</kbd> cancel
            </span>
          </div>
        );
      case "code":
        return (
          <div className="palette-footer-left">
            <span className="palette-footer-hint">
              <kbd>⌘C</kbd> copy
            </span>
            <span className="palette-footer-hint">
              <kbd>esc</kbd> close
            </span>
          </div>
        );
      case "info":
        return (
          <>
            <div className="palette-footer-left">
              {response?.type === "info" && response.docUrl && (
                <a
                  href={response.docUrl}
                  className="palette-footer-hint"
                  style={{ color: "var(--accent-purple)", cursor: "pointer" }}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Read docs →
                </a>
              )}
            </div>
            <div>
              <span className="palette-footer-hint">
                <kbd>esc</kbd> close
              </span>
            </div>
          </>
        );
      case "agent":
        return (
          <div className="palette-footer-left">
            <span className="palette-footer-hint">
              Submit <kbd>&#9166;</kbd>
            </span>
            <span className="palette-footer-hint">
              <kbd>esc</kbd> clear
            </span>
          </div>
        );
      case "success":
      case "error":
        return null;
      default:
        return (
          <>
            <div className="palette-footer-left">
              <span className="palette-footer-hint">
                Open <kbd>&#9166;</kbd>
              </span>
              <span className="palette-footer-hint">
                <kbd>&uarr;</kbd>
                <kbd>&darr;</kbd>
              </span>
            </div>
            <div className="palette-footer-right">
              <span className="palette-footer-hint palette-footer-nl-hint">
                try natural language →
              </span>
            </div>
          </>
        );
    }
  };

  const showAiPill = mode === "agent" || mode === "thinking";

  return (
    <div className="palette-overlay" onClick={closePalette}>
      <div
        className="palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="palette-input-row">
          <SearchIcon />
          <input
            ref={inputRef}
            className="palette-input"
            type="text"
            placeholder="What do you want to do..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {showAiPill && <span className="palette-ai-pill">AI</span>}
        </div>

        <div className="palette-divider" />

        <div className="palette-body">{renderBody()}</div>

        {(mode === "actions" || mode === "agent" || mode === "confirm" || mode === "code" || mode === "info") && (
          <div className="palette-footer">{renderFooter()}</div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──

function SearchIcon() {
  return (
    <svg
      className="palette-search-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  );
}

// ── Actions body ──

function ActionsBody({
  query,
  results,
  selectedIdx,
  onSelect,
  onHover,
}: {
  query: string;
  results: MatchResult[];
  selectedIdx: number;
  onSelect: (r: MatchResult) => void;
  onHover: (i: number) => void;
}) {
  // Separate navigation items from account items
  const navResults = results.filter((r) => r.action.category === "Navigation");
  const accountResults = results.filter((r) => r.action.category === "Account");

  if (query) {
    const allFiltered = [...navResults, ...accountResults];
    return (
      <>
        {allFiltered.map((r, i) => (
          <ActionItem
            key={r.action.id}
            result={r}
            selected={i === selectedIdx}
            onClick={() => onSelect(r)}
            onMouseEnter={() => onHover(i)}
          />
        ))}
        {allFiltered.length === 0 && (
          <div
            style={{ padding: "16px 18px", color: "var(--text-muted)", fontSize: 13 }}
          >
            No matching actions
          </div>
        )}
      </>
    );
  }

  // Default view: Recent + Navigation + Account
  let idx = 0;
  const elements: React.ReactNode[] = [];

  // Recent section (placeholder — first 3 items for now)
  if (results.length > 0) {
    elements.push(
      <div key="recent-label" className="palette-group-label">
        Recent
      </div>,
    );
    for (let i = 0; i < Math.min(3, results.length); i++) {
      const r = results[i];
      const currentIdx = idx++;
      elements.push(
        <ActionItem
          key={`recent-${r.action.id}`}
          result={r}
          selected={currentIdx === selectedIdx}
          onClick={() => onSelect(r)}
          onMouseEnter={() => onHover(currentIdx)}
        />,
      );
    }
  }

  // Navigation section
  elements.push(
    <div key="nav-label" className="palette-group-label">
      Navigation
    </div>,
  );
  for (const r of navResults) {
    // Skip if already shown in recent
    if (idx <= 3 && results.slice(0, 3).includes(r)) continue;
    const currentIdx = idx++;
    elements.push(
      <ActionItem
        key={r.action.id}
        result={r}
        selected={currentIdx === selectedIdx}
        onClick={() => onSelect(r)}
        onMouseEnter={() => onHover(currentIdx)}
      />,
    );
  }

  // Account items (logout)
  for (const r of accountResults) {
    if (idx <= 3 && results.slice(0, 3).includes(r)) continue;
    const currentIdx = idx++;
    elements.push(
      <ActionItem
        key={r.action.id}
        result={r}
        selected={currentIdx === selectedIdx}
        onClick={() => onSelect(r)}
        onMouseEnter={() => onHover(currentIdx)}
      />,
    );
  }

  return <>{elements}</>;
}

const iconPaths: Record<string, React.ReactNode> = {
  home: (
    <>
      <path d="M3 7l5-4 5 4v6a1 1 0 01-1 1H4a1 1 0 01-1-1V7z" />
      <path d="M6 14V9h4v5" />
    </>
  ),
  stream: <path d="M2 4h12M2 8h8M2 12h10" />,
  view: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="M2 6h12" />
    </>
  ),
  key: (
    <>
      <path d="M5 2v12M2 5h12" />
      <rect x="2" y="2" width="12" height="12" rx="2" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 2v2M8 12v2M2 8h2M12 8h2" />
    </>
  ),
};

function ActionItem({
  result,
  selected,
  onClick,
  onMouseEnter,
}: {
  result: MatchResult;
  selected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  const { action, ranges } = result;
  const parts = highlightLabel(action.label, ranges);
  const itemRef = useRef<HTMLDivElement>(null);

  // Scroll into view when selected via keyboard
  useEffect(() => {
    if (selected && itemRef.current) {
      itemRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);

  return (
    <div
      ref={itemRef}
      className={`palette-item ${selected ? "selected" : ""}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <svg
        className="palette-item-icon"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        {iconPaths[action.icon]}
      </svg>
      <span className="palette-item-label">
        {parts.map((p, i) =>
          typeof p === "string" ? (
            p
          ) : (
            <mark key={i}>{p.text}</mark>
          ),
        )}
      </span>
      {action.shortcut && (
        <span className="palette-item-shortcut">
          {action.shortcut.map((k, i) => (
            <kbd key={i}>{k}</kbd>
          ))}
        </span>
      )}
    </div>
  );
}
