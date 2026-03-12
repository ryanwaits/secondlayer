"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { actions, getActionsByCategory } from "@/lib/actions/registry";
import { fuzzyMatch, highlightLabel, type MatchResult } from "@/lib/actions/fuzzy-match";
import { useCommandAI } from "@/lib/command/use-command-ai";
import type { CommandCodeResponse, CommandInfoResponse, CommandConfirmResponse } from "@/lib/command/types";
import { ConfirmBody } from "./confirm-body";
import { CodeBody } from "./code-body";
import { InfoBody } from "./info-body";

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = fuzzyMatch(query, actions);
  const hasFuzzyResults = query.length === 0 || results.length > 0;

  const { mode, response, error, reset } = useCommandAI(
    open ? query : "",
    hasFuzzyResults,
    pathname,
  );

  const openPalette = useCallback(() => {
    setQuery("");
    setSelectedIdx(0);
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedIdx(0);
    reset();
  }, [reset]);

  const executeAction = useCallback(
    (result: MatchResult) => {
      const { action } = result;
      closePalette();
      if (action.href) {
        router.push(action.href);
      } else if (action.id === "logout") {
        logout();
        router.push("/");
      }
    },
    [closePalette, router, logout],
  );

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
      if (e.key === "Escape") {
        // Two-step escape: mode → actions → close
        if (mode !== "actions") {
          reset();
          setQuery("");
        } else {
          closePalette();
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
    [closePalette, results, selectedIdx, executeAction, mode, reset],
  );

  const handleConfirmExecute = useCallback(
    async (_confirmResponse: CommandConfirmResponse) => {
      // Execution is handled inline by ConfirmBody — this is a no-op placeholder
      // for the bulk "Execute All" button which ConfirmBody manages internally
    },
    [],
  );

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

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

  // Determine which body to render
  const renderBody = () => {
    switch (mode) {
      case "thinking":
        return (
          <div className="palette-thinking">
            <div className="dot-pulse">
              <span />
              <span />
              <span />
            </div>
            Thinking
          </div>
        );

      case "confirm":
        if (response?.type === "confirm") {
          return (
            <ConfirmBody
              response={response}
              onExecuteAll={() => handleConfirmExecute(response)}
              onCancel={reset}
            />
          );
        }
        return null;

      case "code":
        if (response?.type === "code") {
          return <CodeBody response={response as CommandCodeResponse} />;
        }
        return null;

      case "info":
        if (response?.type === "info") {
          return <InfoBody response={response as CommandInfoResponse} />;
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
              {!query && (
                <span className="palette-footer-hint" style={{ color: "var(--accent-purple)" }}>
                  try natural language →
                </span>
              )}
            </div>
          </>
        );
    }
  };

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
        </div>

        <div className="palette-divider" />

        <div className="palette-body">{renderBody()}</div>

        {mode === "actions" && (
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
  if (query) {
    return (
      <>
        <div className="palette-group-label">
          {results.length} result{results.length !== 1 ? "s" : ""}
        </div>
        {results.map((r, i) => (
          <ActionItem
            key={r.action.id}
            result={r}
            selected={i === selectedIdx}
            onClick={() => onSelect(r)}
            onMouseEnter={() => onHover(i)}
          />
        ))}
        {results.length === 0 && (
          <div
            style={{ padding: "16px 18px", color: "var(--text-muted)", fontSize: 13 }}
          >
            No matching actions
          </div>
        )}
      </>
    );
  }

  const grouped = getActionsByCategory(results.map((r) => r.action));
  let idx = 0;
  const elements: React.ReactNode[] = [];

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

  for (const [category, categoryActions] of grouped) {
    elements.push(
      <div key={`cat-${category}`} className="palette-group-label">
        {category}
      </div>,
    );
    for (const action of categoryActions) {
      const r = results.find((r) => r.action.id === action.id);
      if (!r) continue;
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
  }

  return <>{elements}</>;
}

const iconPaths: Record<string, React.ReactNode> = {
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

  return (
    <div
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
      <span className="palette-item-category">{action.category}</span>
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
