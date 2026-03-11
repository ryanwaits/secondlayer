"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const FILTER_GROUPS = [
  {
    label: "STX",
    types: [
      { id: "stx_transfer", desc: "Native STX transfers" },
      { id: "stx_mint", desc: "STX minting events" },
      { id: "stx_burn", desc: "STX burn events" },
      { id: "stx_lock", desc: "STX locking (stacking)" },
    ],
  },
  {
    label: "Fungible Tokens",
    types: [
      { id: "ft_transfer", desc: "FT transfers" },
      { id: "ft_mint", desc: "FT minting" },
      { id: "ft_burn", desc: "FT burns" },
    ],
  },
  {
    label: "NFTs",
    types: [
      { id: "nft_transfer", desc: "NFT transfers" },
      { id: "nft_mint", desc: "NFT minting" },
      { id: "nft_burn", desc: "NFT burns" },
    ],
  },
  {
    label: "Smart Contracts",
    types: [
      { id: "contract_call", desc: "Contract function calls" },
      { id: "contract_deploy", desc: "Contract deployments" },
      { id: "print_event", desc: "Contract print events" },
    ],
  },
];

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function StreamWizardStep1({
  query,
  selectedFilters,
  onToggleFilter,
  onNext,
}: {
  query: string;
  selectedFilters: string[];
  onToggleFilter: (filterId: string) => void;
  onNext: () => void;
}) {
  const q = query.toLowerCase();
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedIdx, setFocusedIdx] = useState(-1); // -1 = no pill focused

  // Filter groups by query
  const filteredGroups = FILTER_GROUPS.map((group) => ({
    ...group,
    types: group.types.filter(
      (t) =>
        !q ||
        t.id.toLowerCase().includes(q) ||
        t.desc.toLowerCase().includes(q) ||
        group.label.toLowerCase().includes(q),
    ),
  })).filter((g) => g.types.length > 0);

  // Flat list of visible filter IDs for index-based navigation
  const flatFilters = filteredGroups.flatMap((g) => g.types.map((t) => t.id));

  const totalMatches = flatFilters.length;

  // Reset focused index when query changes
  useEffect(() => {
    setFocusedIdx(-1);
  }, [query]);

  // Get all pill elements
  const getPills = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return [];
    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(".filter-pill"),
    );
  }, []);

  // Find nearest pill in a direction based on DOM position
  const findNearest = useCallback(
    (
      pills: HTMLElement[],
      currentIdx: number,
      direction: "up" | "down" | "left" | "right",
    ): number => {
      if (pills.length === 0) return -1;
      if (currentIdx < 0) return 0;

      const current = pills[currentIdx].getBoundingClientRect();

      if (direction === "left") {
        return Math.max(0, currentIdx - 1);
      }
      if (direction === "right") {
        return Math.min(pills.length - 1, currentIdx + 1);
      }

      // Up/down: find pill in adjacent row closest to current X
      const cx = current.left + current.width / 2;
      let best = currentIdx;
      let bestDist = Infinity;

      for (let i = 0; i < pills.length; i++) {
        if (i === currentIdx) continue;
        const r = pills[i].getBoundingClientRect();
        const ry = r.top + r.height / 2;
        const cy = current.top + current.height / 2;

        if (direction === "down" && ry <= cy + 2) continue;
        if (direction === "up" && ry >= cy - 2) continue;

        const dist = Math.abs(r.left + r.width / 2 - cx) + Math.abs(ry - cy) * 0.5;
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      return best;
    },
    [],
  );

  // Handle arrow key navigation between pills
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const dirMap: Record<string, "up" | "down" | "left" | "right"> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const direction = dirMap[e.key];
      if (!direction) return;

      e.preventDefault();
      const pills = getPills();
      if (pills.length === 0) return;

      // ArrowUp from top row → return focus to input
      if (direction === "up" && focusedIdx >= 0) {
        const current = pills[focusedIdx].getBoundingClientRect();
        const topRowY = pills[0].getBoundingClientRect().top;
        if (Math.abs(current.top - topRowY) < 2) {
          setFocusedIdx(-1);
          // Find and focus the palette input
          const input = document.querySelector<HTMLElement>(".palette-input");
          input?.focus();
          return;
        }
      }

      const nextIdx = findNearest(pills, focusedIdx, direction);
      setFocusedIdx(nextIdx);
      pills[nextIdx]?.focus();
    },
    [focusedIdx, getPills, findNearest],
  );

  // Track which pill index we're at from DOM
  let pillIdx = 0;

  return (
    <div
      ref={containerRef}
      onKeyDown={onKeyDown}
      style={{ padding: 18, maxHeight: 340, overflowY: "auto" }}
    >
      {q && (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            marginBottom: 10,
          }}
        >
          {totalMatches} match{totalMatches !== 1 ? "es" : ""}
        </div>
      )}

      {filteredGroups.map((group) => (
        <div key={group.label} style={{ marginBottom: 14 }}>
          <div className="wizard-group-label">{group.label}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {group.types.map((t) => {
              const idx = pillIdx++;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`filter-pill ${selectedFilters.includes(t.id) ? "active" : ""} ${idx === focusedIdx ? "kb-focused" : ""}`}
                  onClick={() => onToggleFilter(t.id)}
                  onFocus={() => setFocusedIdx(idx)}
                  tabIndex={-1}
                >
                  {highlightMatch(t.id, query)}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {filteredGroups.length === 0 && (
        <div
          style={{
            padding: "16px 0",
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          No matching filter types
        </div>
      )}
    </div>
  );
}
