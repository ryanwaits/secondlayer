"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { actions, getActionsByCategory } from "@/lib/actions/registry";
import { fuzzyMatch, highlightLabel, type MatchResult } from "@/lib/actions/fuzzy-match";

type Mode = "actions" | "agent" | "search";

export function CommandPalette() {
  const router = useRouter();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("actions");
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = fuzzyMatch(query, actions);
  const flatResults = results;

  const isAgentLike =
    query.length > 15 &&
    query.includes(" ") &&
    (flatResults.length === 0 || (flatResults[0]?.score ?? 0) < 30);

  const effectiveMode = mode === "actions" && isAgentLike ? "agent" : mode;

  const openPalette = useCallback((m: Mode) => {
    setMode(m);
    setQuery("");
    setSelectedIdx(0);
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedIdx(0);
  }, []);

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

  // Global keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && e.metaKey) {
        e.preventDefault();
        if (open && mode === "actions") closePalette();
        else openPalette("actions");
      }
      if (e.key === "j" && e.metaKey) {
        e.preventDefault();
        openPalette("agent");
      }
      if (e.key === "/" && e.metaKey) {
        e.preventDefault();
        openPalette("search");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, mode, openPalette, closePalette]);

  // Focus input when palette opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        closePalette();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, flatResults.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (flatResults[selectedIdx]) executeAction(flatResults[selectedIdx]);
      }
    },
    [closePalette, flatResults, selectedIdx, executeAction],
  );

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  // Wire ⌘K bar in topbar
  useEffect(() => {
    function onClick(e: Event) {
      if ((e.target as HTMLElement).closest(".dash-cmdk")) {
        openPalette("actions");
      }
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [openPalette]);

  if (!open) return null;

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
            placeholder={
              effectiveMode === "agent"
                ? "Ask anything..."
                : effectiveMode === "search"
                  ? "Search docs, API, CLI..."
                  : "What do you want to do..."
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="palette-divider" />

        <div className="palette-body">
          {effectiveMode === "actions" && (
            <ActionsBody
              query={query}
              results={flatResults}
              selectedIdx={selectedIdx}
              onSelect={executeAction}
              onHover={setSelectedIdx}
            />
          )}
          {effectiveMode === "agent" && (
            <div className="agent-thinking">
              <span className="thinking-dot" />
              Agent mode coming soon
            </div>
          )}
          {effectiveMode === "search" && (
            <div className="agent-thinking">
              <span className="thinking-dot" />
              Search coming soon
            </div>
          )}
        </div>

        <div className="palette-footer">
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
            <button
              className={`footer-mode-btn ${effectiveMode === "actions" ? "active" : ""}`}
              onClick={() => setMode("actions")}
            >
              Actions <kbd>&#8984;K</kbd>
            </button>
            <button
              className={`footer-mode-btn ${effectiveMode === "agent" ? "active" : ""}`}
              onClick={() => setMode("agent")}
            >
              Agent <kbd>&#8984;J</kbd>
            </button>
            <button
              className={`footer-mode-btn ${effectiveMode === "search" ? "active" : ""}`}
              onClick={() => setMode("search")}
            >
              Search <kbd>&#8984;/</kbd>
            </button>
          </div>
        </div>
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
